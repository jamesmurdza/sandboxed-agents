import type { Sandbox as DaytonaSandbox } from "@daytonaio/sdk"
import { prisma } from "@/lib/prisma"
import type { Agent } from "@/lib/types"
import { pollBackgroundAgent, type PollBackgroundOptions } from "@/lib/agent-session"
import { flushEvents, cleanupEvents } from "@/lib/agent-events"

// Track active pollers to ensure a single background loop per AgentExecution.
const activePollers = new Map<string, Promise<void>>()

export interface StartAgentPollerOptions extends Omit<PollBackgroundOptions, "agentExecutionId"> {
  agentExecutionId: string
  sandbox: DaytonaSandbox
  backgroundSessionId: string
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function startAgentPoller(options: StartAgentPollerOptions): Promise<void> {
  const { agentExecutionId, sandbox, backgroundSessionId, ...pollOptions } = options

  // Avoid starting duplicate pollers for the same execution.
  if (activePollers.has(agentExecutionId)) {
    return activePollers.get(agentExecutionId)!
  }

  const pollerPromise = (async () => {
    try {
      // Main polling loop: keep polling the Daytona background session until
      // the SDK reports completion or error.
      // Each poll writes a snapshot event into AgentEvent via agentExecutionId.
      // On completion, we flush events and update Prisma state.
      // Small fixed delay keeps load reasonable while still responsive.
      for (;;) {
        const result = await pollBackgroundAgent(sandbox, backgroundSessionId, {
          ...(pollOptions as PollBackgroundOptions),
          agentExecutionId,
        })

        if (result.status === "completed" || result.status === "error") {
          // Ensure all buffered events are visible to SSE consumers.
          await flushEvents(agentExecutionId)

          // Load execution with its message so we can persist the final content
          // and mark execution/branch/sandbox as idle.
          const execution = await prisma.agentExecution.findUnique({
            where: { id: agentExecutionId },
            include: {
              message: true,
            },
          })

          if (execution) {
            const updates: any[] = []

            // Update message content/toolCalls/contentBlocks with the final snapshot.
            updates.push(
              prisma.message.update({
                where: { id: execution.messageId },
                data: {
                  content: result.content || "",
                  toolCalls:
                    result.toolCalls && result.toolCalls.length > 0
                      ? result.toolCalls
                      : undefined,
                  contentBlocks:
                    result.contentBlocks && result.contentBlocks.length > 0
                      ? JSON.parse(JSON.stringify(result.contentBlocks))
                      : undefined,
                },
              }),
            )

            // Update execution status and completion time.
            updates.push(
              prisma.agentExecution.update({
                where: { id: execution.id },
                data: {
                  status: result.status,
                  completedAt: new Date(),
                },
              }),
            )

            // Mark sandbox and branch as idle if they still exist.
            updates.push(
              prisma.sandbox.updateMany({
                where: { id: execution.sandboxId },
                data: { status: "idle" },
              }),
            )

            if (execution.message?.branchId) {
              updates.push(
                prisma.branch.updateMany({
                  where: { id: execution.message.branchId },
                  data: { status: "idle" },
                }),
              )
            }

            await prisma.$transaction(updates)
          }

          // Schedule cleanup of ephemeral AgentEvent rows after a short delay,
          // so clients have time to consume the "complete" event.
          setTimeout(() => {
            cleanupEvents(agentExecutionId).catch((error) => {
              console.error(
                "[agent-poller] failed to cleanup events",
                { agentExecutionId },
                error,
              )
            })
          }, 60_000)

          break
        }

        await sleep(200)
      }
    } catch (error) {
      console.error("[agent-poller] unhandled poller error", { agentExecutionId }, error)
    } finally {
      activePollers.delete(agentExecutionId)
    }
  })()

  activePollers.set(agentExecutionId, pollerPromise)
  return pollerPromise
}

export function isAgentPollerActive(agentExecutionId: string): boolean {
  return activePollers.has(agentExecutionId)
}

