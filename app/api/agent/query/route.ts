import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { decrypt } from "@/lib/encryption"
import { ensureSandboxReady } from "@/lib/sandbox-resume"

export const maxDuration = 300 // 5 minute timeout for agent queries

export async function POST(req: Request) {
  // 1. Authenticate
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const { sandboxId, contextId, prompt, previewUrlPattern, repoName, messageId } = body

  if (!sandboxId || !prompt) {
    return Response.json({ error: "Missing required fields" }, { status: 400 })
  }

  // 2. Verify sandbox belongs to this user
  const sandboxRecord = await prisma.sandbox.findUnique({
    where: { sandboxId },
    include: {
      user: { include: { credentials: true } },
      branch: { include: { repo: true } },
    },
  })

  if (!sandboxRecord || sandboxRecord.userId !== session.user.id) {
    return Response.json({ error: "Sandbox not found" }, { status: 404 })
  }

  // 3. Get credentials
  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) {
    return Response.json({ error: "Server configuration error" }, { status: 500 })
  }

  // Decrypt user's Anthropic credentials
  const creds = sandboxRecord.user.credentials
  let anthropicApiKey: string | undefined
  let anthropicAuthToken: string | undefined
  const anthropicAuthType = creds?.anthropicAuthType || "api-key"

  if (creds?.anthropicApiKey) {
    anthropicApiKey = decrypt(creds.anthropicApiKey)
  }
  if (creds?.anthropicAuthToken) {
    anthropicAuthToken = decrypt(creds.anthropicAuthToken)
  }

  // Determine repo name from database or request
  const actualRepoName = repoName || sandboxRecord.branch?.repo?.name || "repo"

  const encoder = new TextEncoder()

  // Accumulate output so we can save it to DB even if client disconnects
  let accumulatedContent = ""
  let accumulatedToolCalls: { tool: string; summary: string }[] = []

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
        )
      }

      try {
        // Use resume helper to ensure sandbox + agent are ready
        const { sandbox, contextId: activeContextId, wasResumed, resumeSessionId } = await ensureSandboxReady(
          daytonaApiKey,
          sandboxId,
          actualRepoName,
          previewUrlPattern || sandboxRecord.previewUrlPattern || undefined,
          anthropicApiKey,
          anthropicAuthType,
          anthropicAuthToken,
        )

        // If context was re-created after resume, notify frontend and update DB
        if (wasResumed) {
          send({ type: "context-updated", contextId: activeContextId })
          await prisma.sandbox.update({
            where: { id: sandboxRecord.id },
            data: { contextId: activeContextId },
          })
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

        // Find the context to use
        const contexts = await sandbox.codeInterpreter.listContexts()
        const ctx = contexts.find((c) => c.id === activeContextId)
        if (!ctx) {
          throw new Error(
            "Agent context not found. The sandbox may have been reset. Please create a new branch."
          )
        }

        // Run the query with streaming output
        const result = await sandbox.codeInterpreter.runCode(
          `coding_agent.run_query_sync(os.environ.get('PROMPT', ''))`,
          {
            context: ctx,
            envs: {
              PROMPT: prompt,
              ...(previewUrlPattern || sandboxRecord.previewUrlPattern
                ? { PREVIEW_URL_PATTERN: previewUrlPattern || sandboxRecord.previewUrlPattern }
                : {}),
              ...(resumeSessionId ? { RESUME_SESSION_ID: resumeSessionId } : {}),
            },
            onStdout: (msg) => {
              const text = msg.output
              // Parse SESSION_ID: prefix from agent stdout
              if (text.startsWith("SESSION_ID:")) {
                const sessionId = text.replace("SESSION_ID:", "").trim()
                if (sessionId) {
                  send({ type: "session-id", sessionId })
                  // Update session ID in database
                  prisma.sandbox.update({
                    where: { id: sandboxRecord.id },
                    data: { sessionId },
                  }).catch(() => {})
                }
                return
              }
              // Accumulate output for server-side persistence
              if (text.startsWith("TOOL_USE:")) {
                const toolSummary = text.replace("TOOL_USE:", "").trim()
                const toolName = toolSummary.split(":")[0].trim()
                accumulatedToolCalls.push({ tool: toolName, summary: toolSummary })
              } else {
                accumulatedContent += text
              }
              send({ type: "stdout", content: text })
            },
            onStderr: (msg) => {
              send({ type: "stderr", content: msg.output })
            },
          }
        )

        if (result.error) {
          accumulatedContent += accumulatedContent
            ? `\n\nError: ${result.error.value}`
            : `Error: ${result.error.value}`
          send({ type: "error", message: result.error.value })
        }

        // Save accumulated output to database - ensures message is persisted even if client disconnects
        if (messageId && (accumulatedContent || accumulatedToolCalls.length > 0)) {
          try {
            await prisma.message.update({
              where: { id: messageId },
              data: {
                content: accumulatedContent,
                toolCalls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
              },
            })
          } catch {
            // Message may not exist if client disconnected before it was saved
          }
        }

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
        if (messageId) {
          const errorContent = accumulatedContent
            ? `${accumulatedContent}\n\nError: ${message}`
            : `Error: ${message}`
          try {
            await prisma.message.update({
              where: { id: messageId },
              data: {
                content: errorContent,
                toolCalls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
              },
            })
          } catch {
            // Message may not exist
          }
        }

        send({ type: "error", message })
      }

      controller.close()
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
