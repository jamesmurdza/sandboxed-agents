"use client"

import { Github, X, Loader2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { useState } from "react"
import type { Repo, Settings } from "@/lib/types"
import { generateId } from "@/lib/store"

interface AddRepoModalProps {
  open: boolean
  onClose: () => void
  settings: Settings
  onAddRepo: (repo: Repo) => void
}

export function AddRepoModal({ open, onClose, settings, onAddRepo }: AddRepoModalProps) {
  const [url, setUrl] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  function parseGitHubUrl(input: string): { owner: string; name: string } | null {
    const trimmed = input.trim().replace(/\.git$/, "").replace(/\/$/, "")
    // Try URL format: https://github.com/owner/repo
    const urlMatch = trimmed.match(/github\.com\/([^/]+)\/([^/]+)/)
    if (urlMatch) return { owner: urlMatch[1], name: urlMatch[2] }
    // Try owner/repo format
    const shortMatch = trimmed.match(/^([^/]+)\/([^/]+)$/)
    if (shortMatch) return { owner: shortMatch[1], name: shortMatch[2] }
    return null
  }

  async function handleAdd() {
    const parsed = parseGitHubUrl(url)
    if (!parsed) {
      setError("Invalid format. Use https://github.com/owner/repo or owner/repo")
      return
    }

    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({
        owner: parsed.owner,
        name: parsed.name,
      })
      if (settings.githubPat) {
        params.set("token", settings.githubPat)
      }

      const res = await fetch(`/api/github/repo?${params}`)
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch repository")
      }

      const repo: Repo = {
        id: generateId(),
        name: data.name,
        owner: data.owner,
        avatar: data.avatar,
        defaultBranch: data.defaultBranch,
        branches: [],
      }

      onAddRepo(repo)
      setUrl("")
      setError(null)
      onClose()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to add repository"
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !loading) {
      handleAdd()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-md flex-col rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Github className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Add Repository</h2>
          </div>
          <button
            onClick={onClose}
            className="flex cursor-pointer h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-foreground">GitHub Repository</label>
            <Input
              type="text"
              placeholder="owner/repo or https://github.com/owner/repo"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setError(null)
              }}
              onKeyDown={handleKeyDown}
              className="h-9 bg-secondary border-border text-xs font-mono placeholder:text-muted-foreground/40"
              autoFocus
              disabled={loading}
            />
            {error && (
              <p className="text-[11px] text-red-400">{error}</p>
            )}
            {!error && (
              <p className="text-[11px] text-muted-foreground">
                Paste the full URL or use owner/repo shorthand.
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="cursor-pointer rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={loading || !url.trim()}
            className="cursor-pointer flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {loading && <Loader2 className="h-3 w-3 animate-spin" />}
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
