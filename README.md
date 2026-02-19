# Agent Company

Agentic VPs manage coding agent teams (Claude Code / Codex) autonomously. Each VP is a long-running daemon that spawns workers on git worktrees, acts as human-in-the-loop, maintains logs, and opens PRs.

## Quick Start

```bash
npm install && npm link   # Installs global `vp` command
cd /path/to/your/repo
vp setup                  # Programmatic setup — pick worker type, areas, .gitignore
vp start <slug>           # Start a VP daemon for a department
vp reset <slug>           # Reset a deparartment's memory
vp list                   # List departments
vp status                 # Show department status
```

Setup is mostly programmatic (instant CLI selectors). LLM is only called if you pick "Something else..." or "Type something..." to refine a department. Optionally adds `company/` to `.gitignore`.

## Architecture

**VP Loop**: `generateText` (AI SDK v6) in a while loop with tools. VP drives workers turn-by-turn via MCP, reviews responses, kills underperformers, persists knowledge, opens PRs. Loop runs until VP calls `mark_done`.

**Workers**: Codex MCP sessions in git worktrees. VP uses `start_worker` / `continue_worker` to interact. Each gets a `CLAUDE.md` with department knowledge injected.

**Knowledge**: `VP_LOGS.md`, `DOC.md`, `WORK.md` per department survive restarts. On context limit, VP persists everything then restarts with fresh context.

## Stack

TypeScript, Vercel AI SDK v6 (`ai` + `@ai-sdk/openai`), MCP SDK (`@modelcontextprotocol/sdk`), Commander CLI, Zod, YAML config.

## File Structure

```
src/
  index.ts          # CLI (commander)
  config.ts         # YAML config load/save with zod validation
  tracker.ts        # Central JSONL event logging
  event-queue.ts    # Async queue (legacy, unused)
  git.ts            # Git worktree management
  secretary.ts      # Interactive onboarding agent
  vp/
    agent.ts        # VP tool definitions (14 tools)
    loop.ts         # VP daemon event loop
    prompt.ts       # VP system prompt template
  workers/
    types.ts        # WorkerHandle, WorkerEvent, WorkerSession
    mcp-client.ts   # Codex MCP client (stdio transport)
    claude-code.ts  # Claude Code subprocess driver (legacy)
    codex.ts        # Codex subprocess driver (legacy)
company/            # Runtime data (gitignored)
  config.yaml
  departments/{slug}/  VP_LOGS.md, DOC.md, WORK.md, plans/, prds/
  logs/{slug}/         events.jsonl, work-snapshots/
```

## Tests

```bash
npm test
```
