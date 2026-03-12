/**
 * Agent Session Service
 *
 * Wraps the coding-agents-sdk to provide a clean interface for running
 * AI coding agents with streaming output.
 */

import { createSession, type Event, type SessionOptions } from "coding-agents-sdk"
import { type AgentProvider, getEnvVarsForProvider } from "./agent-providers"

export type { Event } from "coding-agents-sdk"

/**
 * Options for creating an agent session
 * Note: sandbox is typed as 'unknown' to avoid version mismatches between
 * the Daytona SDK in this project and the one bundled with coding-agents-sdk.
 * The SDK internally handles adaptation of the sandbox.
 */
export interface AgentSessionOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sandbox: any // Daytona Sandbox - typed as any to avoid SDK version mismatch
  credentials: {
    anthropicApiKey?: string
    openaiApiKey?: string
  }
  model?: string
  sessionId?: string
  timeout?: number
  skipInstall?: boolean
}

/**
 * Create an agent session for a specific provider
 *
 * @param provider - The agent provider to use (claude, codex, opencode)
 * @param options - Session configuration
 * @returns A provider session that can be used to run queries
 */
export async function createAgentSession(
  provider: AgentProvider,
  options: AgentSessionOptions
) {
  const { sandbox, credentials, model, sessionId, timeout, skipInstall } = options

  // Build environment variables for the provider
  const env = getEnvVarsForProvider(provider, credentials)

  const sessionOptions: SessionOptions = {
    sandbox,
    env,
    model,
    sessionId,
    timeout: timeout ?? 300, // 5 minute default
    skipInstall: skipInstall ?? false,
  }

  return createSession(provider, sessionOptions)
}

/**
 * Format an SDK event for SSE streaming to the frontend
 */
export function formatEventForSSE(event: Event): Record<string, unknown> {
  switch (event.type) {
    case "session":
      return { type: "session-id", sessionId: event.id }

    case "token":
      return { type: "stdout", content: event.text }

    case "tool_start":
      // Format tool call for frontend display
      const toolSummary = formatToolSummary(event.name, event.input)
      return {
        type: "tool-start",
        tool: event.name,
        summary: toolSummary,
        input: event.input,
      }

    case "tool_delta":
      return { type: "tool-delta", content: event.text }

    case "tool_end":
      return { type: "tool-end", output: event.output }

    case "end":
      return { type: "done" }

    default:
      return { type: "unknown", event }
  }
}

/**
 * Format a tool call into a human-readable summary
 */
function formatToolSummary(name: string, input?: unknown): string {
  if (!input || typeof input !== "object") {
    return name
  }

  const inputObj = input as Record<string, unknown>

  switch (name) {
    case "read":
      return `Read: ${inputObj.file_path || "file"}`
    case "write":
      return `Write: ${inputObj.file_path || "file"}`
    case "edit":
      return `Edit: ${inputObj.file_path || "file"}`
    case "glob":
      return `Glob: ${inputObj.pattern || "pattern"}`
    case "grep":
      return `Grep: ${inputObj.pattern || "pattern"}`
    case "shell":
      const cmd = inputObj.command as string || ""
      const shortCmd = cmd.length > 50 ? cmd.slice(0, 47) + "..." : cmd
      return `Bash: ${shortCmd}`
    default:
      return name
  }
}

/**
 * Accumulate events into content and tool calls for database storage
 */
export interface AccumulatedOutput {
  content: string
  toolCalls: { tool: string; summary: string }[]
  sessionId: string | null
}

export function createOutputAccumulator(): AccumulatedOutput {
  return {
    content: "",
    toolCalls: [],
    sessionId: null,
  }
}

export function accumulateEvent(output: AccumulatedOutput, event: Event): void {
  switch (event.type) {
    case "session":
      output.sessionId = event.id
      break

    case "token":
      output.content += event.text
      break

    case "tool_start":
      const summary = formatToolSummary(event.name, event.input)
      output.toolCalls.push({ tool: event.name, summary })
      break

    // tool_delta, tool_end, and end don't need accumulation
  }
}
