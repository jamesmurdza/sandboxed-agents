import { prisma } from "@/lib/prisma"

export interface SnapshotData {
  content?: string
  toolCalls?: unknown[]
  contentBlocks?: unknown[]
}

/**
 * Write the latest streaming snapshot to the execution row.
 * Status API reads this until completion (then final content is on Message).
 */
export async function updateSnapshot(
  executionId: string,
  data: SnapshotData
): Promise<void> {
  await (prisma as any).agentExecution.update({
    where: { id: executionId },
    data: { latestSnapshot: data },
  })
}

/**
 * Clear the streaming snapshot after completion (final content is on Message).
 */
export async function clearSnapshot(executionId: string): Promise<void> {
  await (prisma as any).agentExecution.update({
    where: { id: executionId },
    data: { latestSnapshot: null },
  }).catch((err: unknown) => {
    console.error(`[agent-events] clearSnapshot failed for ${executionId}`, err)
  })
}
