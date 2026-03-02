"use client"

import { cn } from "@/lib/utils"
import type { Repo } from "@/lib/types"
import { Plus, Settings, X } from "lucide-react"
import { useState } from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"

interface RepoSidebarProps {
  repos: Repo[]
  activeRepoId: string | null
  userAvatar?: string | null
  onSelectRepo: (repoId: string) => void
  onRemoveRepo: (repoId: string) => void
  onOpenSettings: () => void
  onOpenAddRepo: () => void
}

export function RepoSidebar({
  repos,
  activeRepoId,
  userAvatar,
  onSelectRepo,
  onRemoveRepo,
  onOpenSettings,
  onOpenAddRepo,
}: RepoSidebarProps) {
  const [removeModalRepo, setRemoveModalRepo] = useState<Repo | null>(null)

  return (
    <TooltipProvider delayDuration={0}>
      <aside className="flex h-full w-[60px] shrink-0 flex-col items-center gap-2 border-r border-border bg-sidebar py-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <button className="mb-2 flex cursor-pointer h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground font-mono text-sm font-bold overflow-hidden">
              {userAvatar ? (
                <img src={userAvatar} alt="You" className="h-full w-full rounded-lg object-cover" />
              ) : (
                "Ah"
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">AgentHub</TooltipContent>
        </Tooltip>

        <div className="mx-auto h-px w-8 bg-border" />

        {repos.map((repo) => {
          const isActive = repo.id === activeRepoId
          const hasRunning = repo.branches.some((b) => b.status === "running" || b.status === "creating")
          const initials = (repo.owner[0] + repo.name[0]).toUpperCase()
          return (
            <div key={repo.id} className="relative group">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onSelectRepo(repo.id)}
                    className={cn(
                      "relative flex cursor-pointer h-10 w-10 items-center justify-center rounded-lg font-mono text-xs font-semibold transition-all overflow-hidden",
                      isActive
                        ? "ring-2 ring-primary"
                        : "hover:bg-accent hover:text-foreground"
                    )}
                  >
                    {repo.avatar ? (
                      <img
                        src={repo.avatar}
                        alt={repo.owner}
                        className="h-full w-full rounded-lg object-cover"
                      />
                    ) : (
                      <span className={cn(
                        "flex h-full w-full items-center justify-center rounded-lg",
                        isActive
                          ? "bg-accent text-foreground"
                          : "bg-secondary text-muted-foreground"
                      )}>
                        {initials}
                      </span>
                    )}
                    {hasRunning && (
                      <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-sidebar bg-primary" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{repo.owner}/{repo.name}</TooltipContent>
              </Tooltip>
              {/* Remove button */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setRemoveModalRepo(repo)
                }}
                className="absolute -right-1 -top-1 flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-all z-10 opacity-0 group-hover:opacity-100 hover:text-red-400"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          )
        })}

        <div className="mt-auto flex flex-col items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onOpenAddRepo}
                className="flex cursor-pointer h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Plus className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Add repository</TooltipContent>
          </Tooltip>

          <div className="mx-auto h-px w-8 bg-border" />

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onOpenSettings}
                className="flex cursor-pointer h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Settings className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Settings</TooltipContent>
          </Tooltip>
        </div>
      </aside>

      {/* Remove repo confirmation modal */}
      <Dialog open={!!removeModalRepo} onOpenChange={(open) => !open && setRemoveModalRepo(null)}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">Remove repository?</DialogTitle>
          </DialogHeader>
          {removeModalRepo && removeModalRepo.branches.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              This will delete all chats and branches for <span className="font-semibold text-foreground">{removeModalRepo.owner}/{removeModalRepo.name}</span>.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Remove <span className="font-semibold text-foreground">{removeModalRepo?.owner}/{removeModalRepo?.name}</span> from the sidebar?
            </p>
          )}
          <DialogFooter>
            <button
              onClick={() => setRemoveModalRepo(null)}
              className="cursor-pointer rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (removeModalRepo) {
                  onRemoveRepo(removeModalRepo.id)
                  setRemoveModalRepo(null)
                }
              }}
              className="cursor-pointer flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
            >
              Remove
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  )
}
