"use client"

import { cn } from "@/lib/utils"
import type { Branch, Message, ToolCall } from "@/lib/types"
import { generateId } from "@/lib/store"
import {
  FileText,
  Pencil,
  FilePlus,
  Search,
  Terminal,
  GitPullRequest,
  Send,
  Loader2,
  GitMerge,
  GitCompareArrows,
  Tag,
  RotateCcw,
  History,
  Diff,
  FolderSearch,
  Regex,
  AlertCircle,
  GitCommitHorizontal,
  GitBranch,
  Copy,
  Check,
  FolderSync,
  Play,
  Pause,
} from "lucide-react"
import { useRef, useEffect, useCallback } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { DiffModal } from "@/components/diff-modal"

// Import hooks
import { useDraftSync, useExecutionPolling, useGitActions, useBranchRenaming } from "./chat/hooks"

// ============================================================================
// Sub-components
// ============================================================================

function ToolCallIcon({ tool }: { tool: string }) {
  const cls = "h-3 w-3"
  switch (tool) {
    case "Read":
      return <FileText className={cls} />
    case "Edit":
      return <Pencil className={cls} />
    case "Write":
      return <FilePlus className={cls} />
    case "Glob":
      return <FolderSearch className={cls} />
    case "Grep":
      return <Regex className={cls} />
    case "Bash":
      return <Terminal className={cls} />
    case "Search":
      return <Search className={cls} />
    default:
      return <Terminal className={cls} />
  }
}

function ToolCallTimeline({ toolCalls }: { toolCalls: ToolCall[] }) {
  return (
    <div className="relative my-1.5 ml-[10px]">
      <div className="absolute left-[5.5px] top-2 bottom-2 w-px bg-border" />
      <div className="flex flex-col">
        {toolCalls.map((tc) => (
          <div key={tc.id} className="relative flex items-start gap-2.5 py-[5px] min-w-0">
            <div className="relative z-10 flex h-[12px] w-[12px] shrink-0 items-center justify-center text-muted-foreground mt-0.5">
              <ToolCallIcon tool={tc.tool} />
            </div>
            <span className="text-xs text-muted-foreground break-words min-w-0">
              {tc.summary}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TextBlockContent({ text }: { text: string }) {
  return (
    <div className="rounded-lg px-4 py-2.5 text-sm leading-relaxed bg-secondary/60 text-foreground prose dark:prose-invert prose-sm max-w-none prose-p:my-1 prose-pre:my-2 prose-pre:bg-background/50 prose-pre:text-xs prose-code:text-xs prose-code:bg-background/50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 break-words overflow-x-auto [&_pre]:overflow-x-auto [&_code]:break-all [&_table]:block [&_table]:overflow-x-auto [&_table]:max-w-full min-w-0">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >{text}</Markdown>
    </div>
  )
}

function MessageBubble({ message, onCommitClick, onBranchFromCommit }: { message: Message; onCommitClick?: (hash: string, msg: string) => void; onBranchFromCommit?: (hash: string) => void }) {
  const isUser = message.role === "user"

  if (message.commitHash) {
    return (
      <div id={`commit-${message.commitHash}`} className="group/commitrow flex items-center gap-3 py-1">
        <div className="h-px flex-1 bg-border" />
        <button
          onClick={() => onCommitClick?.(message.commitHash!, message.commitMessage || "")}
          className="flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground hover:bg-accent/50 hover:border-primary/30 transition-colors"
        >
          <GitCommitHorizontal className="h-3 w-3" />
          <code className="font-mono text-[10px] text-primary/70">{message.commitHash}</code>
          <span className="max-w-[200px] truncate">{message.commitMessage}</span>
        </button>
        <div className="relative h-px flex-1 bg-border">
          {onBranchFromCommit && (
            <button
              onClick={(e) => { e.stopPropagation(); onBranchFromCommit(message.commitHash!) }}
              title="Branch from here"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 flex px-2 cursor-pointer items-center justify-center bg-background text-muted-foreground hover:text-primary transition-colors"
            >
              <GitBranch className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    )
  }

  const hasContentBlocks = message.contentBlocks && message.contentBlocks.length > 0

  return (
    <div className="flex flex-col min-w-0 max-w-full">
      <div className="flex items-center gap-2 mb-1">
        {!isUser && (
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary/20">
            <Terminal className="h-3 w-3 text-primary" />
          </div>
        )}
        <span className={cn(
          "text-[11px] font-medium",
          isUser ? "text-muted-foreground" : "text-foreground"
        )}>
          {isUser ? "You" : "Claude Code"}
        </span>
        <span className="text-[10px] text-muted-foreground/40">{message.timestamp}</span>
      </div>

      {hasContentBlocks ? (
        <div className="flex flex-col gap-1 min-w-0 max-w-full">
          {message.contentBlocks!.map((block, idx) => {
            if (block.type === "text") {
              return <TextBlockContent key={idx} text={block.text} />
            } else if (block.type === "tool_calls") {
              const toolCallsWithIds = block.toolCalls.map((tc, tcIdx) => ({
                ...tc,
                id: tc.id || `tc-${idx}-${tcIdx}`,
                timestamp: tc.timestamp || "",
              }))
              return <ToolCallTimeline key={idx} toolCalls={toolCallsWithIds} />
            }
            return null
          })}
        </div>
      ) : (
        <>
          <div
            className={cn(
              "rounded-lg px-4 py-2.5 text-sm leading-relaxed",
              isUser
                ? "bg-primary/15 text-foreground whitespace-pre-wrap break-words"
                : "bg-secondary/60 text-foreground prose dark:prose-invert prose-sm max-w-none prose-p:my-1 prose-pre:my-2 prose-pre:bg-background/50 prose-pre:text-xs prose-code:text-xs prose-code:bg-background/50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 break-words overflow-x-auto [&_pre]:overflow-x-auto [&_code]:break-all [&_table]:block [&_table]:overflow-x-auto [&_table]:max-w-full min-w-0"
            )}
          >
            {message.content ? (
              isUser ? (
                message.content
              ) : (
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children }) => (
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {children}
                      </a>
                    ),
                  }}
                >{message.content}</Markdown>
              )
            ) : (
              message.role === "assistant" && (
                <span className="text-muted-foreground/50 italic">Thinking...</span>
              )
            )}
          </div>

          {message.toolCalls && message.toolCalls.length > 0 && (
            <ToolCallTimeline toolCalls={message.toolCalls} />
          )}
        </>
      )}
    </div>
  )
}

const headerActions = [
  { icon: GitPullRequest, label: "Create PR", action: "create-pr" },
  { icon: GitMerge, label: "Merge", action: "merge" },
  { icon: GitCompareArrows, label: "Rebase", action: "rebase" },
  { icon: RotateCcw, label: "Reset", action: "reset" },
  { icon: Tag, label: "Tag", action: "tag" },
  { icon: Diff, label: "Diff", action: "diff" },
  { icon: History, label: "Log", action: "log" },
]

// ============================================================================
// Main ChatPanel Component
// ============================================================================

interface ChatPanelProps {
  branch: Branch
  repoFullName: string
  repoName: string
  repoOwner: string
  gitHistoryOpen: boolean
  onToggleGitHistory: () => void
  onAddMessage: (message: Message) => Promise<string>
  onUpdateMessage: (messageId: string, updates: Partial<Message>) => void
  onUpdateBranch: (updates: Partial<Branch>) => void
  onSaveDraftForBranch?: (branchId: string, draftPrompt: string) => void
  onForceSave: () => void
  onCommitsDetected?: () => void
  onBranchFromCommit?: (commitHash: string) => void
  messagesLoading?: boolean
  isMobile?: boolean
}

export function ChatPanel({
  branch,
  repoFullName,
  repoName,
  repoOwner,
  gitHistoryOpen,
  onToggleGitHistory,
  onAddMessage,
  onUpdateMessage,
  onUpdateBranch,
  onSaveDraftForBranch,
  onForceSave,
  onCommitsDetected,
  onBranchFromCommit,
  messagesLoading = false,
  isMobile = false,
}: ChatPanelProps) {
  // Refs
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Custom hooks
  const { input, setInput, isNearBottomRef } = useDraftSync({
    branch,
    onSaveDraftForBranch,
  })

  const {
    currentExecutionIdRef,
    currentMessageIdRef,
    startPolling,
    stopPolling,
  } = useExecutionPolling({
    branch,
    repoName,
    onUpdateMessage,
    onUpdateBranch,
    onAddMessage,
    onForceSave,
    onCommitsDetected,
  })

  const gitActions = useGitActions({
    branch,
    repoName,
    repoFullName,
    repoOwner,
    onUpdateBranch,
    onAddMessage,
    onToggleGitHistory,
  })

  const renaming = useBranchRenaming({
    branch,
    repoName,
    repoFullName,
    onUpdateBranch,
    addSystemMessage: gitActions.addSystemMessage,
  })

  // Track scroll position
  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
      isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 150
    }
  }, [isNearBottomRef])

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current && isNearBottomRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [branch.messages, isNearBottomRef])

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + "px"
    }
  }, [input])

  // Send message handler
  const handleSend = useCallback(async () => {
    const prompt = input.trim()
    if (!prompt || branch.status === "running" || branch.status === "creating") return
    if (!branch.sandboxId) return

    const userMsg: Message = {
      id: generateId(),
      role: "user",
      content: prompt,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }
    await onAddMessage(userMsg)
    setInput("")

    onUpdateBranch({ status: "running", draftPrompt: "" })

    const assistantMsg: Message = {
      id: generateId(),
      role: "assistant",
      content: "",
      toolCalls: [],
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }
    const messageId = await onAddMessage(assistantMsg)
    currentMessageIdRef.current = messageId

    try {
      const response = await fetch("/api/agent/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sandboxId: branch.sandboxId,
          prompt,
          previewUrlPattern: branch.previewUrlPattern,
          repoName,
          messageId,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to start agent")
      }

      const { executionId } = await response.json()
      currentExecutionIdRef.current = executionId
      startPolling(messageId, executionId)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error"
      onUpdateMessage(messageId, { content: `Error: ${message}` })
      onUpdateBranch({ status: "idle" })
      currentMessageIdRef.current = null
      currentExecutionIdRef.current = null
    }
  }, [input, branch, repoName, onAddMessage, onUpdateMessage, onUpdateBranch, startPolling, currentMessageIdRef, currentExecutionIdRef, setInput])

  // Stop handler
  const handleStop = useCallback(() => {
    stopPolling()
    abortControllerRef.current?.abort()
  }, [stopPolling])

  // Keyboard handler
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const canSend = input.trim() && branch.status !== "running" && branch.status !== "creating" && branch.sandboxId
  const isReady = branch.sandboxId && (branch.status !== "creating")
  const isBusy = branch.status === "running" || branch.status === "creating"

  return (
    <TooltipProvider delayDuration={0}>
      <div className={cn(
        "flex min-w-0 flex-1 flex-col bg-background overflow-hidden",
        isMobile ? "h-full w-full max-w-full" : "min-h-0"
      )}>
        {/* Header - hidden on mobile */}
        {!isMobile && (
        <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5 sm:px-4">
          {/* Branch name section */}
          {renaming.renaming ? (
            <div className="flex items-center gap-1.5 min-w-0 ml-2.5">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 text-muted-foreground">
                <path fillRule="evenodd" d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25zM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM3.5 3.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0z" />
              </svg>
              <div className="inline-grid min-w-0 [&>*]:[grid-area:1/1]">
                <span className="invisible whitespace-pre px-1.5 text-xs font-mono">{renaming.renameValue || " "}</span>
                <input
                  ref={renaming.renameInputRef}
                  value={renaming.renameValue}
                  onChange={(e) => renaming.setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") renaming.handleRename()
                    if (e.key === "Escape") renaming.cancelRenaming()
                  }}
                  onBlur={renaming.cancelRenaming}
                  disabled={renaming.renameLoading}
                  className="h-6 bg-transparent border border-border/30 rounded px-1.5 text-xs font-mono text-foreground focus:outline-none focus:border-border/60 min-w-[3ch]"
                  autoFocus
                />
              </div>
              {renaming.renameLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />}
            </div>
          ) : (
            <button
              onClick={renaming.startRenaming}
              className="flex items-center gap-1.5 min-w-0 ml-2.5 py-1 cursor-pointer group/branch"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 text-muted-foreground">
                <path fillRule="evenodd" d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25zM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM3.5 3.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0z" />
              </svg>
              <span className="truncate text-xs font-mono text-muted-foreground">{branch.name}</span>
              <Pencil className="h-2.5 w-2.5 shrink-0 text-muted-foreground/0 group-hover/branch:text-muted-foreground transition-colors" />
            </button>
          )}

          <div className="flex items-center gap-0.5 shrink-0 overflow-x-auto ml-auto">
            {branch.sandboxId && (<>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={gitActions.handleSandboxToggle}
                    disabled={gitActions.sandboxToggleLoading || branch.status === "running" || branch.status === "creating"}
                    className="flex cursor-pointer h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {gitActions.sandboxToggleLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : branch.status === "stopped" ? (
                      <Play className="h-3.5 w-3.5" />
                    ) : (
                      <Pause className="h-3.5 w-3.5" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {branch.status === "stopped" ? "Start sandbox" : "Pause sandbox"}
                </TooltipContent>
              </Tooltip>
              <div className="mx-1.5 h-4 w-px bg-border shrink-0" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href={`https://github.com/${repoFullName}/tree/${branch.name}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex cursor-pointer h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                    </svg>
                  </a>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Open on GitHub</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={gitActions.handleVSCodeClick}
                    className="flex cursor-pointer h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <svg width="14" height="14" viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth="7" strokeLinejoin="round">
                      <path d="M70.9 97.8l25.3-12.2c2.3-1.1 3.8-3.5 3.8-6.1V20.5c0-2.6-1.5-5-3.8-6.1L70.9 2.2c-2.9-1.4-6.3-.9-8.6 1.2L26.2 37.7 10.8 26.1c-1.9-1.5-4.6-1.3-6.3.3l-3.2 2.9c-1.9 1.7-1.9 4.7 0 6.5L14.9 50 1.3 64.3c-1.9 1.7-1.9 4.7 0 6.5l3.2 2.9c1.7 1.6 4.4 1.8 6.3.3l15.4-11.6 36.1 34.3c1.5 1.4 3.5 2.1 5.5 2.1.3 0 2.1-.5 3.1-1zM71 27.5L40.4 50 71 72.5V27.5z" />
                    </svg>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Open in VS Code</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={gitActions.handleRsyncClick}
                    className="flex cursor-pointer h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <FolderSync className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Sync to local</TooltipContent>
              </Tooltip>
              <div className="mx-1.5 h-4 w-px bg-border shrink-0" />
            </>)}
            {headerActions.map((action) => {
              const isActive = action.action === "log" && gitHistoryOpen
              const hasPR = action.action === "create-pr" && !!branch.prUrl
              const isPRLoading = action.action === "create-pr" && gitActions.actionLoading === "create-pr"
              return (
                <Tooltip key={action.label}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => gitActions.handleHeaderAction(action.action)}
                      disabled={!isReady || (isBusy && action.action !== "log" && action.action !== "diff") || isPRLoading}
                      className={cn(
                        "flex cursor-pointer h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed",
                        hasPR
                          ? "text-green-400"
                          : isActive
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      )}
                    >
                      {isPRLoading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <action.icon className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    {hasPR ? "Open PR" : action.label}
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        </header>
        )}

        {/* Messages */}
        <div ref={scrollRef} onScroll={handleScroll} className={cn(
          "flex-1 overflow-y-auto overscroll-contain",
          isMobile ? "px-3 py-4 pb-4 touch-pan-y h-0 overflow-x-hidden w-full max-w-full" : "min-h-0 px-3 py-6 sm:px-6"
        )}>
          {branch.status === "creating" ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm">Setting up sandbox...</p>
              <p className="text-xs text-muted-foreground/60">Cloning repo, installing agent SDK...</p>
            </div>
          ) : branch.status === "error" && !branch.sandboxId ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
              <AlertCircle className="h-8 w-8 text-red-400" />
              <p className="text-sm text-red-400">Failed to create sandbox</p>
              <p className="text-xs text-muted-foreground/60">Check your API keys in Settings and try again</p>
            </div>
          ) : messagesLoading ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-sm">Loading messages...</p>
            </div>
          ) : branch.messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary">
                <Terminal className="h-5 w-5" />
              </div>
              <p className="text-sm">Start a conversation with Claude Code</p>
              <p className="text-xs text-muted-foreground/60">The agent has access to Read, Edit, Write, Bash and more</p>
            </div>
          ) : (
            <div className="flex flex-col gap-5 min-w-0 w-full max-w-full">
              {branch.messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} onCommitClick={(hash, msg) => { gitActions.setCommitDiffHash(hash); gitActions.setCommitDiffMessage(msg) }} onBranchFromCommit={onBranchFromCommit} />
              ))}
              {branch.status === "running" && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  Agent is working...
                </div>
              )}
            </div>
          )}
        </div>

        {/* Input */}
        <div
          className={cn(
            "shrink-0 border-t border-border",
            isMobile ? "px-3 pt-3" : "px-3 py-3 sm:px-6"
          )}
          style={isMobile ? { paddingBottom: 'calc(var(--safe-area-inset-bottom) + 0.75rem)' } : undefined}
        >
          <div className="flex items-end gap-2 rounded-lg border border-border bg-card px-3 py-2 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                branch.status === "creating"
                  ? "Type your first message while the sandbox is being set up..."
                  : !branch.sandboxId
                  ? "Sandbox not available"
                  : branch.status === "stopped"
                  ? "Sandbox paused \u2014 will resume on send..."
                  : "Describe what you want the agent to do..."
              }
              rows={1}
              disabled={!isReady && branch.status !== "creating"}
              className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none disabled:opacity-50"
            />
            <button
              onClick={branch.status === "running" ? handleStop : handleSend}
              disabled={branch.status === "running" ? false : !canSend}
              className={cn(
                "flex cursor-pointer h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors",
                branch.status === "running"
                  ? "bg-red-500/80 text-white hover:bg-red-500"
                  : canSend
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-secondary text-muted-foreground"
              )}
            >
              {branch.status === "running" ? (
                <span className="block h-3 w-3 rounded-sm bg-current" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
          <div className="mt-1.5 flex items-center">
            <span className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground">
              <Terminal className="h-3 w-3" />
              Claude Code
            </span>
          </div>
        </div>
      </div>

      {/* Branch picker modal */}
      <Dialog open={!!gitActions.branchPickerModal} onOpenChange={(open) => !open && gitActions.setBranchPickerModal(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {gitActions.branchPickerModal?.action === "merge" && `Merge ${branch.name} into...`}
              {gitActions.branchPickerModal?.action === "rebase" && `Rebase ${branch.name} onto...`}
            </DialogTitle>
          </DialogHeader>
          {gitActions.branchesLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : gitActions.remoteBranches.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No other branches found.</p>
          ) : (
            <Select value={gitActions.selectedBranch} onValueChange={gitActions.setSelectedBranch}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select branch" />
              </SelectTrigger>
              <SelectContent>
                {gitActions.remoteBranches.map((b) => (
                  <SelectItem key={b} value={b}>{b}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <DialogFooter>
            <button
              onClick={() => gitActions.setBranchPickerModal(null)}
              className="cursor-pointer rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (gitActions.branchPickerModal?.action === "merge") gitActions.handleMerge()
                if (gitActions.branchPickerModal?.action === "rebase") gitActions.handleRebase()
              }}
              disabled={!gitActions.selectedBranch || gitActions.actionLoading !== null}
              className="cursor-pointer flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {gitActions.actionLoading && <Loader2 className="h-3 w-3 animate-spin" />}
              {gitActions.branchPickerModal?.action === "merge" ? "Merge" : "Rebase"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset confirmation dialog */}
      <Dialog open={gitActions.resetConfirmOpen} onOpenChange={gitActions.setResetConfirmOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">Reset to HEAD?</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">This will discard all uncommitted changes. This cannot be undone.</p>
          <DialogFooter>
            <button
              onClick={() => gitActions.setResetConfirmOpen(false)}
              className="cursor-pointer rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={gitActions.handleReset}
              className="cursor-pointer flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
            >
              Reset
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tag dialog */}
      <Dialog open={gitActions.tagPopoverOpen} onOpenChange={(open) => { gitActions.setTagPopoverOpen(open); if (!open) gitActions.setTagNameInput("") }}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm">Create Tag</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="v1.0.0"
            value={gitActions.tagNameInput}
            onChange={(e) => gitActions.setTagNameInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") gitActions.handleTag() }}
            className="h-8 text-xs font-mono"
            autoFocus
          />
          <DialogFooter>
            <button
              onClick={() => { gitActions.setTagPopoverOpen(false); gitActions.setTagNameInput("") }}
              className="cursor-pointer rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={gitActions.handleTag}
              disabled={!gitActions.tagNameInput.trim()}
              className="cursor-pointer flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Create
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rsync command modal */}
      <Dialog open={gitActions.rsyncModalOpen} onOpenChange={(open) => { gitActions.setRsyncModalOpen(open); if (!open) gitActions.setRsyncCopied(false) }}>
        <DialogContent className="sm:max-w-lg overflow-hidden">
          <DialogHeader>
            <DialogTitle className="text-sm">Sync to local</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Run this in your terminal to continuously sync the sandbox to a local folder. It respects <code className="rounded bg-muted px-1 py-0.5">.gitignore</code> files and re-syncs every 2 seconds. Press <code className="rounded bg-muted px-1 py-0.5">Ctrl+C</code> to stop.
          </p>
          <div className="relative">
            <pre className="rounded-md bg-muted p-3 pr-9 text-xs font-mono whitespace-pre-wrap break-all">{gitActions.rsyncCommand}</pre>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(gitActions.rsyncCommand)
                gitActions.setRsyncCopied(true)
                setTimeout(() => gitActions.setRsyncCopied(false), 2000)
              }}
              className="absolute top-2 right-2 cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {gitActions.rsyncCopied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Diff modal — branch comparison */}
      {branch.sandboxId && (
        <DiffModal
          open={gitActions.diffModalOpen}
          onClose={() => gitActions.setDiffModalOpen(false)}
          repoOwner={repoOwner}
          repoName={repoName}
          branchName={branch.name}
          baseBranch={branch.baseBranch}
        />
      )}

      {/* Diff modal — single commit */}
      {branch.sandboxId && (
        <DiffModal
          open={!!gitActions.commitDiffHash}
          onClose={() => { gitActions.setCommitDiffHash(null); gitActions.setCommitDiffMessage(null) }}
          repoOwner={repoOwner}
          repoName={repoName}
          branchName={branch.name}
          baseBranch={branch.baseBranch}
          commitHash={gitActions.commitDiffHash}
          commitMessage={gitActions.commitDiffMessage}
        />
      )}
    </TooltipProvider>
  )
}

export function EmptyChatPanel({ hasRepos }: { hasRepos?: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-4 bg-background text-muted-foreground">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
        <Terminal className="h-7 w-7" />
      </div>
      <div className="flex flex-col items-center gap-1">
        <p className="text-sm font-medium text-foreground">
          {hasRepos ? "Select a branch to start" : "Add a repository to get started"}
        </p>
        <p className="text-xs text-muted-foreground">
          {hasRepos
            ? "Choose a repository and branch from the sidebar"
            : "Click the + button in the sidebar to add a GitHub repo"}
        </p>
      </div>
    </div>
  )
}
