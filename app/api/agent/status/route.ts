import { prisma } from "@/lib/prisma"
import {
  requireAuth,
  isAuthError,
  badRequest,
  notFound,
  unauthorized,
} from "@/lib/api-helpers"
import { INCLUDE_EXECUTION_WITH_CONTEXT } from "@/lib/prisma-includes"

export async function POST(req: Request) {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  const body = await req.json()
  const { executionId, messageId } = body as {
    executionId?: string
    messageId?: string
  }

  if (!executionId && !messageId) {
    return badRequest("Missing executionId or messageId")
  }

  // Look up the execution and its message/branch context.
  const execution = await prisma.agentExecution.findFirst({
    where: executionId ? { executionId } : { messageId },
    include: INCLUDE_EXECUTION_WITH_CONTEXT,
  })

  if (!execution) {
    return notFound("Execution not found")
  }

  // Verify the authenticated user owns this repo.
  const repo = execution.message.branch.repo
  if (!repo || repo.userId !== auth.userId) {
    return unauthorized()
  }

  const snapshot = ((execution as { latestSnapshot?: unknown }).latestSnapshot as Record<string, unknown> | null) ?? {}

  return Response.json({
    status: execution.status,
    content: snapshot.content ?? execution.message.content ?? "",
    toolCalls: snapshot.toolCalls ?? execution.message.toolCalls ?? [],
    contentBlocks:
      snapshot.contentBlocks ?? execution.message.contentBlocks ?? [],
    error: undefined,
    agentCrashed:
      snapshot.agentCrashed && typeof snapshot.agentCrashed === "object"
        ? (snapshot.agentCrashed as { message?: string; output?: string })
        : undefined,
  })
}

// Optional GET variant for convenience
export async function GET(req: Request) {
  const url = new URL(req.url)
  const executionId = url.searchParams.get("executionId") || undefined
  const messageId = url.searchParams.get("messageId") || undefined

  if (!executionId && !messageId) {
    return badRequest("Missing executionId or messageId")
  }

  const fakeReq = new Request(req.url, {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify({ executionId, messageId }),
  })

  return POST(fakeReq)
}
