import { prisma } from "@/lib/prisma"
import { requireAuth, isAuthError, badRequest, notFound } from "@/lib/api-helpers"
import { INCLUDE_BRANCH_WITH_REPO } from "@/lib/prisma-includes"

// POST endpoint for saving draft prompts (needed for sendBeacon on page unload)
export async function POST(req: Request) {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  const body = await req.json()
  const { branchId, draftPrompt } = body

  if (!branchId) {
    return badRequest("Missing branch ID")
  }

  // Verify ownership
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    include: INCLUDE_BRANCH_WITH_REPO,
  })

  if (!branch || branch.repo.userId !== auth.userId) {
    return notFound("Branch not found")
  }

  await prisma.branch.update({
    where: { id: branchId },
    data: { draftPrompt: draftPrompt ?? "" },
  })

  return Response.json({ success: true })
}
