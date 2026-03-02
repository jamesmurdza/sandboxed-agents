import { Daytona } from "@daytonaio/sdk"
import { CODING_AGENT_SCRIPT } from "@/lib/coding-agent-script"

export const maxDuration = 300 // 5 minute timeout for sandbox creation

export async function POST(req: Request) {
  const body = await req.json()
  const {
    daytonaApiKey,
    anthropicApiKey,
    githubPat,
    repoOwner,
    repoName,
    baseBranch,
    newBranch,
  } = body

  if (!daytonaApiKey || !anthropicApiKey || !githubPat || !repoOwner || !repoName || !newBranch) {
    return Response.json({ error: "Missing required fields" }, { status: 400 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
        )
      }

      try {
        send({ type: "progress", message: "Creating sandbox..." })

        const daytona = new Daytona({ apiKey: daytonaApiKey })
        const sandbox = await daytona.create({
          snapshot: "daytona-medium",
          envVars: {
            ANTHROPIC_API_KEY: anthropicApiKey,
          },
        })

        send({ type: "progress", message: "Cloning repository..." })

        const cloneUrl = `https://x-access-token:${githubPat}@github.com/${repoOwner}/${repoName}.git`
        const cloneResult = await sandbox.process.executeCommand(
          `cd /home/daytona && git clone ${cloneUrl} 2>&1`
        )
        if (cloneResult.exitCode) {
          throw new Error(`Failed to clone repository: ${cloneResult.result}`)
        }

        // Set up git config
        await sandbox.process.executeCommand(
          `cd /home/daytona/${repoName} && git config user.email "agent@agenthub.dev" && git config user.name "AgentHub"`
        )

        // Set up git credentials for push
        await sandbox.process.executeCommand(
          `echo "https://x-access-token:${githubPat}@github.com" > /home/daytona/.git-credentials && git config --global credential.helper 'store --file /home/daytona/.git-credentials'`
        )

        // Checkout base branch and create new branch
        const base = baseBranch || "main"
        send({ type: "progress", message: `Creating branch ${newBranch} from ${base}...` })

        const branchResult = await sandbox.process.executeCommand(
          `cd /home/daytona/${repoName} && git checkout ${base} 2>&1 && git checkout -b ${newBranch} 2>&1`
        )
        if (branchResult.exitCode) {
          // Try with 'master' if 'main' failed
          const retryResult = await sandbox.process.executeCommand(
            `cd /home/daytona/${repoName} && git checkout master 2>&1 && git checkout -b ${newBranch} 2>&1`
          )
          if (retryResult.exitCode) {
            throw new Error(`Failed to create branch: ${branchResult.result}`)
          }
        }

        send({ type: "progress", message: "Installing Claude Agent SDK..." })

        const installResult = await sandbox.process.executeCommand(
          "python3 -m pip install claude-agent-sdk==0.1.19 2>&1"
        )
        if (installResult.exitCode) {
          throw new Error(`Failed to install Agent SDK: ${installResult.result}`)
        }

        send({ type: "progress", message: "Initializing agent..." })

        // Write the coding agent script to the sandbox
        const scriptB64 = Buffer.from(CODING_AGENT_SCRIPT).toString("base64")
        await sandbox.process.executeCommand(
          `echo '${scriptB64}' | base64 -d > /tmp/coding_agent.py`
        )

        // Create code interpreter context with the repo as working directory
        const repoPath = `/home/daytona/${repoName}`
        const ctx = await sandbox.codeInterpreter.createContext(repoPath)

        // Initialize the coding agent (add /tmp to path so coding_agent.py is found)
        const initResult = await sandbox.codeInterpreter.runCode(
          `import sys; sys.path.insert(0, '/tmp'); import os, coding_agent;`,
          {
            context: ctx,
            envs: { REPO_PATH: repoPath },
          }
        )
        if (initResult.error) {
          throw new Error(`Failed to initialize agent: ${initResult.error.value}`)
        }

        send({
          type: "done",
          sandboxId: sandbox.id,
          contextId: ctx.id,
        })
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error"
        send({ type: "error", message })
      }

      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
