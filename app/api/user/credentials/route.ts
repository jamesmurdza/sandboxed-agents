import { prisma } from "@/lib/prisma"
import { encrypt } from "@/lib/encryption"
import { Daytona } from "@daytonaio/sdk"
import {
  requireAuth,
  isAuthError,
  badRequest,
  getDaytonaApiKey,
} from "@/lib/api-helpers"

export async function POST(req: Request) {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  const body = await req.json()
  const {
    anthropicApiKey,
    anthropicAuthToken,
    openaiApiKey,
    openrouterApiKey,
    daytonaApiKey,
    sandboxAutoStopInterval,
  } = body

  // Validate sandboxAutoStopInterval if provided
  if (sandboxAutoStopInterval !== undefined) {
    if (typeof sandboxAutoStopInterval !== "number" || sandboxAutoStopInterval < 5 || sandboxAutoStopInterval > 20) {
      return badRequest("Invalid auto-stop interval. Must be between 5 and 20 minutes.")
    }
  }

  // Build the update/create data object with only provided (non-empty) fields
  // This prevents overwriting existing saved keys when fields are left empty
  const updateData: Record<string, unknown> = {}

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

  // Handle Daytona API key change - this deletes all sandboxes
  if (daytonaApiKey) {
    // First, delete all existing sandboxes for this user (both in DB and Daytona)
    const sandboxes = await prisma.sandbox.findMany({
      where: { userId },
      select: { sandboxId: true },
    })

    if (sandboxes.length > 0) {
      // Get the current Daytona API key to delete old sandboxes
      const currentDaytonaKey = getDaytonaApiKey()
      if (typeof currentDaytonaKey === "string") {
        const daytona = new Daytona({ apiKey: currentDaytonaKey })

        // Delete sandboxes from Daytona (best effort - some may already be gone)
        await Promise.allSettled(
          sandboxes.map(async (s) => {
            try {
              const sandbox = await daytona.get(s.sandboxId)
              await sandbox.delete()
            } catch {
              // Sandbox may already be deleted or inaccessible
            }
          })
        )
      }

      // Delete all sandboxes from database (cascades to branches, messages, etc.)
      await prisma.sandbox.deleteMany({
        where: { userId },
      })

      // Also delete all branches since they're now orphaned (sandboxes were deleted)
      // Actually, branches might still be useful for history, but their sandboxes are gone
      // Let's update branch status to indicate sandbox is gone
      await prisma.branch.updateMany({
        where: {
          repo: { userId },
        },
        data: {
          status: "idle",
        },
      })
    }

    // Save the new Daytona API key
    updateData.daytonaApiKey = encrypt(daytonaApiKey)
  }

  // Only perform upsert if there's something to update
  if (Object.keys(updateData).length > 0) {
    await prisma.userCredentials.upsert({
      where: { userId },
      update: updateData,
      create: {
        userId,
        ...updateData,
      },
    })
  }

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
