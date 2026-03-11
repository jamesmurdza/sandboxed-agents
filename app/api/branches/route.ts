import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const { repoId, name, baseBranch, startCommit } = body

  if (!repoId || !name) {
    return Response.json({ error: "Missing required fields" }, { status: 400 })
  }

  // Verify repo ownership
  const repo = await prisma.repo.findUnique({
    where: { id: repoId },
  })

  if (!repo || repo.userId !== session.user.id) {
    return Response.json({ error: "Repo not found" }, { status: 404 })
  }

  // Check if branch already exists
  const existingBranch = await prisma.branch.findUnique({
    where: {
      repoId_name: {
        repoId,
        name,
      },
    },
  })

  if (existingBranch) {
    return Response.json({ error: "Branch already exists" }, { status: 409 })
  }

  const branch = await prisma.branch.create({
    data: {
      repoId,
      name,
      baseBranch,
      startCommit,
      status: "idle",
    },
    include: {
      sandbox: true,
      messages: {
        orderBy: { createdAt: "asc" },
        take: 100, // Limit messages to prevent OOM on large conversations
      },
      _count: {
        select: { messages: true }, // Include total count for pagination
      },
    },
  })

  return Response.json({ branch })
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const branchId = searchParams.get("id")

  if (!branchId) {
    return Response.json({ error: "Missing branch ID" }, { status: 400 })
  }

  // Verify ownership through repo
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    include: { repo: true },
  })

  if (!branch || branch.repo.userId !== session.user.id) {
    return Response.json({ error: "Branch not found" }, { status: 404 })
  }

  await prisma.branch.delete({
    where: { id: branchId },
  })

  return Response.json({ success: true })
}

// Update branch status/metadata
export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const { branchId, status, prUrl, name, draftPrompt } = body

  if (!branchId) {
    return Response.json({ error: "Missing branch ID" }, { status: 400 })
  }

  // Verify ownership
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    include: { repo: true },
  })

  if (!branch || branch.repo.userId !== session.user.id) {
    return Response.json({ error: "Branch not found" }, { status: 404 })
  }

  const updatedBranch = await prisma.branch.update({
    where: { id: branchId },
    data: {
      ...(status && { status }),
      ...(prUrl !== undefined && { prUrl }),
      ...(name && { name }),
      ...(draftPrompt !== undefined && { draftPrompt }),
    },
    include: {
      sandbox: true,
      messages: {
        orderBy: { createdAt: "asc" },
        take: 100, // Limit messages to prevent OOM on large conversations
      },
      _count: {
        select: { messages: true }, // Include total count for pagination
      },
    },
  })

  return Response.json({ branch: updatedBranch })
}
