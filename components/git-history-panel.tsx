"use client"

import { useState, useEffect, useCallback } from "react"
import { X, RefreshCw, Loader2, GitCommitHorizontal, GitBranch } from "lucide-react"
import { cn } from "@/lib/utils"
import { PATHS } from "@/lib/constants"

interface GitCommit {
  hash: string
  shortHash: string
  author: string
  email: string
  message: string
  timestamp: string
}

interface GitHistoryPanelProps {
  sandboxId: string
  repoName: string
  baseBranch: string
  onClose: () => void
  onScrollToCommit?: (shortHash: string) => void
  onBranchFromCommit?: (commitHash: string) => void
  refreshTrigger?: number
}

export function GitHistoryPanel({ sandboxId, repoName, baseBranch, onClose, onScrollToCommit, onBranchFromCommit, refreshTrigger }: GitHistoryPanelProps) {
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [mergeBase, setMergeBase] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchLog = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/sandbox/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId,
          repoPath: `${PATHS.SANDBOX_HOME}/${repoName}`,
          action: "log",
          targetBranch: baseBranch,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCommits(data.commits || [])
      setMergeBase(data.mergeBase || "")
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [sandboxId, repoName, baseBranch])

  useEffect(() => {
    fetchLog()
  }, [fetchLog])

  // Auto-refresh when refreshTrigger changes
  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      fetchLog()
    }
  }, [refreshTrigger]) // eslint-disable-line react-hooks/exhaustive-deps

  function formatDate(ts: string) {
    try {
      const d = new Date(ts)
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
        " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    } catch {
      return ts
    }
  }

  return (
    <div className="flex h-full w-[280px] shrink-0 flex-col border-l border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <span className="text-xs font-semibold text-foreground">Git History</span>
        <div className="flex items-center gap-1">
          <button
            onClick={fetchLog}
            disabled={loading}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={onClose}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Commits */}
      <div className="flex-1 overflow-y-auto">
        {loading && commits.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-xs">Loading commits...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
            <span className="text-xs text-red-400">{error}</span>
          </div>
        ) : commits.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
            <GitCommitHorizontal className="h-5 w-5" />
            <span className="text-xs">No commits yet</span>
          </div>
        ) : (
          <div className="flex flex-col">
            {commits.map((commit, i) => {
              const isMergeBase = mergeBase && commit.hash === mergeBase
              const mergeBaseIdx = mergeBase ? commits.findIndex((c) => c.hash === mergeBase) : -1
              const isInherited = mergeBaseIdx >= 0 && i >= mergeBaseIdx
              return (
                <div
                  key={commit.hash || i}
                  onClick={() => onScrollToCommit?.(commit.shortHash)}
                  className={cn(
                    "group/commit relative flex gap-2.5 border-b border-border/50 px-3 py-2.5",
                    isInherited && "opacity-40",
                    onScrollToCommit && "cursor-pointer hover:bg-accent/30"
                  )}
                >
                  {/* Timeline dot */}
                  <div className="relative mt-1 flex flex-col items-center">
                    <div className={cn(
                      "h-2 w-2 rounded-full shrink-0",
                      isInherited ? "bg-muted-foreground/20" : "bg-muted-foreground/40"
                    )} />
                    {i < commits.length - 1 && (
                      <div className="absolute top-3 w-px flex-1 bg-border" style={{ height: "calc(100% + 4px)" }} />
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-xs text-foreground leading-snug line-clamp-2">
                      {commit.message}
                    </span>
                    <div className="flex items-center gap-2">
                      <code className="text-[10px] font-mono text-primary/70">{commit.shortHash}</code>
                      <span className="text-[10px] text-muted-foreground/60">{commit.author}</span>
                      {onBranchFromCommit && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onBranchFromCommit(commit.hash) }}
                          title="Branch from here"
                          className="ml-auto flex h-4 w-4 cursor-pointer items-center justify-center rounded text-muted-foreground/0 group-hover/commit:text-muted-foreground hover:!text-primary transition-colors"
                        >
                          <GitBranch className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground/40">{formatDate(commit.timestamp)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
