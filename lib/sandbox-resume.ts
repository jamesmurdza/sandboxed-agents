import { Daytona } from "@daytonaio/sdk"
import { readPersistedSessionId } from "@/lib/agent-session"
import { PATHS, SANDBOX_CONFIG } from "@/lib/constants"
import type { Agent } from "@/lib/types"

/**
 * Determines which API key(s) to inject based on agent type and selected model.
 * Returns environment variables appropriate for the model provider.
 */
function getEnvForModel(
  model: string | undefined,
  agent: Agent | undefined,
  credentials: {
    anthropicApiKey?: string
    anthropicAuthType?: string
    openaiApiKey?: string
    openrouterApiKey?: string
  }
): Record<string, string> {
  const env: Record<string, string> = {}

  // For Claude Code agent, always use Anthropic credentials
  if (agent === "claude-code" || !agent) {
    if (credentials.anthropicAuthType !== "claude-max" && credentials.anthropicApiKey) {
      env.ANTHROPIC_API_KEY = credentials.anthropicApiKey
    }
    return env
  }

  // For OpenCode agent, select API key based on model prefix
  if (agent === "opencode") {
    // Parse the model string to determine provider
    // Model formats: "anthropic/claude-sonnet-4-...", "openai/gpt-4o", "google/gemini-...", "opencode/big-pickle"
    const modelPrefix = model?.split("/")[0]?.toLowerCase()

    switch (modelPrefix) {
      case "anthropic":
        // Claude models through OpenCode use Anthropic API key
        if (credentials.anthropicApiKey) {
          env.ANTHROPIC_API_KEY = credentials.anthropicApiKey
        }
        break

      case "openai":
        // OpenAI models (GPT-4o, etc.)
        if (credentials.openaiApiKey) {
          env.OPENAI_API_KEY = credentials.openaiApiKey
        }
        break

      case "google":
        // Google/Gemini models - OpenRouter can route these
        if (credentials.openrouterApiKey) {
          env.OPENROUTER_API_KEY = credentials.openrouterApiKey
        }
        break

      case "opencode":
        // Big Pickle model - no API key needed (free model)
        break

      default:
        // Unknown model - try OpenRouter as fallback for routing
        if (credentials.openrouterApiKey) {
          env.OPENROUTER_API_KEY = credentials.openrouterApiKey
        }
        // Also include OpenAI and Anthropic keys for flexibility
        if (credentials.openaiApiKey) {
          env.OPENAI_API_KEY = credentials.openaiApiKey
        }
        if (credentials.anthropicApiKey) {
          env.ANTHROPIC_API_KEY = credentials.anthropicApiKey
        }
        break
    }
  }

  return env
}

/**
 * Ensures a sandbox is running and ready for agent execution.
 * If the sandbox was stopped, it restarts it and sets up credentials.
 * The SDK handles CLI installation automatically when creating a session.
 */
export async function ensureSandboxReady(
  daytonaApiKey: string,
  sandboxId: string,
  repoName: string,
  previewUrlPattern?: string,
  anthropicApiKey?: string,
  anthropicAuthType?: string,
  anthropicAuthToken?: string,
  // Database session ID - this is the source of truth since it persists across sandbox rebuilds
  databaseSessionId?: string,
  // OpenAI API key for Codex and OpenCode agents
  openaiApiKey?: string,
  // Agent type to determine which credentials to include
  agent?: Agent,
  // Model selection for determining which API key to use
  model?: string,
  // OpenRouter API key for OpenRouter models
  openrouterApiKey?: string
): Promise<{
  sandbox: Awaited<ReturnType<InstanceType<typeof Daytona>["get"]>>
  wasResumed: boolean
  resumeSessionId?: string
  env: Record<string, string>
}> {
  const daytona = new Daytona({ apiKey: daytonaApiKey })
  const sandbox = await daytona.get(sandboxId)

  // Start sandbox if not running
  if (sandbox.state !== "started") {
    await sandbox.start(SANDBOX_CONFIG.START_TIMEOUT_SECONDS)
  }

  // Read stored session ID for agent resumption
  // Priority: file (latest conversation session, used by SDK) > database (fallback)
  const fileSessionId = await readPersistedSessionId(sandbox)
  const resumeSessionId = fileSessionId || databaseSessionId

  // For Claude Max, write credentials if needed
  if (anthropicAuthType === "claude-max" && anthropicAuthToken) {
    const credentialsB64 = Buffer.from(anthropicAuthToken).toString("base64")
    await sandbox.process.executeCommand(
      `mkdir -p ${PATHS.CLAUDE_CREDENTIALS_DIR} && echo '${credentialsB64}' | base64 -d > ${PATHS.CLAUDE_CREDENTIALS_FILE} && chmod 600 ${PATHS.CLAUDE_CREDENTIALS_FILE}`
    )
  }

  // Get environment variables based on model and agent
  const env = getEnvForModel(model, agent, {
    anthropicApiKey,
    anthropicAuthType,
    openaiApiKey,
    openrouterApiKey,
  })

  return {
    sandbox,
    wasResumed: !!resumeSessionId,
    resumeSessionId,
    env,
  }
}

/**
 * Lighter version — just ensures a sandbox is running.
 * Used for git/SSH operations that don't need the agent context.
 */
export async function ensureSandboxStarted(
  daytonaApiKey: string,
  sandboxId: string
): Promise<Awaited<ReturnType<InstanceType<typeof Daytona>["get"]>>> {
  const daytona = new Daytona({ apiKey: daytonaApiKey })
  const sandbox = await daytona.get(sandboxId)

  if (sandbox.state !== "started") {
    await sandbox.start(SANDBOX_CONFIG.START_TIMEOUT_SECONDS)
  }

  return sandbox
}
