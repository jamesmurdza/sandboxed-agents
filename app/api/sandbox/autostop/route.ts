import { Daytona } from "@daytonaio/sdk"
import { prisma } from "@/lib/prisma"
import {
  requireAuth,
  isAuthError,
  badRequest,
  getDaytonaApiKey,
  isDaytonaKeyError,
} from "@/lib/api-helpers"

export async function POST(req: Request) {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  const body = await req.json()
  const { interval } = body

  // Validate interval (5-20 minutes)
  if (typeof interval !== "number" || interval < 5 || interval > 20) {
    return badRequest("Invalid interval. Must be between 5 and 20 minutes.")
  }

  const daytonaApiKey = getDaytonaApiKey()
  if (isDaytonaKeyError(daytonaApiKey)) return daytonaApiKey

  // Get user's sandboxes (limit to prevent OOM with many sandboxes)
  const sandboxes = await prisma.sandbox.findMany({
    where: { userId: auth.userId },
    select: { sandboxId: true },
    take: 100,
    orderBy: { lastActiveAt: "desc" },
  })

  if (sandboxes.length === 0) {
    return Response.json({ success: true, updated: 0, failed: 0 })
  }

  const daytona = new Daytona({ apiKey: daytonaApiKey })
  let updated = 0
  let failed = 0

  // Update each sandbox's autostop interval
  for (const { sandboxId } of sandboxes) {
    try {
      const sandbox = await daytona.get(sandboxId)
      await sandbox.setAutostopInterval(interval)
      updated++
    } catch (error) {
      // Sandbox may have been deleted or is in an invalid state
      console.error(`Failed to update autostop for sandbox ${sandboxId}:`, error)
      failed++
    }
  }

  return Response.json({ success: true, updated, failed })
}
