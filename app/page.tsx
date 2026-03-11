"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useSession, signOut } from "next-auth/react"
import { useRouter } from "next/navigation"
import { generateId } from "@/lib/store"
import type { Branch, Message } from "@/lib/types"
import { RepoSidebar } from "@/components/repo-sidebar"
import { BranchList } from "@/components/branch-list"
import { ChatPanel, EmptyChatPanel } from "@/components/chat-panel"
import { GitHistoryPanel } from "@/components/git-history-panel"
import { SettingsModal } from "@/components/settings-modal"
import { AddRepoModal } from "@/components/add-repo-modal"
import { MobileHeader } from "@/components/mobile-header"
import { MobileSidebarDrawer } from "@/components/mobile-sidebar-drawer"
import { DiffModal } from "@/components/diff-modal"
import { Loader2 } from "lucide-react"
import { useIsMobile } from "@/hooks/use-mobile"
import { useCrossDeviceSync } from "@/hooks/use-cross-device-sync"

// Types for database models
interface DbSandbox {
  id: string
  sandboxId: string
  contextId: string | null
  sessionId: string | null
  previewUrlPattern: string | null
  status: string
}

interface DbMessage {
  id: string
  role: string
  content: string
  toolCalls: unknown
  contentBlocks: unknown
  timestamp: string | null
  commitHash: string | null
  commitMessage: string | null
}

interface DbBranch {
  id: string
  name: string
  baseBranch: string | null
  startCommit: string | null
  status: string
  prUrl: string | null
  draftPrompt: string | null
  sandbox: DbSandbox | null
  messages?: DbMessage[]
}

interface DbRepo {
  id: string
  name: string
  owner: string
  avatar: string | null
  defaultBranch: string
  branches: DbBranch[]
}

interface Quota {
  current: number
  max: number
  remaining: number
}

interface UserCredentials {
  anthropicAuthType: string
  hasAnthropicApiKey: boolean
  hasAnthropicAuthToken: boolean
}

// Transform DB data to frontend format
function transformBranch(dbBranch: DbBranch): Branch {
  return {
    id: dbBranch.id,
    name: dbBranch.name,
    baseBranch: dbBranch.baseBranch || "main",
    startCommit: dbBranch.startCommit || undefined,
    status: dbBranch.status as Branch["status"],
    prUrl: dbBranch.prUrl || undefined,
    draftPrompt: dbBranch.draftPrompt || undefined,
    sandboxId: dbBranch.sandbox?.sandboxId,
    contextId: dbBranch.sandbox?.contextId || undefined,
    sessionId: dbBranch.sandbox?.sessionId || undefined,
    previewUrlPattern: dbBranch.sandbox?.previewUrlPattern || undefined,
    messages: (dbBranch.messages || []).map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
      toolCalls: m.toolCalls as Message["toolCalls"],
      contentBlocks: m.contentBlocks as Message["contentBlocks"],
      timestamp: m.timestamp || "",
      commitHash: m.commitHash || undefined,
      commitMessage: m.commitMessage || undefined,
    })),
  }
}

function transformRepo(dbRepo: DbRepo) {
  return {
    id: dbRepo.id,
    name: dbRepo.name,
    owner: dbRepo.owner,
    avatar: dbRepo.avatar || "",
    defaultBranch: dbRepo.defaultBranch,
    branches: (dbRepo.branches || []).map(transformBranch),
  }
}

export default function Home() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const isMobile = useIsMobile()

  const [repos, setRepos] = useState<ReturnType<typeof transformRepo>[]>([])
  const [quota, setQuota] = useState<Quota | null>(null)
  const [credentials, setCredentials] = useState<UserCredentials | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [messagesLoading, setMessagesLoading] = useState(false)

  const [activeRepoId, setActiveRepoId] = useState<string | null>(null)
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null)
  const activeBranchIdRef = useRef(activeBranchId)
  activeBranchIdRef.current = activeBranchId

  const [branchListWidth, setBranchListWidth] = useState(260)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [addRepoOpen, setAddRepoOpen] = useState(false)
  const [gitHistoryOpen, setGitHistoryOpen] = useState(false)
  const [gitHistoryRefreshTrigger, setGitHistoryRefreshTrigger] = useState(0)
  const [pendingStartCommit, setPendingStartCommit] = useState<string | null>(null)

  // Mobile-specific state
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [mobileSandboxToggleLoading, setMobileSandboxToggleLoading] = useState(false)
  const [mobilePrLoading, setMobilePrLoading] = useState(false)
  const [mobileDiffOpen, setMobileDiffOpen] = useState(false)
  const [mobileMergeOpen, setMobileMergeOpen] = useState(false)
  const [mobileRebaseOpen, setMobileRebaseOpen] = useState(false)
  const [mobileTagOpen, setMobileTagOpen] = useState(false)
  const [mobileResetOpen, setMobileResetOpen] = useState(false)

  // Redirect to login if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login")
    }
  }, [status, router])

  // Fetch user data on mount
  useEffect(() => {
    if (status !== "authenticated") return

    fetch("/api/user/me", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to fetch user data: ${r.status}`)
        return r.json()
      })
      .then((data) => {
        if (data.repos) {
          const transformedRepos = data.repos.map(transformRepo)
          setRepos(transformedRepos)
        }
        if (data.quota) {
          setQuota(data.quota)
        }
        if (data.credentials) {
          setCredentials(data.credentials)
        }
        setLoaded(true)
      })
      .catch((err) => {
        console.error("Failed to fetch user data:", err)
        setLoaded(true)
      })
  }, [status])

  // Auto-select first repo/branch on load
  useEffect(() => {
    if (loaded && repos.length > 0 && !activeRepoId) {
      setActiveRepoId(repos[0].id)
      if (repos[0].branches.length > 0) {
        setActiveBranchId(repos[0].branches[0].id)
      }
    }
  }, [loaded, repos, activeRepoId])

  // Load messages when active branch changes (messages aren't included in initial /api/user/me fetch)
  useEffect(() => {
    if (!activeBranchId || !activeRepoId) return

    // Skip if branch already has messages loaded
    const repo = repos.find((r) => r.id === activeRepoId)
    const branch = repo?.branches.find((b) => b.id === activeBranchId)
    if (!branch) return
    if (branch.messages.length > 0) return

    setMessagesLoading(true)
    fetch(`/api/branches/messages?branchId=${activeBranchId}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to fetch messages: ${r.status}`)
        return r.json()
      })
      .then((data) => {
        if (data.messages && data.messages.length > 0) {
          setRepos((prev) =>
            prev.map((r) => {
              if (r.id !== activeRepoId) return r
              return {
                ...r,
                branches: r.branches.map((b) => {
                  if (b.id !== activeBranchId) return b
                  return {
                    ...b,
                    messages: data.messages.map((m: DbMessage) => ({
                      id: m.id,
                      role: m.role as "user" | "assistant",
                      content: m.content,
                      toolCalls: m.toolCalls as Message["toolCalls"],
                      contentBlocks: m.contentBlocks as Message["contentBlocks"],
                      timestamp: m.timestamp || "",
                      commitHash: m.commitHash || undefined,
                      commitMessage: m.commitMessage || undefined,
                    })),
                  }
                }),
              }
            })
          )
        }
      })
      .catch((err) => console.error("Failed to load messages:", err))
      .finally(() => setMessagesLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBranchId])

  // Dynamic page title with agent counts
  useEffect(() => {
    const allBranches = repos.flatMap((r) => r.branches)
    const running = allBranches.filter((b) => b.status === "running").length
    const parts: string[] = []
    if (running > 0) parts.push(`${running} running`)
    if (running === 0) parts.push("0 running")
    document.title = parts.join(", ")
  }, [repos])

  // Auto-open settings if Anthropic credentials not configured
  useEffect(() => {
    if (
      loaded &&
      (
        !credentials ||
        (!credentials.hasAnthropicApiKey && !credentials.hasAnthropicAuthToken)
      )
    ) {
      setSettingsOpen(true)
    }
  }, [loaded, credentials])

  const activeRepo = repos.find((r) => r.id === activeRepoId) ?? null
  const activeBranch = activeBranchId && activeRepo
    ? activeRepo.branches.find((b) => b.id === activeBranchId) ?? null
    : null

  function handleSelectRepo(repoId: string) {
    setActiveRepoId(repoId)
    const repo = repos.find((r) => r.id === repoId)
    setActiveBranchId(repo?.branches[0]?.id ?? null)
  }

  function handleSelectBranch(branchId: string) {
    setActiveBranchId(branchId)
  }

  function handleAddRepo(repo: ReturnType<typeof transformRepo>) {
    setRepos((prev) => [...prev, repo])
    setActiveRepoId(repo.id)
    setActiveBranchId(null)
  }

  function handleRemoveRepo(repoId: string) {
    const repo = repos.find((r) => r.id === repoId)
    if (!repo) return

    // Clean up sandboxes for all branches
    for (const branch of repo.branches) {
      if (branch.sandboxId) {
        fetch("/api/sandbox/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sandboxId: branch.sandboxId }),
        }).catch(() => {})
      }
    }

    // Delete repo from database
    fetch(`/api/repos?id=${repoId}`, { method: "DELETE" }).catch(() => {})

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
  }, [activeRepo])

  const handleQuotaRefresh = useCallback(() => {
    fetch("/api/user/quota")
      .then((r) => r.json())
      .then((q) => setQuota(q))
      .catch(() => {})
  }, [])

  const handleUpdateBranch = useCallback((branchId: string, updates: Partial<Branch>) => {
    if (!activeRepo) return

    // Find the branch to check its current status
    const branch = activeRepo.branches.find((b) => b.id === branchId)
    const isBeingCreated = branch?.status === "creating"

    // The actual ID to use for database operations (might be a new server-side ID)
    const dbBranchId = updates.id || branchId

    setRepos((prev) =>
      prev.map((r) => {
        if (r.id !== activeRepo.id) return r
        return {
          ...r,
          branches: r.branches.map((b) => {
            if (b.id !== branchId) return b
            // If updates include a new id, use it to replace the branch id
            const newBranch = { ...b, ...updates }
            if (updates.id) {
              newBranch.id = updates.id
            }
            return newBranch
          }),
        }
      })
    )

    // Also update activeBranchId if it's being replaced
    if (updates.id && activeBranchIdRef.current === branchId) {
      setActiveBranchId(updates.id)
    }

    // Only update in database if branch exists there (not during creation)
    // When id is provided, we're transitioning from client-side to server-side ID
    const shouldPersist = !isBeingCreated || updates.id
    if (shouldPersist && (updates.status || updates.prUrl || updates.name || updates.draftPrompt !== undefined)) {
      fetch("/api/branches", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId: dbBranchId, ...updates }),
      }).catch(() => {})
    }
  }, [activeRepo])

  const handleRemoveBranch = useCallback((branchId: string, deleteRemote?: boolean) => {
    if (!activeRepo) return
    const branch = activeRepo.branches.find((b) => b.id === branchId)

    if (branch?.sandboxId) {
      fetch("/api/sandbox/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandboxId: branch.sandboxId }),
      }).catch(() => {})

      if (deleteRemote && branch) {
        fetch("/api/sandbox/git", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sandboxId: branch.sandboxId,
            repoPath: `/home/daytona/${activeRepo.name}`,
            action: "delete-remote-branch",
            currentBranch: branch.name,
            repoOwner: activeRepo.owner,
            repoApiName: activeRepo.name,
          }),
        }).catch(() => {})
      }
    }

    // Delete from database
    fetch(`/api/branches?id=${branchId}`, { method: "DELETE" }).catch(() => {})

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

    // Refresh quota
    fetch("/api/user/quota")
      .then((r) => r.json())
      .then((q) => setQuota(q))
      .catch(() => {})
  }, [activeRepo, activeBranchId])

  // Save draft for a specific branch (used when switching branches to persist the previous branch's draft)
  const handleSaveDraftForBranch = useCallback((branchId: string, draftPrompt: string) => {
    if (!activeRepo) return

    // Update local state
    setRepos((prev) =>
      prev.map((r) => {
        if (r.id !== activeRepo.id) return r
        return {
          ...r,
          branches: r.branches.map((b) => {
            if (b.id !== branchId) return b
            return { ...b, draftPrompt }
          }),
        }
      })
    )

    // Persist to database
    fetch("/api/branches", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branchId, draftPrompt }),
    }).catch(() => {})
  }, [activeRepo])

  const handleAddMessage = useCallback(async (branchId: string, message: Message): Promise<string> => {
    if (!activeRepo) return message.id

    // Add message to local state immediately with temporary ID
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
            }
          }),
        }
      })
    )

    // Save message to database and get the real DB ID
    try {
      const res = await fetch("/api/branches/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId,
          role: message.role,
          content: message.content,
          toolCalls: message.toolCalls,
          contentBlocks: message.contentBlocks,
          timestamp: message.timestamp,
          commitHash: message.commitHash,
          commitMessage: message.commitMessage,
        }),
      })

      if (!res.ok) {
        const errorText = await res.text().catch(() => res.statusText)
        throw new Error(`Failed to save message: ${errorText}`)
      }

      const data = await res.json()
      const dbId = data.message?.id

      if (dbId && dbId !== message.id) {
        // Update local state with the real database ID
        setRepos((prev) =>
          prev.map((r) => {
            if (r.id !== activeRepo.id) return r
            return {
              ...r,
              branches: r.branches.map((b) => {
                if (b.id !== branchId) return b
                return {
                  ...b,
                  messages: b.messages.map((m) =>
                    m.id === message.id ? { ...m, id: dbId } : m
                  ),
                }
              }),
            }
          })
        )
        return dbId
      }
      return message.id
    } catch (error) {
      console.error("Error saving message to database:", error)
      // Re-throw so caller knows message wasn't saved - prevents foreign key errors
      throw error
    }
  }, [activeRepo])

  const handleUpdateMessage = useCallback((branchId: string, messageId: string, updates: Partial<Message>) => {
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
              messages: b.messages.map((m) =>
                m.id === messageId ? { ...m, ...updates } : m
              ),
            }
          }),
        }
      })
    )

    // Update message in database
    fetch("/api/branches/messages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageId,
        content: updates.content,
        toolCalls: updates.toolCalls,
        contentBlocks: updates.contentBlocks,
      }),
    }).catch((error) => {
      console.error("Error updating message in database:", error)
    })
  }, [activeRepo])

  const handleCredentialsUpdate = useCallback(() => {
    // Refresh credentials state
    fetch("/api/user/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.credentials) {
          setCredentials(data.credentials)
        }
      })
      .catch(() => {})
  }, [])

  // Mobile-specific handlers
  const handleMobileSandboxToggle = useCallback(async () => {
    if (!activeBranch?.sandboxId || mobileSandboxToggleLoading) return
    const isStopped = activeBranch.status === "stopped"
    setMobileSandboxToggleLoading(true)
    try {
      const res = await fetch("/api/sandbox/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId: activeBranch.sandboxId,
          action: isStopped ? "start" : "stop",
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      handleUpdateBranch(activeBranch.id, { status: isStopped ? "idle" : "stopped" })
    } catch {
      // ignore
    } finally {
      setMobileSandboxToggleLoading(false)
    }
  }, [activeBranch, mobileSandboxToggleLoading, handleUpdateBranch])

  const handleMobileCreatePR = useCallback(async () => {
    if (!activeBranch || !activeRepo) return
    // If PR already exists, just open it
    if (activeBranch.prUrl) {
      window.open(activeBranch.prUrl, "_blank")
      return
    }
    setMobilePrLoading(true)
    try {
      const res = await fetch("/api/github/pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: activeRepo.owner,
          repo: activeRepo.name,
          head: activeBranch.name,
          base: activeBranch.baseBranch,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      handleUpdateBranch(activeBranch.id, { prUrl: data.url })
      window.open(data.url, "_blank")
    } catch {
      // Silently fail
    } finally {
      setMobilePrLoading(false)
    }
  }, [activeBranch, activeRepo, handleUpdateBranch])

  // Cross-device sync - polls for changes from other devices
  // Using a ref to track last message IDs to detect new messages
  const lastMessageIdsRef = useRef<Map<string, string | null>>(new Map())

  const handleSyncData = useCallback((
    data: { repos: Array<{ id: string; name: string; owner: string; avatar: string | null; defaultBranch: string; branches: Array<{ id: string; name: string; status: string; baseBranch: string | null; prUrl: string | null; sandboxId: string | null; lastMessageId: string | null }> }> },
    lastData: typeof data | null
  ) => {
    // Skip first sync (just populate baseline)
    if (!lastData) {
      // Initialize message ID tracking
      for (const repo of data.repos) {
        for (const branch of repo.branches) {
          lastMessageIdsRef.current.set(branch.id, branch.lastMessageId)
        }
      }
      return
    }

    const lastRepoMap = new Map(lastData.repos.map((r) => [r.id, r]))
    const currentRepoMap = new Map(data.repos.map((r) => [r.id, r]))

    // Check for repo changes
    const reposChanged =
      data.repos.length !== lastData.repos.length ||
      data.repos.some((r) => !lastRepoMap.has(r.id)) ||
      lastData.repos.some((r) => !currentRepoMap.has(r.id))

    if (reposChanged) {
      // Repos added or removed - update the full list
      setRepos((prev) => {
        const newRepos = data.repos.map((syncRepo) => {
          // Try to preserve existing local data (messages, etc)
          const existing = prev.find((r) => r.id === syncRepo.id)
          if (existing) {
            // Update branches while preserving messages
            return {
              ...existing,
              branches: syncRepo.branches.map((syncBranch) => {
                const existingBranch = existing.branches.find((b) => b.id === syncBranch.id)
                if (existingBranch) {
                  return {
                    ...existingBranch,
                    status: syncBranch.status as Branch["status"],
                    prUrl: syncBranch.prUrl || undefined,
                    sandboxId: syncBranch.sandboxId || undefined,
                  }
                }
                // New branch from sync
                return {
                  id: syncBranch.id,
                  name: syncBranch.name,
                  status: syncBranch.status as Branch["status"],
                  baseBranch: syncBranch.baseBranch || "main",
                  prUrl: syncBranch.prUrl || undefined,
                  sandboxId: syncBranch.sandboxId || undefined,
                  messages: [],
                }
              }),
            }
          }
          // New repo from sync
          return {
            id: syncRepo.id,
            name: syncRepo.name,
            owner: syncRepo.owner,
            avatar: syncRepo.avatar || "",
            defaultBranch: syncRepo.defaultBranch,
            branches: syncRepo.branches.map((b) => ({
              id: b.id,
              name: b.name,
              status: b.status as Branch["status"],
              baseBranch: b.baseBranch || "main",
              prUrl: b.prUrl || undefined,
              sandboxId: b.sandboxId || undefined,
              messages: [],
            })),
          }
        })
        return newRepos
      })
    } else {
      // No repo-level changes, check for branch-level changes
      for (const syncRepo of data.repos) {
        const lastRepo = lastRepoMap.get(syncRepo.id)
        if (!lastRepo) continue

        const lastBranchMap = new Map(lastRepo.branches.map((b) => [b.id, b]))
        const currentBranchMap = new Map(syncRepo.branches.map((b) => [b.id, b]))

        // Check for branch additions/removals
        const branchesChanged =
          syncRepo.branches.length !== lastRepo.branches.length ||
          syncRepo.branches.some((b) => !lastBranchMap.has(b.id)) ||
          lastRepo.branches.some((b) => !currentBranchMap.has(b.id))

        if (branchesChanged) {
          // Update this repo's branches
          setRepos((prev) =>
            prev.map((r) => {
              if (r.id !== syncRepo.id) return r
              return {
                ...r,
                branches: syncRepo.branches.map((syncBranch) => {
                  const existingBranch = r.branches.find((b) => b.id === syncBranch.id)
                  if (existingBranch) {
                    return {
                      ...existingBranch,
                      status: syncBranch.status as Branch["status"],
                      prUrl: syncBranch.prUrl || undefined,
                    }
                  }
                  return {
                    id: syncBranch.id,
                    name: syncBranch.name,
                    status: syncBranch.status as Branch["status"],
                    baseBranch: syncBranch.baseBranch || "main",
                    prUrl: syncBranch.prUrl || undefined,
                    sandboxId: syncBranch.sandboxId || undefined,
                    messages: [],
                  }
                }),
              }
            })
          )
        } else {
          // Check for individual branch updates (status, prUrl, messages)
          for (const syncBranch of syncRepo.branches) {
            const lastBranch = lastBranchMap.get(syncBranch.id)
            if (!lastBranch) continue

            // Status change
            if (lastBranch.status !== syncBranch.status) {
              setRepos((prev) =>
                prev.map((r) => ({
                  ...r,
                  branches: r.branches.map((b) =>
                    b.id === syncBranch.id ? { ...b, status: syncBranch.status as Branch["status"] } : b
                  ),
                }))
              )
            }

            // PR URL change
            if (!lastBranch.prUrl && syncBranch.prUrl) {
              setRepos((prev) =>
                prev.map((r) => ({
                  ...r,
                  branches: r.branches.map((b) =>
                    b.id === syncBranch.id ? { ...b, prUrl: syncBranch.prUrl || undefined } : b
                  ),
                }))
              )
            }

            // New message detection
            const lastKnownMessageId = lastMessageIdsRef.current.get(syncBranch.id)
            if (syncBranch.lastMessageId && syncBranch.lastMessageId !== lastKnownMessageId) {
              lastMessageIdsRef.current.set(syncBranch.id, syncBranch.lastMessageId)

              // Mark as unread if not active branch
              if (syncBranch.id !== activeBranchIdRef.current) {
                setRepos((prev) =>
                  prev.map((r) => ({
                    ...r,
                    branches: r.branches.map((b) =>
                      b.id === syncBranch.id ? { ...b, unread: true } : b
                    ),
                  }))
                )
              } else {
                // Reload messages for active branch
                fetch(`/api/branches/messages?branchId=${syncBranch.id}`)
                  .then((r) => r.json())
                  .then((msgData) => {
                    if (msgData.messages) {
                      setRepos((prev) =>
                        prev.map((r) => ({
                          ...r,
                          branches: r.branches.map((b) => {
                            if (b.id !== syncBranch.id) return b
                            return {
                              ...b,
                              messages: msgData.messages.map((m: DbMessage) => ({
                                id: m.id,
                                role: m.role as "user" | "assistant",
                                content: m.content,
                                toolCalls: m.toolCalls as Message["toolCalls"],
                                contentBlocks: m.contentBlocks as Message["contentBlocks"],
                                timestamp: m.timestamp || "",
                                commitHash: m.commitHash || undefined,
                                commitMessage: m.commitMessage || undefined,
                              })),
                            }
                          }),
                        }))
                      )
                    }
                  })
                  .catch(() => {})
              }
            }
          }
        }
      }
    }

    // Update message ID tracking for next sync
    for (const repo of data.repos) {
      for (const branch of repo.branches) {
        lastMessageIdsRef.current.set(branch.id, branch.lastMessageId)
      }
    }
  }, [])

  useCrossDeviceSync({
    enabled: loaded,
    interval: 5000,
    onSyncData: handleSyncData,
  })

  // Loading state
  if (status === "loading" || !loaded) {
    return (
      <main className="flex h-dvh items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </main>
    )
  }

  // Not authenticated - will redirect
  if (status === "unauthenticated") {
    return (
      <main className="flex h-dvh items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Redirecting to login...</div>
      </main>
    )
  }

  return (
    <>
      <main className="flex h-dvh overflow-hidden">
        {/* Repo Sidebar - desktop only */}
        {!isMobile && (
          <RepoSidebar
            repos={repos}
            activeRepoId={activeRepoId}
            userAvatar={session?.user?.image || null}
            userName={session?.user?.name || null}
            userLogin={session?.user?.githubLogin || null}
            onSelectRepo={handleSelectRepo}
            onRemoveRepo={handleRemoveRepo}
            onReorderRepos={(from, to) => {
              setRepos((prev) => {
                const next = [...prev]
                const [moved] = next.splice(from, 1)
                next.splice(to, 0, moved)
                return next
              })
            }}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenAddRepo={() => setAddRepoOpen(true)}
            onSignOut={() => signOut({ callbackUrl: "/login" })}
            quota={quota}
          />
        )}

        {/* Mobile Sidebar Drawer */}
        {isMobile && (
          <MobileSidebarDrawer
            open={mobileSidebarOpen}
            onOpenChange={setMobileSidebarOpen}
            repos={repos}
            activeRepoId={activeRepoId}
            activeBranchId={activeBranchId}
            userAvatar={session?.user?.image || null}
            userName={session?.user?.name || null}
            userLogin={session?.user?.githubLogin || null}
            onSelectRepo={handleSelectRepo}
            onSelectBranch={handleSelectBranch}
            onRemoveRepo={handleRemoveRepo}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenAddRepo={() => setAddRepoOpen(true)}
            onSignOut={() => signOut({ callbackUrl: "/login" })}
            quota={quota}
            onAddBranch={handleAddBranch}
            onUpdateBranch={handleUpdateBranch}
            onQuotaRefresh={handleQuotaRefresh}
          />
        )}

        {/* Desktop: Branch List (always visible) */}
        <div className="hidden sm:flex">
          {activeRepo ? (
            <BranchList
              repo={activeRepo}
              activeBranchId={activeBranchId}
              onSelectBranch={handleSelectBranch}
              onAddBranch={handleAddBranch}
              onRemoveBranch={handleRemoveBranch}
              onUpdateBranch={handleUpdateBranch}
              onQuotaRefresh={handleQuotaRefresh}
              width={branchListWidth}
              onWidthChange={setBranchListWidth}
              pendingStartCommit={pendingStartCommit}
              onClearPendingCommit={() => setPendingStartCommit(null)}
              quota={quota}
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

        {/* Mobile: Header + Chat (Slack-like layout) */}
        {isMobile && (
          <div className="flex flex-1 flex-col min-h-0 min-w-0 w-full max-w-full overflow-hidden sm:hidden">
            {/* Mobile Header with hamburger and actions */}
            <MobileHeader
              repoOwner={activeRepo?.owner || null}
              repoName={activeRepo?.name || null}
              branch={activeBranch}
              onOpenSidebar={() => setMobileSidebarOpen(true)}
              onToggleGitHistory={() => setGitHistoryOpen((v) => !v)}
              onOpenDiff={() => setMobileDiffOpen(true)}
              onCreatePR={handleMobileCreatePR}
              onSandboxToggle={handleMobileSandboxToggle}
              onMerge={() => setMobileMergeOpen(true)}
              onRebase={() => setMobileRebaseOpen(true)}
              onReset={() => setMobileResetOpen(true)}
              onTag={() => setMobileTagOpen(true)}
              gitHistoryOpen={gitHistoryOpen}
              sandboxToggleLoading={mobileSandboxToggleLoading}
              prLoading={mobilePrLoading}
            />

            {/* Chat content */}
            <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
              {activeBranch && activeRepo ? (
                <ChatPanel
                  branch={activeBranch}
                  repoFullName={`${activeRepo.owner}/${activeRepo.name}`}
                  repoName={activeRepo.name}
                  repoOwner={activeRepo.owner}
                  gitHistoryOpen={gitHistoryOpen}
                  onToggleGitHistory={() => setGitHistoryOpen((v) => !v)}
                  onAddMessage={(msg) => handleAddMessage(activeBranch.id, msg)}
                  onUpdateMessage={(messageId, updates) =>
                    handleUpdateMessage(activeBranch.id, messageId, updates)
                  }
                  onUpdateBranch={(updates) =>
                    handleUpdateBranch(activeBranch.id, updates)
                  }
                  onSaveDraftForBranch={handleSaveDraftForBranch}
                  onForceSave={() => {}}
                  onCommitsDetected={() => setGitHistoryRefreshTrigger((n) => n + 1)}
                  onBranchFromCommit={(hash) => setPendingStartCommit(hash)}
                  messagesLoading={messagesLoading}
                  isMobile={true}
                />
              ) : (
                <EmptyChatPanel hasRepos={repos.length > 0} />
              )}
            </div>
          </div>
        )}

        {/* Desktop: Main content area */}
        <div className="hidden sm:flex min-w-0 flex-1">
          {activeBranch && activeRepo ? (
            <ChatPanel
              branch={activeBranch}
              repoFullName={`${activeRepo.owner}/${activeRepo.name}`}
              repoName={activeRepo.name}
              repoOwner={activeRepo.owner}
              gitHistoryOpen={gitHistoryOpen}
              onToggleGitHistory={() => setGitHistoryOpen((v) => !v)}
              onAddMessage={(msg) => handleAddMessage(activeBranch.id, msg)}
              onUpdateMessage={(messageId, updates) =>
                handleUpdateMessage(activeBranch.id, messageId, updates)
              }
              onUpdateBranch={(updates) =>
                handleUpdateBranch(activeBranch.id, updates)
              }
              onSaveDraftForBranch={handleSaveDraftForBranch}
              onForceSave={() => {}}
              onCommitsDetected={() => setGitHistoryRefreshTrigger((n) => n + 1)}
              onBranchFromCommit={(hash) => setPendingStartCommit(hash)}
              messagesLoading={messagesLoading}
            />
          ) : (
            <EmptyChatPanel hasRepos={repos.length > 0} />
          )}

          {gitHistoryOpen && activeBranch?.sandboxId && activeRepo && (
            <GitHistoryPanel
              sandboxId={activeBranch.sandboxId}
              repoName={activeRepo.name}
              baseBranch={activeBranch.baseBranch}
              onClose={() => setGitHistoryOpen(false)}
              refreshTrigger={gitHistoryRefreshTrigger}
              onScrollToCommit={(shortHash) => {
                document.getElementById(`commit-${shortHash}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
              }}
              onBranchFromCommit={(commitHash) => setPendingStartCommit(commitHash)}
            />
          )}
        </div>
      </main>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        credentials={credentials}
        onCredentialsUpdate={handleCredentialsUpdate}
      />
      <AddRepoModal
        open={addRepoOpen}
        onClose={() => setAddRepoOpen(false)}
        githubUser={session?.user?.githubLogin || null}
        existingRepos={repos}
        onAddRepo={handleAddRepo}
        onSelectExistingRepo={handleSelectRepo}
      />

      {/* Mobile Diff Modal */}
      {isMobile && activeRepo && activeBranch && (
        <DiffModal
          open={mobileDiffOpen}
          onClose={() => setMobileDiffOpen(false)}
          repoOwner={activeRepo.owner}
          repoName={activeRepo.name}
          branchName={activeBranch.name}
          baseBranch={activeBranch.baseBranch || activeRepo.defaultBranch}
        />
      )}
    </>
  )
}
