import { getQuota } from "@/lib/quota"
import { requireAuth, isAuthError } from "@/lib/api-helpers"

export async function GET() {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  const quota = await getQuota(auth.userId)
  return Response.json(quota)
}
