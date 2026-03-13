import { prisma } from "@/lib/prisma"

/**
 * Agent Events Storage Service
 *
 * Stores streaming events in the database for SSE delivery.
 * Supports multiple clients reading the same execution stream.
 *
 * Features:
 * - Buffered writes for efficiency (flush every 500ms or 10 events)
 * - Sequential event indexing for resumption
 * - Automatic cleanup after execution completes
 */

// In-memory buffers for batching writes
const eventBuffers = new Map<string, Array<{ type: string; data: object }>>()
const flushIntervals = new Map<string, NodeJS.Timeout>()

function getAgentEventDelegate() {
  const delegate = (prisma as { agentEvent?: typeof prisma.agentExecution }).agentEvent
  if (!delegate) {
    throw new Error(
      "Prisma client is missing AgentEvent model. Run: npx prisma generate"
    )
  }
  // Loosely typed to avoid coupling to the generated Prisma client types.
  // At runtime this is the AgentEvent delegate.
  return delegate as any
}

/**
 * Append an event to the execution's event stream.
 * Events are buffered and flushed periodically for efficiency.
 */
export async function appendEvent(
  executionId: string,
  type: string,
  data: object
): Promise<number> {
  console.log("[agent-events] appendEvent start", { executionId, type })

  // Get or create buffer
  let buffer = eventBuffers.get(executionId)
  if (!buffer) {
    buffer = []
    eventBuffers.set(executionId, buffer)

    // Start flush interval (every 500ms)
    const interval = setInterval(() => {
      flushEvents(executionId).catch(console.error)
    }, 500)
    flushIntervals.set(executionId, interval)
  }

  console.log("[agent-events] appendEvent push", {
    executionId,
    type,
    bufferedBefore: buffer.length,
  })

  buffer.push({ type, data })

  // Flush immediately if buffer is large
  if (buffer.length >= 10) {
    await flushEvents(executionId)
  }

  // We don't guarantee an exact index here; SSE consumers rely on the
  // monotonically increasing eventIndex stored in the database.
  return 0
}

/**
 * Flush buffered events to the database.
 * Called periodically and on completion.
 */
export async function flushEvents(executionId: string): Promise<void> {
  const buffer = eventBuffers.get(executionId)
  if (!buffer || buffer.length === 0) return

  console.log("[agent-events] flushEvents start", {
    executionId,
    bufferLength: buffer.length,
  })

  // Batch insert
  const agentEvent = getAgentEventDelegate()
  try {
    // Always compute the base index from the database to avoid race conditions
    // across processes. This, combined with skipDuplicates, prevents unique
    // constraint violations when two workers flush around the same time.
    const lastEvent = await agentEvent.findFirst({
      where: { executionId },
      orderBy: { eventIndex: "desc" },
      select: { eventIndex: true },
    })
    const baseIndex = (lastEvent?.eventIndex ?? 0) + 1

    console.log("[agent-events] flushEvents computed baseIndex", {
      executionId,
      lastEventIndex: lastEvent?.eventIndex ?? 0,
      baseIndex,
    })

    await agentEvent.createMany({
      data: buffer.map((event, i) => ({
        executionId,
        eventIndex: baseIndex + i,
        type: event.type,
        data: event.data,
      })),
      skipDuplicates: true,
    })

    // Clear buffer
    buffer.length = 0

    console.log("[agent-events] flushEvents done", {
      executionId,
      inserted: buffer.length,
    })
  } catch (error) {
    console.error(`Failed to flush events for execution ${executionId}:`, error)
    throw error
  }
}

/**
 * Get events after a given index.
 * Used for catchup and streaming.
 */
export async function getEvents(
  executionId: string,
  afterIndex: number = 0
): Promise<Array<{ eventIndex: number; type: string; data: unknown }>> {
  // First flush any pending events to ensure consistency
  await flushEvents(executionId)

  const agentEvent = getAgentEventDelegate()
  const events = await agentEvent.findMany({
    where: {
      executionId,
      eventIndex: { gt: afterIndex },
    },
    orderBy: { eventIndex: "asc" },
    select: {
      eventIndex: true,
      type: true,
      data: true,
    },
  })

  return events
}

/**
 * Get the latest event index for an execution.
 * Returns 0 if no events exist.
 */
export async function getLatestEventIndex(executionId: string): Promise<number> {
  // Fall back to DB
  const agentEvent = getAgentEventDelegate()
  const lastEvent = await agentEvent.findFirst({
    where: { executionId },
    orderBy: { eventIndex: "desc" },
    select: { eventIndex: true },
  })

  return lastEvent?.eventIndex ?? 0
}

/**
 * Cleanup events for an execution.
 * Called after execution completes and clients have received the complete event.
 */
export async function cleanupEvents(executionId: string): Promise<void> {
  // Stop flush interval
  const interval = flushIntervals.get(executionId)
  if (interval) {
    clearInterval(interval)
    flushIntervals.delete(executionId)
  }

  // Clear buffer and counter
  eventBuffers.delete(executionId)

  // Delete from DB (events are preserved in final message content)
  try {
    const agentEvent = getAgentEventDelegate()
    await agentEvent.deleteMany({
      where: { executionId },
    })
  } catch (error) {
    console.error(`Failed to cleanup events for execution ${executionId}:`, error)
  }
}

/**
 * Check if an execution has any events (buffered or in DB).
 */
export async function hasEvents(executionId: string): Promise<boolean> {
  const bufferCount = eventBuffers.get(executionId)?.length ?? 0
  if (bufferCount > 0) return true

  const agentEvent = getAgentEventDelegate()
  const count = await agentEvent.count({
    where: { executionId },
  })

  return count > 0
}
