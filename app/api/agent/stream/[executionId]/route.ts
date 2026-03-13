import { prisma } from "@/lib/prisma"
import { requireAuth, isAuthError, unauthorized, notFound } from "@/lib/api-helpers"
import { getEvents } from "@/lib/agent-events"

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const maxDuration = 55 // seconds – close before Vercel 60s timeout

export async function GET(
  req: Request,
  { params }: { params: { executionId: string } },
) {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  const url = new URL(req.url)
  const rawLastEventId = url.searchParams.get("lastEventId")
  const lastEventId = Number.isFinite(Number(rawLastEventId))
    ? Number(rawLastEventId)
    : 0

  // Look up the AgentExecution by its external executionId (SDK id) so we keep
  // the existing API contract with /api/agent/execute.
  const execution = await prisma.agentExecution.findFirst({
    where: { executionId: params.executionId },
    include: {
      message: {
        include: {
          branch: {
            include: {
              repo: true,
            },
          },
        },
      },
    },
  })

  if (!execution || !execution.message?.branch?.repo) {
    return notFound("Execution not found")
  }

  // Verify the authenticated user owns this repo.
  if (execution.message.branch.repo.userId !== auth.userId) {
    return unauthorized()
  }

  const agentExecutionId = execution.id
  const startTime = Date.now()
  const MAX_DURATION_MS = maxDuration * 1000

  let lastIndex = lastEventId

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()

      const send = (id: number, type: string, data: unknown) => {
        // For simplicity, we label all snapshot events as "content" and use a
        // custom "complete" / "error" event type for lifecycle notifications.
        const eventLines = [
          `id: ${id}`,
          type === "content" ? undefined : `event: ${type}`,
          `data: ${JSON.stringify(data)}`,
          "",
        ].filter(Boolean) as string[]

        controller.enqueue(encoder.encode(eventLines.join("\n")))
      }

      try {
        // Initial catch-up: send all events after lastIndex.
        const historicalEvents = await getEvents(agentExecutionId, lastIndex)
        for (const event of historicalEvents) {
          send(event.eventIndex, "content", event.data)
          lastIndex = event.eventIndex
        }

        // If execution is already finished, emit a single complete event and close.
        const currentExec = await prisma.agentExecution.findUnique({
          where: { id: agentExecutionId },
          select: { status: true },
        })

        if (
          currentExec?.status === "completed" ||
          currentExec?.status === "error"
        ) {
          send(lastIndex + 1, "complete", { status: currentExec.status })
          controller.close()
          return
        }

        // Streaming loop: poll the AgentEvent table for new events until we
        // either reach maxDuration or the execution completes.
        for (;;) {
          if (Date.now() - startTime >= MAX_DURATION_MS) {
            // Client will resume from lastEventId on reconnect.
            controller.close()
            return
          }

          const newEvents = await getEvents(agentExecutionId, lastIndex)
          for (const event of newEvents) {
            send(event.eventIndex, "content", event.data)
            lastIndex = event.eventIndex
          }

          const execStatus = await prisma.agentExecution.findUnique({
            where: { id: agentExecutionId },
            select: { status: true },
          })

          if (
            execStatus?.status === "completed" ||
            execStatus?.status === "error"
          ) {
            send(lastIndex + 1, "complete", { status: execStatus.status })
            controller.close()
            return
          }

          await sleep(200)
        }
      } catch (error: any) {
        send(lastIndex + 1, "error", {
          message: error?.message ?? "Unknown SSE error",
        })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}

