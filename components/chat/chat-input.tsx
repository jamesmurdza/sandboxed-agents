"use client"

import { cn } from "@/lib/utils"
import type { Branch } from "@/lib/types"
import { BRANCH_STATUS } from "@/lib/constants"
import { PROVIDERS, hasCredentialsForProvider, type AgentProvider } from "@/lib/agent-providers"
import { Send, Terminal, ChevronDown, Lock } from "lucide-react"
import { forwardRef, useEffect, useCallback, useState, useRef } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

// ============================================================================
// Chat Input Component
// ============================================================================

interface ChatInputProps {
  branch: Branch
  input: string
  onInputChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  onAgentChange?: (agent: AgentProvider) => void
  onModelChange?: (model: string) => void
  credentials?: { hasAnthropicApiKey?: boolean; hasOpenaiApiKey?: boolean }
  isMobile?: boolean
}

export const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(
  function ChatInput(
    {
      branch,
      input,
      onInputChange,
      onSend,
      onStop,
      onAgentChange,
      onModelChange,
      credentials = {},
      isMobile,
    },
    ref
  ) {
    const canSend = input.trim() && branch.status !== BRANCH_STATUS.RUNNING && branch.status !== BRANCH_STATUS.CREATING && branch.sandboxId
    const isReady = branch.sandboxId && (branch.status !== BRANCH_STATUS.CREATING)

    // Dropdown state
    const [agentDropdownOpen, setAgentDropdownOpen] = useState(false)
    const [modelDropdownOpen, setModelDropdownOpen] = useState(false)
    const [pendingAgentChange, setPendingAgentChange] = useState<AgentProvider | null>(null)

    // Refs for click-outside handling
    const agentDropdownRef = useRef<HTMLDivElement>(null)
    const modelDropdownRef = useRef<HTMLDivElement>(null)

    // Get current agent and model
    const currentAgent = (branch.agent === "claude-code" ? "claude" : branch.agent || "claude") as AgentProvider
    const currentProvider = PROVIDERS[currentAgent]
    const currentModel = branch.model || currentProvider.defaultModel

    // Close dropdowns on click outside
    useEffect(() => {
      function handleClickOutside(e: MouseEvent) {
        if (agentDropdownRef.current && !agentDropdownRef.current.contains(e.target as Node)) {
          setAgentDropdownOpen(false)
        }
        if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
          setModelDropdownOpen(false)
        }
      }
      document.addEventListener("mousedown", handleClickOutside)
      return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [])

    // Auto-resize textarea
    useEffect(() => {
      const textarea = (ref as React.RefObject<HTMLTextAreaElement>)?.current
      if (textarea) {
        textarea.style.height = "auto"
        textarea.style.height = Math.min(textarea.scrollHeight, 150) + "px"
      }
    }, [input, ref])

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        onSend()
      }
    }, [onSend])

    const handleAgentSelect = useCallback((provider: AgentProvider) => {
      if (provider === currentAgent) {
        setAgentDropdownOpen(false)
        return
      }

      // Check if branch has messages - if so, show confirmation
      if (branch.messages && branch.messages.length > 0) {
        setPendingAgentChange(provider)
      } else {
        onAgentChange?.(provider)
      }
      setAgentDropdownOpen(false)
    }, [currentAgent, branch.messages, onAgentChange])

    const handleConfirmAgentChange = useCallback(() => {
      if (pendingAgentChange) {
        onAgentChange?.(pendingAgentChange)
        setPendingAgentChange(null)
      }
    }, [pendingAgentChange, onAgentChange])

    const handleModelSelect = useCallback((model: string) => {
      onModelChange?.(model)
      setModelDropdownOpen(false)
    }, [onModelChange])

    return (
      <>
        <div
          className={cn(
            "shrink-0 border-t border-border",
            isMobile ? "px-3 pt-3" : "px-3 py-3 sm:px-6"
          )}
          style={isMobile ? { paddingBottom: 'calc(var(--safe-area-inset-bottom) + 0.75rem)' } : undefined}
        >
          <div className="flex items-end gap-2 rounded-lg border border-border bg-card px-3 py-2 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20">
            <textarea
              ref={ref}
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                branch.status === BRANCH_STATUS.CREATING
                  ? "Type your first message while the sandbox is being set up..."
                  : !branch.sandboxId
                  ? "Sandbox not available"
                  : branch.status === BRANCH_STATUS.STOPPED
                  ? "Sandbox paused \u2014 will resume on send..."
                  : "Describe what you want the agent to do..."
              }
              rows={1}
              disabled={!isReady && branch.status !== BRANCH_STATUS.CREATING}
              className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none disabled:opacity-50"
            />
            <button
              onClick={branch.status === BRANCH_STATUS.RUNNING ? onStop : onSend}
              disabled={branch.status === BRANCH_STATUS.RUNNING ? false : !canSend}
              className={cn(
                "flex cursor-pointer h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors",
                branch.status === BRANCH_STATUS.RUNNING
                  ? "bg-red-500/80 text-white hover:bg-red-500"
                  : canSend
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-secondary text-muted-foreground"
              )}
            >
              {branch.status === BRANCH_STATUS.RUNNING ? (
                <span className="block h-3 w-3 rounded-sm bg-current" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          {/* Agent and Model Selectors */}
          <div className="mt-1.5 flex items-center justify-between">
            {/* Agent Selector */}
            <div className="relative" ref={agentDropdownRef}>
              <button
                onClick={() => setAgentDropdownOpen(!agentDropdownOpen)}
                className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground rounded hover:bg-secondary transition-colors"
              >
                <Terminal className="h-3 w-3" />
                {currentProvider.displayName}
                <ChevronDown className="h-3 w-3" />
              </button>

              {agentDropdownOpen && (
                <div className="absolute bottom-full left-0 mb-1 rounded-md border border-border bg-popover shadow-md py-1 min-w-[140px] z-50">
                  {Object.values(PROVIDERS).map((provider) => {
                    const hasCredentials = hasCredentialsForProvider(provider.name, credentials)
                    const isActive = currentAgent === provider.name
                    return (
                      <button
                        key={provider.name}
                        onClick={() => hasCredentials && handleAgentSelect(provider.name)}
                        disabled={!hasCredentials}
                        className={cn(
                          "w-full px-3 py-1.5 text-left text-xs flex items-center justify-between gap-2",
                          isActive ? "bg-accent text-foreground" : "hover:bg-accent/50",
                          !hasCredentials && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        <span>{provider.displayName}</span>
                        {!hasCredentials && <Lock className="h-3 w-3" />}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Model Selector */}
            <div className="relative" ref={modelDropdownRef}>
              <button
                onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground rounded hover:bg-secondary transition-colors"
              >
                {currentModel}
                <ChevronDown className="h-3 w-3" />
              </button>

              {modelDropdownOpen && (
                <div className="absolute bottom-full right-0 mb-1 rounded-md border border-border bg-popover shadow-md py-1 min-w-[140px] z-50">
                  {currentProvider.models.map((model) => (
                    <button
                      key={model}
                      onClick={() => handleModelSelect(model)}
                      className={cn(
                        "w-full px-3 py-1.5 text-left text-xs",
                        currentModel === model
                          ? "bg-accent text-foreground"
                          : "hover:bg-accent/50"
                      )}
                    >
                      {model}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Agent Change Confirmation Dialog */}
        <AlertDialog open={!!pendingAgentChange} onOpenChange={() => setPendingAgentChange(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Change Agent?</AlertDialogTitle>
              <AlertDialogDescription>
                Switching from {currentProvider.displayName} to{" "}
                {pendingAgentChange ? PROVIDERS[pendingAgentChange].displayName : ""} will clear your
                conversation history for this branch. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirmAgentChange}>
                Change Agent
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    )
  }
)
