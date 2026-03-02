"use client"

import { useState, useEffect, useCallback } from "react"
import { useStore, generateId } from "@/lib/store"
import type { Repo, Branch, Message, Settings, ToolCall } from "@/lib/types"
import { RepoSidebar } from "@/components/repo-sidebar"
import { BranchList } from "@/components/branch-list"
import { ChatPanel, EmptyChatPanel } from "@/components/chat-panel"
import { SettingsModal } from "@/components/settings-modal"
import { AddRepoModal } from "@/components/add-repo-modal"

export default function Home() {
  const { repos, settings, loaded, setRepos, setSettings, forceSave } = useStore()
  const [activeRepoId, setActiveRepoId] = useState<string | null>(null)
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null)
  const [mobileView, setMobileView] = useState<"branches" | "chat">("branches")
  const [branchListWidth, setBranchListWidth] = useState(260)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [addRepoOpen, setAddRepoOpen] = useState(false)

  // Auto-select first repo on load
  useEffect(() => {
    if (loaded && repos.length > 0 && !activeRepoId) {
      setActiveRepoId(repos[0].id)
      if (repos[0].branches.length > 0) {
        setActiveBranchId(repos[0].branches[0].id)
      }
    }
  }, [loaded, repos, activeRepoId])

  // Auto-open settings if not configured
  useEffect(() => {
    if (loaded && !settings.daytonaApiKey && !settings.anthropicApiKey) {
      setSettingsOpen(true)
    }
  }, [loaded, settings])

  const activeRepo = repos.find((r) => r.id === activeRepoId) ?? null
  const activeBranch = activeBranchId && activeRepo
    ? activeRepo.branches.find((b) => b.id === activeBranchId) ?? null
    : null

  function handleSelectRepo(repoId: string) {
    setActiveRepoId(repoId)
    const repo = repos.find((r) => r.id === repoId)
    setActiveBranchId(repo?.branches[0]?.id ?? null)
    setMobileView("branches")
  }

  function handleSelectBranch(branchId: string) {
    // Mark as read
    if (activeRepo) {
      setRepos((prev) =>
        prev.map((r) => {
          if (r.id !== activeRepo.id) return r
          return {
            ...r,
            branches: r.branches.map((b) => {
              if (b.id !== branchId) return b
              return { ...b, unread: false }
            }),
          }
        })
      )
    }
    setActiveBranchId(branchId)
    setMobileView("chat")
  }

  function handleAddRepo(repo: Repo) {
    setRepos((prev) => [...prev, repo])
    setActiveRepoId(repo.id)
    setActiveBranchId(null)
  }

  function handleRemoveRepo(repoId: string) {
    setRepos((prev) => prev.filter((r) => r.id !== repoId))
    if (activeRepoId === repoId) {
      const remaining = repos.filter((r) => r.id !== repoId)
      setActiveRepoId(remaining[0]?.id ?? null)
      setActiveBranchId(null)
    }
  }

  const handleAddBranch = useCallback((branch: Branch) => {
    if (!activeRepo) return
    setRepos((prev) =>
      prev.map((r) => {
        if (r.id !== activeRepo.id) return r
        return { ...r, branches: [...r.branches, branch] }
      })
    )
    setActiveBranchId(branch.id)
    setMobileView("chat")
  }, [activeRepo, setRepos])

  const handleUpdateBranch = useCallback((branchId: string, updates: Partial<Branch>) => {
    if (!activeRepo) return
    setRepos((prev) =>
      prev.map((r) => {
        if (r.id !== activeRepo.id) return r
        return {
          ...r,
          branches: r.branches.map((b) => {
            if (b.id !== branchId) return b
            return { ...b, ...updates }
          }),
        }
      })
    )
  }, [activeRepo, setRepos])

  const handleRemoveBranch = useCallback((branchId: string) => {
    if (!activeRepo) return
    // Delete sandbox if exists
    const branch = activeRepo.branches.find((b) => b.id === branchId)
    if (branch?.sandboxId && settings.daytonaApiKey) {
      fetch("/api/sandbox/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daytonaApiKey: settings.daytonaApiKey,
          sandboxId: branch.sandboxId,
        }),
      }).catch(() => {}) // Best effort cleanup
    }
    setRepos((prev) =>
      prev.map((r) => {
        if (r.id !== activeRepo.id) return r
        return {
          ...r,
          branches: r.branches.filter((b) => b.id !== branchId),
        }
      })
    )
    if (activeBranchId === branchId) {
      const remaining = activeRepo.branches.filter((b) => b.id !== branchId)
      setActiveBranchId(remaining[0]?.id ?? null)
    }
  }, [activeRepo, activeBranchId, settings.daytonaApiKey, setRepos])

  const handleAddMessage = useCallback((branchId: string, message: Message) => {
    if (!activeRepo) return
    setRepos((prev) =>
      prev.map((r) => {
        if (r.id !== activeRepo.id) return r
        return {
          ...r,
          branches: r.branches.map((b) => {
            if (b.id !== branchId) return b
            return {
              ...b,
              messages: [...b.messages, message],
              lastActivity: "now",
            }
          }),
        }
      })
    )
  }, [activeRepo, setRepos])

  const handleUpdateLastMessage = useCallback((branchId: string, updates: Partial<Message>) => {
    if (!activeRepo) return
    setRepos((prev) =>
      prev.map((r) => {
        if (r.id !== activeRepo.id) return r
        return {
          ...r,
          branches: r.branches.map((b) => {
            if (b.id !== branchId) return b
            const msgs = [...b.messages]
            if (msgs.length > 0) {
              msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], ...updates }
            }
            return { ...b, messages: msgs }
          }),
        }
      })
    )
  }, [activeRepo, setRepos])

  if (!loaded) {
    return (
      <main className="flex h-dvh items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </main>
    )
  }

  return (
    <>
      <main className="flex h-dvh overflow-hidden">
        <RepoSidebar
          repos={repos}
          activeRepoId={activeRepoId}
          onSelectRepo={handleSelectRepo}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenAddRepo={() => setAddRepoOpen(true)}
        />

        <div className="hidden sm:flex">
          {activeRepo ? (
            <BranchList
              repo={activeRepo}
              activeBranchId={activeBranchId}
              onSelectBranch={handleSelectBranch}
              onAddBranch={handleAddBranch}
              onRemoveBranch={handleRemoveBranch}
              onUpdateBranch={handleUpdateBranch}
              settings={settings}
              width={branchListWidth}
              onWidthChange={setBranchListWidth}
            />
          ) : (
            <div
              className="flex h-full shrink-0 flex-col items-center justify-center border-r border-border bg-card text-muted-foreground"
              style={{ width: branchListWidth }}
            >
              <p className="text-xs">Add a repository to get started</p>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1">
          {activeBranch && activeRepo ? (
            <ChatPanel
              branch={activeBranch}
              repoFullName={`${activeRepo.owner}/${activeRepo.name}`}
              settings={settings}
              onAddMessage={(msg) => handleAddMessage(activeBranch.id, msg)}
              onUpdateLastMessage={(updates) =>
                handleUpdateLastMessage(activeBranch.id, updates)
              }
              onUpdateBranch={(updates) =>
                handleUpdateBranch(activeBranch.id, updates)
              }
              onForceSave={forceSave}
              onBack={() => setMobileView("branches")}
            />
          ) : (
            <EmptyChatPanel hasRepos={repos.length > 0} />
          )}
        </div>
      </main>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSave={setSettings}
      />
      <AddRepoModal
        open={addRepoOpen}
        onClose={() => setAddRepoOpen(false)}
        settings={settings}
        onAddRepo={handleAddRepo}
      />
    </>
  )
}
