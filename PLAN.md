# Implementation Plan: Replace Polling with Chunked SSE

## Overview

Replace the client-side polling architecture with Server-Sent Events (SSE) to eliminate race conditions, simplify code, and improve responsiveness. The server will still poll the Daytona SDK internally, but clients receive a clean event stream.

## Problem Statement

The current polling implementation has multiple bugs stemming from:
1. **Overlapping requests** - 500ms interval fires regardless of response time
2. **Out-of-order responses** - Slower responses overwrite newer data
3. **Streaming ref stuck** - Network timeouts leave `streamingMessageIdRef` set forever
4. **Sync blocking all branches** - Single flag affects all branches, not just streaming one
5. **Memory leaks** - Event cache grows unbounded, intervals not always cleaned up
6. **Stale closures** - Callbacks recreated, polling intervals cleared mid-stream
7. **Duplicate messages** - Optimistic ID → DB ID transition not handled properly

Root cause: Client repeatedly asks "anything new?" creating inherent race conditions.

## Solution: Chunked SSE with Auto-Reconnect

Move the complexity boundary from browser to server:

```
CURRENT (Buggy)                          NEW (Simple)
─────────────────                        ─────────────
Browser ──poll 500ms──► Server           Browser ◄──SSE events── Server
Browser ◄──JSON resp─── Server                                     │
   │                                                               │
   ├─ Race conditions                    Server ──poll 200ms──► Daytona SDK
   ├─ Out-of-order                       Server ◄──SDK events── Daytona SDK
   ├─ Overlapping requests
   └─ Complex state mgmt
```

### Handling Vercel Timeouts

Vercel Pro has 60-second function timeout. Solution:
- Server closes SSE connection at ~55 seconds
- Client auto-reconnects with `lastEventId`
- Server resumes from that position
- User never notices the reconnect (~50ms gap)

## Architecture

### Event Flow

```
1. User sends message
2. Client: POST /api/agent/execute → returns { executionId }
3. Client: Opens EventSource to /api/agent/stream/[executionId]
4. Server: Polls Daytona SDK in a loop
5. Server: Pushes events as SSE: { type, content, toolCalls, ... }
6. Server: At 55s, closes connection gracefully
7. Client: EventSource auto-reconnects with lastEventId
8. Server: Resumes from lastEventId position
9. Repeat 4-8 until execution completes
10. Server: Sends 'complete' event, closes connection
11. Client: Updates branch status to idle
```

### Event Types

```typescript
interface SSEEvent {
  id: string              // Monotonic event ID for resumption
  type: 'content' | 'tool_start' | 'tool_end' | 'complete' | 'error'
  data: {
    content?: string      // Accumulated text content
    toolCall?: ToolCall   // Tool invocation details
    toolResult?: string   // Tool output
    error?: string        // Error message
  }
}
```

## Implementation Steps

### Phase 1: Create SSE Endpoint

**New file: `/app/api/agent/stream/[executionId]/route.ts`**

```typescript
export async function GET(
  req: Request,
  { params }: { params: { executionId: string } }
) {
  const { executionId } = params
  const lastEventId = new URL(req.url).searchParams.get('lastEventId')

  // Validate user owns this execution
  const execution = await validateExecution(executionId, userId)
  if (!execution) return new Response('Not found', { status: 404 })

  const startTime = Date.now()
  const MAX_DURATION = 55_000  // Close before Vercel 60s timeout

  let eventCounter = parseInt(lastEventId || '0')

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()

      const send = (type: string, data: object) => {
        eventCounter++
        const event = `id: ${eventCounter}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`
        controller.enqueue(encoder.encode(event))
      }

      try {
        while (Date.now() - startTime < MAX_DURATION) {
          const result = await pollBackgroundAgent(sandbox, sessionId, {
            afterEventId: eventCounter
          })

          // Send each event
          for (const event of result.events) {
            send(event.type, event.data)
          }

          // Check for completion
          if (result.status === 'completed' || result.status === 'error') {
            send('complete', { status: result.status })
            controller.close()
            return
          }

          await sleep(200)
        }

        // Timeout approaching, close gracefully (client will reconnect)
        controller.close()

      } catch (error) {
        send('error', { message: error.message })
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
```

### Phase 2: Create Client SSE Hook

**New file: `/components/chat/hooks/useAgentStream.ts`**

```typescript
export function useAgentStream({
  onContentUpdate,
  onToolCall,
  onComplete,
  onError,
}: UseAgentStreamOptions) {
  const eventSourceRef = useRef<EventSource | null>(null)
  const lastEventIdRef = useRef<string>('0')

  const startStreaming = useCallback((executionId: string, messageId: string) => {
    const connect = () => {
      const url = `/api/agent/stream/${executionId}?lastEventId=${lastEventIdRef.current}`
      const eventSource = new EventSource(url)
      eventSourceRef.current = eventSource

      eventSource.onmessage = (event) => {
        lastEventIdRef.current = event.lastEventId
        const data = JSON.parse(event.data)
        onContentUpdate(messageId, data)
      }

      eventSource.addEventListener('complete', (event) => {
        const data = JSON.parse(event.data)
        onComplete(messageId, data.status)
        eventSource.close()
      })

      eventSource.addEventListener('error', (event) => {
        const data = JSON.parse(event.data)
        onError(messageId, data.message)
        eventSource.close()
      })

      eventSource.onerror = () => {
        eventSource.close()
        // Auto-reconnect after brief delay
        setTimeout(connect, 1000)
      }
    }

    connect()
  }, [onContentUpdate, onComplete, onError])

  const stopStreaming = useCallback(() => {
    eventSourceRef.current?.close()
    eventSourceRef.current = null
    lastEventIdRef.current = '0'
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close()
    }
  }, [])

  return { startStreaming, stopStreaming }
}
```

### Phase 3: Update Agent Session Layer

**File: `/lib/agent-session.ts`**

Changes needed:
1. Remove `backgroundSessionEvents` global cache (no longer needed)
2. Add event ID tracking to `pollBackgroundAgent`
3. Return events with sequential IDs for SSE resumption

```typescript
// Remove this:
const backgroundSessionEvents = new Map<string, Event[]>()

// Update pollBackgroundAgent to:
export async function pollBackgroundAgent(
  sandbox: Sandbox,
  backgroundSessionId: string,
  options: { afterEventId?: number } = {}
): Promise<{
  status: 'running' | 'completed' | 'error'
  events: Array<{ id: number; type: string; data: object }>
}> {
  // Get events from SDK
  const sdkEvents = await sandbox.pollEvents(backgroundSessionId)

  // Transform and add sequential IDs
  const events = sdkEvents.map((event, index) => ({
    id: (options.afterEventId || 0) + index + 1,
    type: event.type,
    data: transformEventData(event)
  }))

  return {
    status: determineStatus(sdkEvents),
    events
  }
}
```

### Phase 4: Update Branch Operations

**File: `/hooks/use-branch-operations.ts`**

Replace `useExecutionPolling` with `useAgentStream`:

```typescript
// Remove:
import { useExecutionPolling } from '@/components/chat/hooks/useExecutionPolling'

// Add:
import { useAgentStream } from '@/components/chat/hooks/useAgentStream'

// In the hook:
const { startStreaming, stopStreaming } = useAgentStream({
  onContentUpdate: (messageId, data) => {
    handleUpdateMessage(branchId, messageId, {
      content: data.content,
      toolCalls: data.toolCalls,
      contentBlocks: data.contentBlocks,
    })
  },
  onComplete: (messageId, status) => {
    handleUpdateBranch(branchId, { status: 'idle' })
    handleForceSave(branchId)
    // Detect commits, play notification, etc.
  },
  onError: (messageId, error) => {
    handleUpdateBranch(branchId, { status: 'error' })
    // Show error to user
  },
})
```

### Phase 5: Simplify Sync Logic

**File: `/hooks/use-sync-data.ts`**

Remove all `streamingMessageIdRef` logic:

```typescript
// Remove:
if (streamingMessageIdRef?.current) {
  return  // This was blocking ALL branches
}

// The SSE connection itself is now the "streaming" state
// No need for a separate ref to track it
```

**File: `/hooks/use-cross-device-sync.ts`**

No changes needed - continues to work as before for cross-device awareness.

### Phase 6: Delete Old Polling Code

**Delete file: `/components/chat/hooks/useExecutionPolling.ts`** (~350 lines)

**Delete from `/app/api/agent/status/route.ts`** (entire file, ~150 lines)

### Phase 7: Update Execute Endpoint

**File: `/app/api/agent/execute/route.ts`**

Simplify - just start the execution, don't worry about polling setup:

```typescript
export async function POST(req: Request) {
  // ... validation ...

  const { backgroundSessionId } = await createBackgroundSession(sandbox, prompt)

  // Create execution record
  const execution = await prisma.agentExecution.create({
    data: {
      messageId,
      executionId: backgroundSessionId,
      status: 'running',
      startedAt: new Date(),
    }
  })

  return Response.json({
    executionId: execution.id,
    backgroundSessionId,
  })
}
```

## Files Changed

### New Files
- `/app/api/agent/stream/[executionId]/route.ts` - SSE endpoint (~100 lines)
- `/components/chat/hooks/useAgentStream.ts` - SSE client hook (~80 lines)

### Modified Files
- `/lib/agent-session.ts` - Remove cache, add event IDs
- `/hooks/use-branch-operations.ts` - Use new SSE hook
- `/hooks/use-sync-data.ts` - Remove streaming ref logic
- `/app/api/agent/execute/route.ts` - Simplify

### Deleted Files
- `/components/chat/hooks/useExecutionPolling.ts` (~350 lines)
- `/app/api/agent/status/route.ts` (~150 lines)

### Net Change
- **Deleted:** ~500 lines of complex, bug-prone polling code
- **Added:** ~180 lines of simple SSE code
- **Net reduction:** ~320 lines

## Migration Strategy

### Phase 1: Add SSE (Parallel)
1. Create SSE endpoint
2. Create SSE hook
3. Add feature flag: `USE_SSE_STREAMING`
4. Test with flag enabled

### Phase 2: Switch Over
1. Enable SSE by default
2. Keep polling as fallback for 1 week
3. Monitor for issues

### Phase 3: Cleanup
1. Remove feature flag
2. Delete polling code
3. Remove `/api/agent/status` endpoint

## Testing Plan

### Unit Tests
- SSE endpoint returns correct headers
- Events have sequential IDs
- Reconnection resumes from lastEventId
- Timeout at 55s closes gracefully

### Integration Tests
- Full execution streams correctly
- Reconnection after timeout is seamless
- Multiple concurrent executions don't interfere
- Error states handled properly

### Manual Tests
- Watch agent execution, verify smooth streaming
- Kill network mid-stream, verify reconnection
- Open multiple tabs, verify isolation
- Long execution (>60s), verify timeout handling

## Bugs Fixed by This Change

| Bug | How It's Fixed |
|-----|----------------|
| Overlapping requests | Single SSE connection, no overlapping |
| Out-of-order responses | Events arrive in server-controlled order |
| Streaming ref stuck | Connection close = automatic cleanup |
| Sync blocking all branches | No shared streaming ref |
| Memory leaks (event cache) | No client-side cache needed |
| Memory leaks (intervals) | No intervals, just EventSource |
| Stale closures | Simple event handlers, no complex deps |
| Duplicate messages | No optimistic ID confusion |
| 150ms delay | Events push immediately |
| Global event cache (security) | No global cache, per-connection streaming |

## Rollback Plan

If issues arise:
1. Disable `USE_SSE_STREAMING` flag
2. Polling code still works (during parallel phase)
3. Investigate and fix SSE issues
4. Re-enable SSE

## Future Improvements

Once SSE is stable:
1. Add heartbeat events (keep connection alive)
2. Add compression for large tool outputs
3. Consider Edge Functions for longer timeouts
4. Add metrics/monitoring for stream health
