import { useState, useRef, useCallback } from "react"
import type { Branch } from "@/lib/types"

interface UseBranchRenamingOptions {
  branch: Branch
  repoName: string
  repoFullName: string
  onUpdateBranch: (updates: Partial<Branch>) => void
  addSystemMessage: (content: string) => void
}

/**
 * Handles branch renaming UI state and logic
 */
export function useBranchRenaming({
  branch,
  repoName,
  repoFullName,
  onUpdateBranch,
  addSystemMessage,
}: UseBranchRenamingOptions) {
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState("")
  const [renameLoading, setRenameLoading] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)

  const handleRename = useCallback(async () => {
    const newName = renameValue.trim()
    if (!newName || newName === branch.name || renameLoading) return
    setRenameLoading(true)
    try {
      const [owner, repo] = repoFullName.split("/")
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId: branch.sandboxId,
          repoPath: `/home/daytona/${repoName}`,
          action: "rename-branch",
          currentBranch: branch.name,
          newBranchName: newName,
          repoOwner: owner,
          repoApiName: repo,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onUpdateBranch({ name: newName })
      setRenaming(false)
    } catch (err: unknown) {
      addSystemMessage(`Rename failed: ${err instanceof Error ? err.message : "Unknown error"}`)
      setRenaming(false)
    } finally {
      setRenameLoading(false)
    }
  }, [renameValue, branch.name, branch.sandboxId, repoName, repoFullName, renameLoading, onUpdateBranch, addSystemMessage])

  const startRenaming = useCallback(() => {
    setRenaming(true)
    setRenameValue(branch.name)
  }, [branch.name])

  const cancelRenaming = useCallback(() => {
    if (!renameLoading) {
      setRenaming(false)
    }
  }, [renameLoading])

  return {
    renaming,
    setRenaming,
    renameValue,
    setRenameValue,
    renameLoading,
    renameInputRef,
    handleRename,
    startRenaming,
    cancelRenaming,
  }
}
