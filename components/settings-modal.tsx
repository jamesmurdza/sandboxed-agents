"use client"

import { cn } from "@/lib/utils"
import { X, Key, Github, Terminal } from "lucide-react"
import { useState, useEffect } from "react"
import { Input } from "@/components/ui/input"
import type { Settings } from "@/lib/types"

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  settings: Settings
  onSave: (settings: Settings) => void
}

export function SettingsModal({ open, onClose, settings, onSave }: SettingsModalProps) {
  const [githubPat, setGithubPat] = useState("")
  const [anthropicApiKey, setAnthropicApiKey] = useState("")
  const [daytonaApiKey, setDaytonaApiKey] = useState("")

  // Sync form state when modal opens
  useEffect(() => {
    if (open) {
      setGithubPat(settings.githubPat)
      setAnthropicApiKey(settings.anthropicApiKey)
      setDaytonaApiKey(settings.daytonaApiKey)
    }
  }, [open, settings])

  if (!open) return null

  function handleSave() {
    onSave({
      githubPat: githubPat.trim(),
      anthropicApiKey: anthropicApiKey.trim(),
      daytonaApiKey: daytonaApiKey.trim(),
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-lg flex-col rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Settings</h2>
          <button
            onClick={onClose}
            className="flex cursor-pointer h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* GitHub PAT */}
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <Github className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">GitHub Personal Access Token</span>
          </div>
          <Input
            type="password"
            placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            value={githubPat}
            onChange={(e) => setGithubPat(e.target.value)}
            className="h-9 bg-secondary border-border text-xs font-mono placeholder:text-muted-foreground/40"
          />
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Required for cloning repos, creating branches, and pushing code.
            Needs <code className="text-[10px]">repo</code> scope.
          </p>
        </div>

        {/* API Keys */}
        <div className="flex flex-col gap-4 px-5 py-4">
          {/* Anthropic API Key */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
              <label className="text-xs font-medium text-foreground">Anthropic API Key</label>
            </div>
            <Input
              type="password"
              placeholder="sk-ant-..."
              value={anthropicApiKey}
              onChange={(e) => setAnthropicApiKey(e.target.value)}
              className="h-9 bg-secondary border-border text-xs font-mono placeholder:text-muted-foreground/40"
            />
            <p className="text-[11px] text-muted-foreground">
              Used by Claude Code agent inside sandboxes
            </p>
          </div>

          {/* Daytona API Key */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <Key className="h-3.5 w-3.5 text-muted-foreground" />
              <label className="text-xs font-medium text-foreground">Daytona API Key</label>
            </div>
            <Input
              type="password"
              placeholder="dtn_..."
              value={daytonaApiKey}
              onChange={(e) => setDaytonaApiKey(e.target.value)}
              className="h-9 bg-secondary border-border text-xs font-mono placeholder:text-muted-foreground/40"
            />
            <p className="text-[11px] text-muted-foreground">
              Used for creating cloud sandboxes.{" "}
              <a
                href="https://app.daytona.io/dashboard/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                Get a key
              </a>
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            onClick={onClose}
            className="cursor-pointer rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="cursor-pointer rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
