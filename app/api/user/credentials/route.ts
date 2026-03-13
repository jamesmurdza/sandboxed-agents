import { prisma } from "@/lib/prisma"
import { encrypt } from "@/lib/encryption"
import {
  requireAuth,
  isAuthError,
  badRequest,
} from "@/lib/api-helpers"

export async function POST(req: Request) {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  const body = await req.json()
  const {
    anthropicApiKey,
    anthropicAuthType,
    anthropicAuthToken,
    openaiApiKey,
    openrouterApiKey,
    sandboxAutoStopInterval,
  } = body

  if (!anthropicAuthType || !["api-key", "claude-max"].includes(anthropicAuthType)) {
    return badRequest("Invalid auth type")
  }

  // Validate sandboxAutoStopInterval if provided
  if (sandboxAutoStopInterval !== undefined) {
    if (typeof sandboxAutoStopInterval !== "number" || sandboxAutoStopInterval < 5 || sandboxAutoStopInterval > 20) {
      return badRequest("Invalid auto-stop interval. Must be between 5 and 20 minutes.")
    }
  }

  // Build the update/create data object with only provided (non-empty) fields
  // This prevents overwriting existing saved keys when fields are left empty
  const updateData: Record<string, unknown> = {
    anthropicAuthType,
  }

  // Only update credentials that were explicitly provided (non-empty strings)
  if (anthropicApiKey) {
    updateData.anthropicApiKey = encrypt(anthropicApiKey)
  }
  if (anthropicAuthToken) {
    updateData.anthropicAuthToken = encrypt(anthropicAuthToken)
  }
  if (openaiApiKey) {
    updateData.openaiApiKey = encrypt(openaiApiKey)
  }
  if (openrouterApiKey) {
    updateData.openrouterApiKey = encrypt(openrouterApiKey)
  }
  if (sandboxAutoStopInterval !== undefined) {
    updateData.sandboxAutoStopInterval = sandboxAutoStopInterval
  }

  await prisma.userCredentials.upsert({
    where: { userId },
    update: updateData,
    create: {
      userId,
      ...updateData,
    },
  })

  return Response.json({ success: true })
}

export async function DELETE() {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  await prisma.userCredentials.deleteMany({
    where: { userId },
  })

  return Response.json({ success: true })
}
