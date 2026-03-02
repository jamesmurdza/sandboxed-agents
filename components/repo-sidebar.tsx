"use client"

import { cn } from "@/lib/utils"
import type { Repo } from "@/lib/types"
import { Plus, Settings } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface RepoSidebarProps {
  repos: Repo[]
  activeRepoId: string | null
  onSelectRepo: (repoId: string) => void
  onOpenSettings: () => void
  onOpenAddRepo: () => void
}

export function RepoSidebar({ repos, activeRepoId, onSelectRepo, onOpenSettings, onOpenAddRepo }: RepoSidebarProps) {
  return (
    <TooltipProvider delayDuration={0}>
      <aside className="flex h-full w-[60px] shrink-0 flex-col items-center gap-2 border-r border-border bg-sidebar py-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <button className="mb-2 flex cursor-pointer h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground font-mono text-sm font-bold">
              Ah
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">AgentHub</TooltipContent>
        </Tooltip>

        <div className="mx-auto h-px w-8 bg-border" />

        {repos.map((repo) => {
          const isActive = repo.id === activeRepoId
          const hasRunning = repo.branches.some((b) => b.status === "running" || b.status === "creating")
          return (
            <Tooltip key={repo.id}>
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
                      {repo.owner.charAt(0).toUpperCase()}
                    </span>
                  )}
                  {hasRunning && (
                    <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-sidebar bg-primary" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {repo.owner}/{repo.name}
              </TooltipContent>
            </Tooltip>
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
    </TooltipProvider>
  )
}
