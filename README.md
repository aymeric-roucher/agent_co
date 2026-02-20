# Agent Company

Agentic VPs manage coding agent teams autonomously. Each VP is a long-running daemon that spawns Claude Code workers on git worktrees, acts as human-in-the-loop, maintains logs, and opens PRs.

## Quick Start

```bash
npm install && npm link    # Always use `vp` commands after linking, never bare `node`
cd /path/to/your/repo
vp setup          # Pick worker type, areas, .gitignore
vp start <slug>   # Start a VP daemon
vp reset <slug>   # Wipe department memory
vp list / status
```

## Architecture

**VP Loop**: `generateText` (AI SDK v6) in a while loop with tools. Loop runs until VP calls `mark_done`.

**Workers (Claude Code)**: Each worker is a Claude Code session running via `@anthropic-ai/claude-agent-sdk`. The VP is the human-in-the-loop — every tool use (edit, write, bash) requires VP approval via the `canUseTool` callback.

### Worker control flow

1. `start_worker(task, branch)` spawns Claude Code in a git worktree. Claude Code explores, thinks, then hits its first tool use that needs permission — and **blocks**. The tool call returns the permission request to the VP.
2. The VP reviews the request and calls `continue_worker(worker_id, approve, message?)` with approval or denial. This unblocks Claude Code.
3. Claude Code executes (if approved) or adjusts (if denied), then continues until the **next** permission request — and blocks again.
4. Repeat until Claude Code finishes. The VP controls every single action.

No `--dangerously-skip-permissions`. No `--allowedTools`. The VP approves each action individually.

**Knowledge**: `VP_LOGS.md`, `DOC.md`, `WORK.md` per department survive restarts. On context limit, VP persists everything then restarts with fresh context.

## Stack

TypeScript, Vercel AI SDK v6, Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), Baileys (WhatsApp), Commander CLI, Zod 4, YAML config.

## WhatsApp Feedback

VPs can ask the user questions via WhatsApp using the `ask_user_feedback` tool. One-time setup:

```bash
vp whatsapp-login    # Scan QR code to link — number auto-detected
```

After setup, the VP sends questions and waits for your reply — fully headless.

## File Structure

```
src/
  index.ts              # CLI (commander)
  config.ts             # YAML config load/save
  tracker.ts            # JSONL event logging
  git.ts                # Git worktree management
  secretary.ts          # Interactive onboarding
  vp/
    agent.ts            # VP tool definitions
    loop.ts             # VP daemon event loop
    prompt.ts           # VP system prompt
  whatsapp/
    client.ts           # Baileys WhatsApp client
    login.ts            # QR login helper
  workers/
    claude-code-client.ts  # Claude Code SDK client
    types.ts               # WorkerSession types
company/                # Runtime data (gitignored)
  config.yaml
  whatsapp-auth/        # WhatsApp credentials (auto-created)
  workspaces/{slug}/    VP_LOGS.md, DOC.md, WORK.md
  logs/{slug}/          events.jsonl, vp-output.log
```

## Tests

```bash
npm test
```


## What I ripped off

- Patch implementation, shell_session, read_file: directly taken from [Codex](https://github.com/openai/codex)
- WhatsApp authentification through Baileys: from [OpenClaw](https://github.com/openclaw/openclaw)