"use client"

import { cn } from "@/lib/utils"
import type { Repo } from "@/lib/types"
import { Plus, X } from "lucide-react"
import { useState, useRef } from "react"
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
  onReorderRepos: (fromIndex: number, toIndex: number) => void
  onOpenSettings: () => void
  onOpenAddRepo: () => void
}

export function RepoSidebar({
  repos,
  activeRepoId,
  userAvatar,
  onSelectRepo,
  onRemoveRepo,
  onReorderRepos,
  onOpenSettings,
  onOpenAddRepo,
}: RepoSidebarProps) {
  const [removeModalRepo, setRemoveModalRepo] = useState<Repo | null>(null)
  const dragIndexRef = useRef<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  return (
    <TooltipProvider delayDuration={0}>
      <aside className="flex h-full w-[60px] shrink-0 flex-col items-center gap-2 border-r border-border bg-sidebar py-3">
        {repos.map((repo, index) => {
          const isActive = repo.id === activeRepoId
          const hasRunning = repo.branches.some((b) => b.status === "running" || b.status === "creating")
          const initials = (repo.owner[0] + repo.name[0]).toUpperCase()
          return (
            <div
              key={repo.id}
              className={cn("relative group", dragOverIndex === index && "opacity-50")}
              draggable
              onDragStart={() => { dragIndexRef.current = index }}
              onDragOver={(e) => { e.preventDefault(); setDragOverIndex(index) }}
              onDragLeave={() => setDragOverIndex(null)}
              onDrop={() => {
                if (dragIndexRef.current !== null && dragIndexRef.current !== index) {
                  onReorderRepos(dragIndexRef.current, index)
                }
                dragIndexRef.current = null
                setDragOverIndex(null)
              }}
              onDragEnd={() => { dragIndexRef.current = null; setDragOverIndex(null) }}
            >
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
                    <span className={cn(
                      "flex h-full w-full items-center justify-center rounded-lg",
                      isActive
                        ? "bg-accent text-foreground"
                        : "bg-secondary text-muted-foreground"
                    )}>
                      {initials}
                    </span>
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
                  if (repo.branches.length === 0) {
                    onRemoveRepo(repo.id)
                    return
                  }
                  setRemoveModalRepo(repo)
                }}
                className="absolute -right-1 -top-1 flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-all z-10 opacity-0 group-hover:opacity-100 hover:text-foreground"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          )
        })}

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

        <div className="mt-auto flex flex-col items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onOpenSettings}
                className="flex cursor-pointer h-10 w-10 items-center justify-center rounded-lg overflow-hidden transition-colors hover:ring-2 hover:ring-primary/50"
              >
                {userAvatar ? (
                  <img src={userAvatar} alt="Settings" className="h-full w-full rounded-lg object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center rounded-lg bg-primary text-primary-foreground font-mono text-sm font-bold">
                    Ah
                  </span>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Settings</TooltipContent>
          </Tooltip>
        </div>
      </aside>

      {/* Remove repo confirmation modal — only shown if repo has chats */}
      <Dialog open={!!removeModalRepo} onOpenChange={(open) => !open && setRemoveModalRepo(null)}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">Remove repository?</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            {removeModalRepo && removeModalRepo.branches.length > 0 ? (
              <>This will delete {removeModalRepo.branches.length} chat{removeModalRepo.branches.length !== 1 ? "s" : ""} and their sandboxes for <span className="font-semibold text-foreground">{removeModalRepo.owner}/{removeModalRepo.name}</span>. Branches on GitHub will not be affected.</>
            ) : (
              <>Remove <span className="font-semibold text-foreground">{removeModalRepo?.owner}/{removeModalRepo?.name}</span> from the sidebar?</>
            )}
          </p>
          <DialogFooter className="gap-2">
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
