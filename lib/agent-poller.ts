import type { Sandbox as DaytonaSandbox } from "@daytonaio/sdk"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import type { Agent } from "@/lib/types"
import { pollBackgroundAgent, clearLastSnapshotForExecution, type PollBackgroundOptions } from "@/lib/agent-session"

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
      for (;;) {
        const result = await pollBackgroundAgent(sandbox, backgroundSessionId, {
          ...(pollOptions as PollBackgroundOptions),
          agentExecutionId,
        })

        if (result.status === "completed" || result.status === "error") {
          clearLastSnapshotForExecution(agentExecutionId)

          const execution = await prisma.agentExecution.findUnique({
            where: { id: agentExecutionId },
            include: {
              message: true,
            },
          })

          if (execution) {
            const updates: any[] = []

            // When the agent stopped with an error or agent_crashed, show a message in the chat.
            let content = result.content || ""
            if (result.status === "error" && result.agentCrashed) {
              const { message, output } = result.agentCrashed
              const crashMsg = message ?? "Process exited without completing"
              content = content
                ? `${content}\n\n[Agent crashed: ${crashMsg}]`
                : `[Agent crashed: ${crashMsg}]`
              if (output) content += `\n\nOutput:\n${output}`
            } else if (result.status === "error" && result.error) {
              content = content ? `${content}\n\n[Agent stopped: ${result.error}]` : `[Agent stopped: ${result.error}]`
            }

            updates.push(
              prisma.message.update({
                where: { id: execution.messageId },
                data: {
                  content,
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

            // Update execution status, completion time, and clear streaming snapshot (or store agentCrashed for status API).
            updates.push(
              prisma.agentExecution.update({
                where: { id: execution.id },
                data: {
                  status: result.status,
                  completedAt: new Date(),
                  latestSnapshot:
                    result.agentCrashed != null
                      ? (result.agentCrashed as unknown as Prisma.InputJsonValue)
                      : Prisma.DbNull,
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

          break
        }

        await sleep(500)
      }
    } catch (error) {
      // Poller crashed (e.g. DB error, sandbox gone) – persist a message so the user sees it in chat.
      try {
        const execution = await prisma.agentExecution.findUnique({
          where: { id: agentExecutionId },
          include: { message: true },
        })
        if (execution) {
          const errMsg = error instanceof Error ? error.message : "Unknown error"
          await prisma.$transaction([
            prisma.message.update({
              where: { id: execution.messageId },
              data: {
                content: `${execution.message.content || ""}\n\n[Agent stopped unexpectedly: ${errMsg}]`,
              },
            }),
            prisma.agentExecution.update({
              where: { id: execution.id },
              data: { status: "error", completedAt: new Date(), latestSnapshot: Prisma.DbNull },
            }),
            prisma.sandbox.updateMany({
              where: { id: execution.sandboxId },
              data: { status: "idle" },
            }),
            ...(execution.message?.branchId
              ? [
                  prisma.branch.updateMany({
                    where: { id: execution.message.branchId },
                    data: { status: "idle" },
                  }),
                ]
              : []),
          ])
        }
      } catch (e) {
        console.error("[agent-poller] loop error and failed to persist stop message", { agentExecutionId }, e)
      }
    } finally {
      activePollers.delete(agentExecutionId)
    }
  })()

  activePollers.set(agentExecutionId, pollerPromise)
  return pollerPromise
}

