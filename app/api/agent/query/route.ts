import { Daytona } from "@daytonaio/sdk"
import { prisma } from "@/lib/prisma"
import {
  requireAuth,
  isAuthError,
  getDaytonaApiKey,
  isDaytonaKeyError,
  getSandboxWithAuth,
  decryptUserCredentials,
  badRequest,
  notFound,
  resetSandboxStatus,
} from "@/lib/api-helpers"
import {
  createAgentSession,
  formatEventForSSE,
  createOutputAccumulator,
  accumulateEvent,
} from "@/lib/agent-session"
import { type AgentProvider } from "@/lib/agent-providers"

export const maxDuration = 300 // 5 minute timeout for agent queries

export async function POST(req: Request) {
  // 1. Authenticate
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  const body = await req.json()
  const { sandboxId, prompt, previewUrlPattern, repoName, messageId } = body

  if (!sandboxId || !prompt) {
    return badRequest("Missing required fields")
  }

  // 2. Verify sandbox belongs to this user
  const sandboxRecord = await getSandboxWithAuth(sandboxId, auth.userId)
  if (!sandboxRecord) {
    return notFound("Sandbox not found")
  }

  // 3. Get credentials
  const daytonaApiKey = getDaytonaApiKey()
  if (isDaytonaKeyError(daytonaApiKey)) return daytonaApiKey

  // Decrypt user's credentials
  const credentials = decryptUserCredentials(sandboxRecord.user.credentials)

  // Get agent and model from branch
  const agent = (sandboxRecord.branch?.agent || "claude") as AgentProvider
  const model = sandboxRecord.branch?.model || undefined

  // Determine repo name from database or request
  const actualRepoName = repoName || sandboxRecord.branch?.repo?.name || "repo"

  const encoder = new TextEncoder()

  // Capture record IDs for use in helper functions
  const sandboxDbId = sandboxRecord.id
  const branchDbId = sandboxRecord.branch?.id

  // Accumulate output for database persistence
  const output = createOutputAccumulator()
  let streamCancelled = false
  let hasSavedToDb = false

  // Helper to save accumulated content to DB (idempotent)
  async function saveAccumulatedContent() {
    if (hasSavedToDb) return
    if (!messageId) return
    if (!output.content && output.toolCalls.length === 0) return

    hasSavedToDb = true
    try {
      await prisma.message.update({
        where: { id: messageId },
        data: {
          content: output.content,
          toolCalls: output.toolCalls.length > 0 ? output.toolCalls : undefined,
        },
      })

      // Save session ID if we got one
      if (output.sessionId) {
        await prisma.sandbox.update({
          where: { id: sandboxDbId },
          data: { sessionId: output.sessionId },
        })
      }
    } catch {
      // Message may not exist if client disconnected before it was saved
    }

    // Also update branch/sandbox status to idle when cancelled
    if (streamCancelled) {
      try {
        await resetSandboxStatus(sandboxDbId, branchDbId)
      } catch {
        // Non-critical
      }
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      // Safe send that doesn't throw if stream is cancelled
      function send(data: Record<string, unknown>) {
        if (streamCancelled) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          // Controller is closed/cancelled, ignore the error
          streamCancelled = true
        }
      }

      try {
        // Initialize Daytona client
        const daytona = new Daytona({ apiKey: daytonaApiKey })
        const sandbox = await daytona.get(sandboxId)

        // Ensure sandbox is started
        if (sandbox.state !== "started") {
          send({ type: "status", message: "Starting sandbox..." })
          await sandbox.start(120) // 120-second startup timeout
        }

        // Update last activity
        await prisma.sandbox.update({
          where: { id: sandboxRecord.id },
          data: { lastActiveAt: new Date(), status: "running" },
        })

        // Reset auto-stop timer
        try {
          await sandbox.refreshActivity()
        } catch {
          // Non-critical
        }

        // Get session ID for resumption (if any)
        const sessionId = sandboxRecord.sessionId || undefined

        // Create agent session using the SDK
        const session = await createAgentSession(agent, {
          sandbox,
          credentials: {
            anthropicApiKey: credentials.anthropicApiKey,
            openaiApiKey: credentials.openaiApiKey,
          },
          model,
          sessionId,
          timeout: 300,
        })

        // Run the query and stream events
        for await (const event of session.run(prompt)) {
          // Accumulate for database persistence
          accumulateEvent(output, event)

          // Format and send to frontend
          const sseData = formatEventForSSE(event)
          send(sseData)

          // Break on end event
          if (event.type === "end") {
            break
          }
        }

        // Save accumulated output to database
        await saveAccumulatedContent()

        // Update sandbox and branch status back to idle
        await prisma.sandbox.update({
          where: { id: sandboxRecord.id },
          data: { status: "idle" },
        })
        if (sandboxRecord.branch) {
          await prisma.branch.update({
            where: { id: sandboxRecord.branch.id },
            data: { status: "idle" },
          })
        }

        send({ type: "done" })
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error"

        // Save error message to database if we have a messageId
        if (!streamCancelled) {
          const errorMsg = `Error: ${message}`
          output.content = output.content
            ? `${output.content}\n\n${errorMsg}`
            : errorMsg
        }
        await saveAccumulatedContent()

        send({ type: "error", message })
      }

      controller.close()
    },
    cancel() {
      // Called when the client disconnects (e.g., page refresh)
      streamCancelled = true
      // Save whatever we have accumulated so far
      saveAccumulatedContent()
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
