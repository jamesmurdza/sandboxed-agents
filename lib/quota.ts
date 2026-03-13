import { prisma } from "@/lib/prisma"
import { BRANCH_STATUS } from "@/lib/constants"

const MAX_CONCURRENT_SANDBOXES = 10

// Statuses that count toward the active sandbox quota
const ACTIVE_STATUSES = [BRANCH_STATUS.CREATING, BRANCH_STATUS.RUNNING, BRANCH_STATUS.STOPPED]

export async function getQuota(userId: string) {
  const current = await prisma.sandbox.count({
    where: {
      userId,
      status: { in: ACTIVE_STATUSES },
    },
  })

  return {
    allowed: current < MAX_CONCURRENT_SANDBOXES,
    current,
    max: MAX_CONCURRENT_SANDBOXES,
    remaining: Math.max(0, MAX_CONCURRENT_SANDBOXES - current),
  }
}
