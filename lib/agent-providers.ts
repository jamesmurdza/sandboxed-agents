/**
 * Agent Provider Configuration
 *
 * Defines the supported AI coding agents and their configurations.
 * Used throughout the app for provider selection, credential validation,
 * and model options.
 */

export type AgentProvider = "claude" | "codex" | "opencode"

export interface ProviderConfig {
  name: AgentProvider
  displayName: string
  description: string
  envKey: string
  defaultModel: string
  models: string[]
}

/**
 * Configuration for each supported provider
 */
export const PROVIDERS: Record<AgentProvider, ProviderConfig> = {
  claude: {
    name: "claude",
    displayName: "Claude",
    description: "Anthropic's Claude Code",
    envKey: "ANTHROPIC_API_KEY",
    defaultModel: "sonnet",
    models: ["sonnet", "opus", "haiku"],
  },
  codex: {
    name: "codex",
    displayName: "Codex",
    description: "OpenAI's coding agent",
    envKey: "OPENAI_API_KEY",
    defaultModel: "gpt-4o",
    models: ["gpt-4o", "o1", "o3"],
  },
  opencode: {
    name: "opencode",
    displayName: "OpenCode",
    description: "Open source, multi-provider",
    envKey: "OPENAI_API_KEY", // Can use OpenAI or Anthropic
    defaultModel: "openai/gpt-4o",
    models: ["openai/gpt-4o", "anthropic/claude-sonnet"],
  },
}

/**
 * Check if user has the required credentials for a provider
 */
export function hasCredentialsForProvider(
  provider: AgentProvider,
  credentials: { hasAnthropicApiKey?: boolean; hasOpenaiApiKey?: boolean }
): boolean {
  switch (provider) {
    case "claude":
      return !!credentials.hasAnthropicApiKey
    case "codex":
      return !!credentials.hasOpenaiApiKey
    case "opencode":
      // OpenCode can work with either OpenAI or Anthropic
      return !!credentials.hasOpenaiApiKey || !!credentials.hasAnthropicApiKey
  }
}

/**
 * Get the environment variables needed for a provider
 */
export function getEnvVarsForProvider(
  provider: AgentProvider,
  credentials: {
    anthropicApiKey?: string
    openaiApiKey?: string
  }
): Record<string, string> {
  switch (provider) {
    case "claude":
      return credentials.anthropicApiKey
        ? { ANTHROPIC_API_KEY: credentials.anthropicApiKey }
        : {}
    case "codex":
      return credentials.openaiApiKey
        ? { OPENAI_API_KEY: credentials.openaiApiKey }
        : {}
    case "opencode":
      // OpenCode prefers OpenAI but can use Anthropic
      const envVars: Record<string, string> = {}
      if (credentials.openaiApiKey) {
        envVars.OPENAI_API_KEY = credentials.openaiApiKey
      }
      if (credentials.anthropicApiKey) {
        envVars.ANTHROPIC_API_KEY = credentials.anthropicApiKey
      }
      return envVars
  }
}

/**
 * Labels for displaying agent names (for backward compatibility with existing agentLabels)
 */
export const agentLabels: Record<string, string> = {
  "claude-code": "Claude Code",
  claude: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
}
