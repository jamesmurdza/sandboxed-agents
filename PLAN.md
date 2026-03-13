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

### Handling Multiple Clients

Multiple clients may connect to the same execution:
- Same user with multiple tabs
- User closes tab and reopens mid-execution
- User reconnects after network interruption

Solution: **Store events in database** with sequential IDs. This enables:
1. Multiple clients share one source of truth
2. Reconnecting clients catch up from `lastEventId`
3. New clients joining mid-execution see full history
4. Server restarts don't lose event history

## Architecture

### Event Flow

```
1. User sends message
2. Client: POST /api/agent/execute → returns { executionId }
3. Server: Starts background polling loop, stores events in DB
4. Client: Opens EventSource to /api/agent/stream/[executionId]
5. Server: Sends historical events (catchup), then streams new events
6. Server: At 55s, closes connection gracefully
7. Client: EventSource auto-reconnects with lastEventId
8. Server: Queries events where id > lastEventId, continues streaming
9. Repeat 5-8 until execution completes
10. Server: Sends 'complete' event, closes connection
11. Client: Updates branch status to idle
12. Server: Cleans up event records (content preserved in final message)
```

### Multi-Client Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                      │
│   Tab A ◄────┐                                                       │
│              │                                                       │
│   Tab B ◄────┼─── SSE ─── Server ─── poll ─── Daytona SDK           │
│              │              │                                        │
│   Tab C ◄────┘              │                                        │
│                             ▼                                        │
│                      ┌─────────────┐                                 │
│                      │  Database   │                                 │
│                      │ AgentEvent  │                                 │
│                      │   table     │                                 │
│                      └─────────────┘                                 │
│                             │                                        │
│                             ▼                                        │
│                      On reconnect/new client:                        │
│                      Query events > lastEventId                      │
│                      Then continue streaming                         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Key behaviors:**
- **Single poller per execution:** Only one server loop polls the SDK
- **Multiple readers:** Any number of SSE connections can read from DB
- **Catchup on connect:** New clients query all historical events first
- **Resumption:** Reconnecting clients query only events after `lastEventId`
- **Cleanup:** Events deleted after execution completes (final message has content)

### Database Schema Addition

```prisma
model AgentEvent {
  id          String   @id @default(cuid())

  // Link to execution
  executionId String
  execution   AgentExecution @relation(fields: [executionId], references: [id], onDelete: Cascade)

  // Event ordering (monotonic within execution)
  eventIndex  Int

  // Event data
  type        String   // 'content' | 'tool_start' | 'tool_end' | 'error'
  data        Json     // Event payload

  createdAt   DateTime @default(now())

  @@unique([executionId, eventIndex])
  @@index([executionId, eventIndex])
}
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

### Phase 0: Database Schema Update

**File: `/prisma/schema.prisma`**

Add the AgentEvent model for storing events:

```prisma
model AgentEvent {
  id          String   @id @default(cuid())
  executionId String
  execution   AgentExecution @relation(fields: [executionId], references: [id], onDelete: Cascade)
  eventIndex  Int
  type        String
  data        Json
  createdAt   DateTime @default(now())

  @@unique([executionId, eventIndex])
  @@index([executionId, eventIndex])
}
```

Run migration: `npx prisma db push`

### Phase 1: Create Event Storage Service

**New file: `/lib/agent-events.ts`**

```typescript
import { prisma } from '@/lib/prisma'

// Buffer events in memory, flush periodically for efficiency
const eventBuffers = new Map<string, Array<{ type: string; data: object }>>()
const flushIntervals = new Map<string, NodeJS.Timeout>()

export async function appendEvent(
  executionId: string,
  type: string,
  data: object
): Promise<number> {
  // Get or create buffer
  let buffer = eventBuffers.get(executionId)
  if (!buffer) {
    buffer = []
    eventBuffers.set(executionId, buffer)

    // Start flush interval (every 500ms or when buffer has 10 events)
    const interval = setInterval(() => flushEvents(executionId), 500)
    flushIntervals.set(executionId, interval)
  }

  buffer.push({ type, data })

  // Flush immediately if buffer is large
  if (buffer.length >= 10) {
    await flushEvents(executionId)
  }

  // Return the event index (will be assigned on flush)
  const lastEvent = await prisma.agentEvent.findFirst({
    where: { executionId },
    orderBy: { eventIndex: 'desc' },
    select: { eventIndex: true }
  })
  return (lastEvent?.eventIndex ?? 0) + buffer.length
}

export async function flushEvents(executionId: string): Promise<void> {
  const buffer = eventBuffers.get(executionId)
  if (!buffer || buffer.length === 0) return

  // Get current max index
  const lastEvent = await prisma.agentEvent.findFirst({
    where: { executionId },
    orderBy: { eventIndex: 'desc' },
    select: { eventIndex: true }
  })
  const baseIndex = (lastEvent?.eventIndex ?? 0) + 1

  // Batch insert
  await prisma.agentEvent.createMany({
    data: buffer.map((event, i) => ({
      executionId,
      eventIndex: baseIndex + i,
      type: event.type,
      data: event.data,
    }))
  })

  // Clear buffer
  buffer.length = 0
}

export async function getEvents(
  executionId: string,
  afterIndex: number = 0
): Promise<Array<{ eventIndex: number; type: string; data: object }>> {
  // First flush any pending events
  await flushEvents(executionId)

  return prisma.agentEvent.findMany({
    where: {
      executionId,
      eventIndex: { gt: afterIndex }
    },
    orderBy: { eventIndex: 'asc' },
    select: {
      eventIndex: true,
      type: true,
      data: true,
    }
  })
}

export async function cleanupEvents(executionId: string): Promise<void> {
  // Stop flush interval
  const interval = flushIntervals.get(executionId)
  if (interval) {
    clearInterval(interval)
    flushIntervals.delete(executionId)
  }

  // Clear buffer
  eventBuffers.delete(executionId)

  // Delete from DB (events are preserved in final message content)
  await prisma.agentEvent.deleteMany({
    where: { executionId }
  })
}
```

### Phase 2: Create SSE Endpoint

**New file: `/app/api/agent/stream/[executionId]/route.ts`**

```typescript
import { getEvents, cleanupEvents } from '@/lib/agent-events'

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

  let lastIndex = parseInt(lastEventId || '0')

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()

      const send = (id: number, type: string, data: object) => {
        const event = `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`
        controller.enqueue(encoder.encode(event))
      }

      try {
        // Phase 1: Catchup - send all historical events
        const historicalEvents = await getEvents(executionId, lastIndex)
        for (const event of historicalEvents) {
          send(event.eventIndex, event.type, event.data)
          lastIndex = event.eventIndex
        }

        // Check if already complete
        const exec = await prisma.agentExecution.findUnique({
          where: { id: executionId },
          select: { status: true }
        })
        if (exec?.status === 'completed' || exec?.status === 'error') {
          send(lastIndex + 1, 'complete', { status: exec.status })
          controller.close()
          return
        }

        // Phase 2: Stream - poll for new events
        while (Date.now() - startTime < MAX_DURATION) {
          const newEvents = await getEvents(executionId, lastIndex)

          for (const event of newEvents) {
            send(event.eventIndex, event.type, event.data)
            lastIndex = event.eventIndex
          }

          // Check for completion
          const currentExec = await prisma.agentExecution.findUnique({
            where: { id: executionId },
            select: { status: true }
          })

          if (currentExec?.status === 'completed' || currentExec?.status === 'error') {
            send(lastIndex + 1, 'complete', { status: currentExec.status })
            controller.close()
            return
          }

          await sleep(200)
        }

        // Timeout approaching, close gracefully (client will reconnect)
        controller.close()

      } catch (error) {
        send(lastIndex + 1, 'error', { message: error.message })
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

### Phase 3: Create Client SSE Hook

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

### Phase 4: Update Agent Session Layer

**File: `/lib/agent-session.ts`**

Changes needed:
1. Remove `backgroundSessionEvents` global cache (no longer needed)
2. Update `pollBackgroundAgent` to store events in database via `appendEvent`
3. Simplify return value (events are stored in DB, not returned)

```typescript
import { appendEvent } from '@/lib/agent-events'

// REMOVE this global cache:
const backgroundSessionEvents = new Map<string, Event[]>()

// UPDATE pollBackgroundAgent to store events:
export async function pollBackgroundAgent(
  sandbox: Sandbox,
  executionId: string,
  backgroundSessionId: string
): Promise<{
  status: 'running' | 'completed' | 'error'
}> {
  // Get events from SDK
  const sdkEvents = await sandbox.pollEvents(backgroundSessionId)

  // Store each event in database
  for (const event of sdkEvents) {
    await appendEvent(executionId, event.type, transformEventData(event))
  }

  return {
    status: determineStatus(sdkEvents)
  }
}
```

### Phase 5: Create Background Polling Service

**New file: `/lib/agent-poller.ts`**

Single poller per execution (not per client connection):

```typescript
import { pollBackgroundAgent } from '@/lib/agent-session'
import { flushEvents, cleanupEvents } from '@/lib/agent-events'
import { prisma } from '@/lib/prisma'

// Track active pollers to prevent duplicates
const activePollers = new Map<string, Promise<void>>()

export async function startPolling(
  executionId: string,
  sandbox: Sandbox,
  backgroundSessionId: string
): Promise<void> {
  // Don't start duplicate pollers
  if (activePollers.has(executionId)) {
    return activePollers.get(executionId)
  }

  const pollerPromise = (async () => {
    try {
      while (true) {
        const result = await pollBackgroundAgent(sandbox, executionId, backgroundSessionId)

        if (result.status === 'completed' || result.status === 'error') {
          // Final flush to ensure all events are in DB
          await flushEvents(executionId)

          // Update execution status
          await prisma.agentExecution.update({
            where: { id: executionId },
            data: {
              status: result.status,
              completedAt: new Date()
            }
          })

          // Cleanup events after delay (let clients receive complete event first)
          setTimeout(() => cleanupEvents(executionId), 60_000)

          break
        }

        await sleep(200)
      }
    } finally {
      activePollers.delete(executionId)
    }
  })()

  activePollers.set(executionId, pollerPromise)
  return pollerPromise
}

export function isPolling(executionId: string): boolean {
  return activePollers.has(executionId)
}
```

### Phase 6: Update Branch Operations

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

### Phase 7: Simplify Sync Logic

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

### Phase 8: Delete Old Polling Code

**Delete file: `/components/chat/hooks/useExecutionPolling.ts`** (~350 lines)

**Delete from `/app/api/agent/status/route.ts`** (entire file, ~150 lines)

### Phase 9: Update Execute Endpoint

**File: `/app/api/agent/execute/route.ts`**

Start the background poller when execution begins:

```typescript
import { startPolling } from '@/lib/agent-poller'

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

  // Start background polling (fire and forget - runs independently)
  // This stores events in DB as they arrive from the SDK
  startPolling(execution.id, sandbox, backgroundSessionId)

  return Response.json({
    executionId: execution.id,
    backgroundSessionId,
  })
}
```

## Files Changed

### New Files
- `/prisma/schema.prisma` - Add `AgentEvent` model (migration required)
- `/lib/agent-events.ts` - Event storage service (~80 lines)
- `/lib/agent-poller.ts` - Background polling service (~60 lines)
- `/app/api/agent/stream/[executionId]/route.ts` - SSE endpoint (~100 lines)
- `/components/chat/hooks/useAgentStream.ts` - SSE client hook (~80 lines)

### Modified Files
- `/lib/agent-session.ts` - Remove cache, store events via `appendEvent`
- `/hooks/use-branch-operations.ts` - Use new SSE hook
- `/hooks/use-sync-data.ts` - Remove streaming ref logic
- `/app/api/agent/execute/route.ts` - Start background poller

### Deleted Files
- `/components/chat/hooks/useExecutionPolling.ts` (~350 lines)
- `/app/api/agent/status/route.ts` (~150 lines)

### Net Change
- **Deleted:** ~500 lines of complex, bug-prone polling code
- **Added:** ~320 lines of simpler SSE + event storage code
- **Net reduction:** ~180 lines
- **Complexity reduction:** Significant (race conditions eliminated by design)

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
- Event buffering and flushing works correctly
- Event cleanup after execution completes

### Integration Tests
- Full execution streams correctly
- Reconnection after timeout is seamless
- Multiple concurrent executions don't interfere
- Error states handled properly
- Database events match SDK events

### Multi-Client Tests
- **Multiple tabs:** Open 2-3 tabs watching same execution, all receive same events
- **Tab close/reopen:** Close tab mid-execution, reopen, verify catchup works
- **Late joiner:** Start execution in Tab A, open Tab B 30s later, verify Tab B sees full history
- **Different branches:** Tab A on branch-1, Tab B on branch-2, verify isolation
- **Reconnection race:** Kill network on both tabs, verify both reconnect and sync correctly

### Manual Tests
- Watch agent execution, verify smooth streaming
- Kill network mid-stream, verify reconnection
- Open multiple tabs, verify all show same content
- Long execution (>60s), verify timeout handling and seamless reconnect
- Close tab, reopen during execution, verify catchup
- Verify events cleaned up after execution (check DB)

## Bugs Fixed by This Change

| Bug | How It's Fixed |
|-----|----------------|
| Overlapping requests | Single SSE connection, no overlapping |
| Out-of-order responses | Events arrive in server-controlled order |
| Streaming ref stuck | Connection close = automatic cleanup |
| Sync blocking all branches | No shared streaming ref |
| Memory leaks (event cache) | Events in DB with cleanup, not in-memory |
| Memory leaks (intervals) | No intervals, just EventSource |
| Stale closures | Simple event handlers, no complex deps |
| Duplicate messages | No optimistic ID confusion |
| 150ms delay | Events push immediately |
| Global event cache (security) | Events scoped to executionId in DB |
| Multiple tabs see different content | All tabs read from same DB source |
| Tab close loses streaming state | Events persisted, new tab catches up |

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
