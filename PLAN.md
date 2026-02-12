# Agent company

I want to create a whole company of agentic coders to work for me. It has work departments, like a real company, and each department has an agentic VP.

- The VP is given a wide responsibility (not task) like “make sure that presentations rendered through our render_html look exactly like the original”, or “make sure the code stays concise and has no duplicate or dead code”
- VP can start as many teams (=coding agent instances) as wanted on git worktrees
    - Each team can be a Claude Code or Codex instance (can be multi-agent) and works on its own git branch
- VP IS the human in the loop for these Claude Code or Codex
    - Tasked with being extremely strict, upholding good values like “minimal code, no useless abstractions, be caareful because agents tend to be lazy and hide errors under the rug, or skip half the implementation.”
    - Can kill a team when it underperforms or becomes too lazy (often towards the end of context length)
- VP keeps a log of what’s happening: WORK[.md](http://HISTORY.md) starts from initial task then appends log entries for each agent that run, with
    - difficulties, choices etc.
    - Learnings
- VP should draw feedback in WORK.md from the PR reviews when they come in
- VP often communicates with user (me) through short Whatsapp messages
- Tasked with opening as many PRs as needed (can ask the instance to open it themselves?)
- VP controls usage : when usage limit is reached, waits for the scheduled limit expiration to then re-ping them, meanwhile switches to others.

## Implementation

- Let’s start with one, either Claude code or Codex
- How to act as the human in the loop to Claude code or Codex?
    - Need to send messages in their chat, to accept/reject changes, or to kill them.
    - Maybe find a way to bypass the UI to make it programmatically? (easier for codex that is open source?)
        => use MCP control!
- How to communicate with user through whatsapp, how to schedule.
- Later, not to handle for now: Would be interesting to let it deploy the website, and control a browser to access it


## How to trigger Claude Code or codex

VP agents can use MCP command to trigger Claude Code or codex

Read under CLAUDE_CODE_REF.md and CODEX_REF.md

## To discuss : choices

- Use python, rust? The VPs should be accessible via CLI, and ideally can display a dashboard for quick access. Also their file structure should be easily understandable.
    - Depending on the language, which framework to use? Use openai agents js (https://openai.github.io/openai-agents-js/) framework, or pi-agent (typescript, https://github.com/badlogic/pi-mono), for instance?
    - Btw maybe Claude Code or codex themselves could be controllers! Through the MCP tools.

---

# Implementation Plan: Agent Company

## Context

Build a system where agentic "VPs" manage coding agent teams (Claude Code / Codex instances) autonomously. VPs are long-running daemons that spawn workers on git worktrees, act as human-in-the-loop, maintain logs, and open PRs. An onboarding "secretary" agent sets up the company structure interactively.

**Stack**: TypeScript + Vercel AI SDK (`ai` + `@ai-sdk/anthropic`) + Commander CLI + async event loop.

---

## File Structure

```
agents_co/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts                 # CLI entry (commander)
│   ├── config.ts                # load/save company YAML config
│   ├── secretary.ts             # onboarding agent
│   ├── vp/
│   │   ├── agent.ts             # VP tools definition
│   │   ├── loop.ts              # daemon event loop (generateText in a while loop)
│   │   └── prompt.ts            # VP system prompt template
│   ├── workers/
│   │   ├── types.ts             # WorkerHandle interface
│   │   ├── codex.ts             # Codex subprocess driver
│   │   └── claude-code.ts       # Claude Code subprocess driver
│   ├── git.ts                   # worktree create/cleanup
│   └── tracker.ts               # central logging (writes to logs/)
├── company/                      # runtime data, gitignored
│   ├── config.yaml
│   ├── DOC_COMMON.md             # shared knowledge — all VPs can update (sparingly)
│   ├── logs/                     # CENTRAL - VPs cannot write here directly
│   │   └── {vp-slug}/
│   │       ├── events.jsonl
│   │       └── work-snapshots/
│   └── departments/
│       └── {vp-slug}/
│           ├── VP_LOGS.md        # VP's progress reports (survives restarts)
│           ├── DOC.md            # department knowledge — VP writes, workers read
│           ├── WORK.md           # current work state
│           ├── plans/
│           └── prds/
└── tests/
    ├── config.test.ts
    ├── git.test.ts
    ├── vp-tools.test.ts
    └── secretary.test.ts
```

---

## Core Pattern: VP Agent Loop

The Vercel AI SDK makes this very clean — no Agent/Runner abstraction needed. Just `generateText` in a while loop with tools:

```typescript
import { generateText, type ModelMessage } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

const messages: ModelMessage[] = [
  { role: 'user', content: `Your responsibility: ${config.responsibility}` },
];

while (true) {
  const result = await generateText({
    model: anthropic('claude-sonnet-4-5-20250929'),
    system: VP_SYSTEM_PROMPT,
    tools: vpTools,
    messages,
    stopWhen: stepCountIs(30),
    onStepFinish: ({ toolCalls }) => tracker.logStep(toolCalls),
    prepareStep: async ({ messages }) => {
      if (messages.length > 50) return { messages: messages.slice(-20) };
    },
  });
  messages.push(...result.response.messages);

  // Block until next event (worker finished, error, etc.)
  const event = await eventQueue.dequeue();
  messages.push({ role: 'user', content: formatEvent(event) });
}
```

---

## Step-by-step Implementation

### Step 1: Project scaffold

**Files**: `package.json`, `tsconfig.json`

Dependencies:
- `ai`, `@ai-sdk/anthropic` — Vercel AI SDK + Claude provider
- `zod` — tool input schemas
- `commander` — CLI
- `yaml` — config parsing
- `tsx` — run TS directly

Dev deps: `vitest`, `typescript`, `@types/node`

Script: `"start": "tsx src/index.ts"`

### Step 2: Config system

**File**: `src/config.ts`

```yaml
# company/config.yaml
repo: /path/to/target/repo
model: claude-sonnet-4-5-20250929
departments:
  - slug: code-quality
    name: Code Quality
    responsibility: "Ensure code stays concise, no duplicates, no dead code..."
    worker_type: claude_code
  - slug: ui-fidelity
    name: UI Fidelity
    responsibility: "Make sure rendered presentations match the original..."
    worker_type: codex
```

Types: `CompanyConfig`, `DepartmentConfig` (interfaces).
Functions: `loadConfig(path): CompanyConfig`, `saveConfig(config, path)`.
Validate with zod schema.

### Step 3: Central tracker

**File**: `src/tracker.ts`

Writes to `company/logs/{vp-slug}/`. VPs don't write there — their tools call tracker methods.

```typescript
class Tracker {
  constructor(slug: string, logsDir: string) {}
  logEvent(type: string, data: Record<string, unknown>): void  // append to events.jsonl
  snapshotWorkMd(content: string): void                         // copy to work-snapshots/
  logStep(toolCalls: ToolCall[]): void                          // log each agent step
}
```

Each event: `{ timestamp, type, data }` as a JSON line.

### Step 4: Git worktree management

**File**: `src/git.ts`

```typescript
function createWorktree(repo: string, branch: string): string   // returns worktree path
function removeWorktree(worktreePath: string): void
function listWorktrees(repo: string): WorktreeInfo[]
```

Runs `git worktree add/remove/list` via `child_process.execSync`.
Worktrees live in `{repo}/../worktrees/{branch}/`.

### Step 5: Worker drivers

**File**: `src/workers/types.ts`

```typescript
interface WorkerHandle {
  id: string;
  branch: string;
  worktreePath: string;
  process: ChildProcess;
  workerType: 'codex' | 'claude_code';
  status: 'running' | 'done' | 'failed';
  outputBuffer: string;
}
```

**File**: `src/workers/claude-code.ts`

```typescript
async function spawnClaudeCode(worktree: string, prompt: string): Promise<WorkerHandle>
// Runs: claude -p "prompt" --dangerously-skip-permissions
// Spawns child_process, captures stdout/stderr
// Returns handle; caller sets up event listener on process.on('exit', ...)
```

**File**: `src/workers/codex.ts`

```typescript
async function spawnCodex(worktree: string, prompt: string): Promise<WorkerHandle>
// Runs: codex -q "prompt" --approval-mode suggest
// Same subprocess pattern
```

Both drivers: spawn process, pipe stdout to `handle.outputBuffer`, emit to event queue on exit.

### Step 6: Event queue

Simple async queue shared between the VP loop and worker monitors:

```typescript
class EventQueue<T> {
  private queue: T[] = [];
  private resolve: ((value: T) => void) | null = null;

  push(item: T): void { ... }
  async dequeue(): Promise<T> { ... }  // blocks until item available
}
```

Worker monitors push events when a process exits. The VP loop awaits `dequeue()` between turns.

### Step 7: VP tools

**File**: `src/vp/agent.ts`

All tools use the Vercel AI SDK `tool()` helper with zod schemas. They close over a shared `VPState` object.

```typescript
interface VPState {
  config: DepartmentConfig;
  tracker: Tracker;
  workers: Map<string, WorkerHandle>;
  eventQueue: EventQueue<WorkerEvent>;
  departmentDir: string;
}
```

**Tools:**

1. **`spawn_worker`** `{ task: string, branch_name: string } -> string`
   - Creates git worktree + branch
   - Spawns Claude Code or Codex subprocess
   - Sets up process exit listener → pushes to eventQueue
   - Logs to tracker
   - Returns worker ID

2. **`check_worker`** `{ worker_id: string } -> string`
   - Returns status + last N chars of output

3. **`send_to_worker`** `{ worker_id: string, message: string } -> string`
   - Writes to worker's stdin

4. **`kill_worker`** `{ worker_id: string } -> string`
   - `process.kill()`, remove worktree, log

5. **`update_work_log`** `{ entry: string } -> string`
   - Appends to department's WORK.md
   - Tracker snapshots it

6. **`write_doc`** `{ filename: string, content: string, folder: 'plans' | 'prds' } -> string`
   - Writes to department's plans/ or prds/

7. **`open_pr`** `{ branch: string, title: string, body: string } -> string`
   - Runs `gh pr create` from worktree

8. **`list_workers`** `{} -> string`
   - Returns status table of all workers

### Step 8: Knowledge persistence & context limit handling

**Key concept**: VPs accumulate knowledge during their session. When approaching context limits, they must persist everything to files before restarting. On restart, they reload from those files.

**Files that survive restarts** (in `company/departments/{slug}/`):
- `VP_LOGS.md` — progress report: what's done, what's in progress, what's blocked
- `DOC.md` — department knowledge base: patterns discovered, architecture notes, gotchas. Workers READ this (injected into their CLAUDE.md) but cannot edit it.
- `company/DOC_COMMON.md` — cross-department knowledge. VPs update sparingly with short lines.

**Worker bootstrapping**: When `spawn_worker` launches a Claude Code or Codex instance, it generates a `CLAUDE.md` (or equivalent instructions) in the worktree that tells the worker:
1. Read `DOC_COMMON.md` and your department's `DOC.md` before starting
2. Always write a comprehensive report as your final answer (what you did, what you learned, what's left)

This way the VP can extract learnings from worker reports and fold them into `DOC.md`.

**Context limit detection**: Track token usage via `onStepFinish` (Vercel SDK provides `usage` in step results). When cumulative tokens approach a threshold (e.g. 150k of 200k), the daemon injects a special message:

```
CONTEXT LIMIT APPROACHING. Before shutdown:
1. Update VP_LOGS.md with current progress
2. Update DOC.md with any new knowledge
3. Update DOC_COMMON.md ONLY if critical cross-department info
4. List all active workers and their status
```

The VP writes its reports via tools, then the daemon kills and restarts itself. On restart, the initial message includes the contents of `VP_LOGS.md` and `DOC.md` so the VP resumes where it left off.

**VP tools additions:**

9. **`update_doc`** `{ content: string } -> string`
   - Overwrites department's `DOC.md`

10. **`update_common_doc`** `{ lines: string } -> string`
    - Appends short lines to `DOC_COMMON.md`

11. **`read_doc`** `{} -> string`
    - Returns current `DOC.md` content

12. **`read_common_doc`** `{} -> string`
    - Returns current `DOC_COMMON.md` content

### Step 9: VP system prompt

**File**: `src/vp/prompt.ts`

Template that receives `{ responsibility, department_name, worker_type }`. Instructs the VP to:
- Break responsibility into concrete tasks
- Spawn workers on branches, one task per worker
- Monitor workers, read their output, kill lazy ones
- Extract learnings from worker reports → fold into DOC.md
- Maintain WORK.md with difficulties, choices, learnings
- Open PRs when work is ready
- Be extremely strict: minimal code, no abstractions, no hidden errors
- When told context is running out: persist everything and prepare for restart

### Step 10: VP daemon loop

**File**: `src/vp/loop.ts`

```typescript
async function runVP(department: DepartmentConfig, companyConfig: CompanyConfig) {
  const tracker = new Tracker(department.slug, companyConfig.logsDir);
  const eventQueue = new EventQueue<WorkerEvent>();
  const state: VPState = { config: department, tracker, workers: new Map(), eventQueue, ... };
  const tools = createVPTools(state);
  let totalTokens = 0;
  const TOKEN_LIMIT = 150_000;

  // On restart: load persistent knowledge into initial message
  const vpLogs = readFileOrEmpty(path.join(state.departmentDir, 'VP_LOGS.md'));
  const doc = readFileOrEmpty(path.join(state.departmentDir, 'DOC.md'));
  const initialContext = [
    `Your responsibility: ${department.responsibility}`,
    vpLogs ? `\n## Previous progress (VP_LOGS.md):\n${vpLogs}` : '',
    doc ? `\n## Department knowledge (DOC.md):\n${doc}` : '',
  ].filter(Boolean).join('\n');

  const messages: ModelMessage[] = [
    { role: 'user', content: initialContext },
  ];

  while (true) {
    const result = await generateText({
      model: anthropic(companyConfig.model),
      system: buildVPPrompt(department),
      tools,
      messages,
      stopWhen: stepCountIs(30),
      onStepFinish: ({ toolCalls, usage }) => {
        tracker.logStep(toolCalls);
        totalTokens += (usage?.totalTokens ?? 0);
      },
    });
    messages.push(...result.response.messages);
    tracker.logEvent('vp_turn_complete', { output: result.text, totalTokens });

    // Context limit check → graceful restart
    if (totalTokens > TOKEN_LIMIT) {
      messages.push({
        role: 'user',
        content: 'CONTEXT LIMIT APPROACHING. Update VP_LOGS.md, DOC.md, and DOC_COMMON.md with everything you know. List all active workers.',
      });
      await generateText({ model: anthropic(companyConfig.model), system: buildVPPrompt(department), tools, messages, stopWhen: stepCountIs(10) });
      tracker.logEvent('vp_restart', { reason: 'context_limit', totalTokens });
      // Recursive restart with fresh context
      return runVP(department, companyConfig);
    }

    // Block until a worker event arrives
    const event = await eventQueue.dequeue();
    messages.push({ role: 'user', content: formatWorkerEvent(event) });
  }
}
```

### Step 11: Secretary (onboarding) agent

**File**: `src/secretary.ts`

Interactive agent that runs in the terminal. Uses `generateText` with tools + readline for user input.

```typescript
async function runSecretary() {
  // Multi-turn conversation via readline
  // Secretary has tools: save_config, create_department_dirs
  // Asks: what repo? what departments? what responsibilities?
  // Outputs company/config.yaml + directory structure
}
```

The secretary uses `output_type` (structured output) to produce a `CompanyConfig` at the end.

### Step 12: CLI

**File**: `src/index.ts`

```typescript
import { Command } from 'commander';

const program = new Command();

program.command('setup')
  .description('Run the secretary to set up the company')
  .action(() => runSecretary());

program.command('start <slug>')
  .description('Start a VP daemon for a department')
  .action((slug) => {
    const config = loadConfig();
    const dept = config.departments.find(d => d.slug === slug);
    runVP(dept, config);
  });

program.command('status')
  .description('Show status of all departments')
  .action(() => { /* read from logs */ });

program.command('list')
  .description('List all departments')
  .action(() => { /* print config.departments */ });

program.parse();
```

### Step 13: Tests

Using `vitest`:

- **`config.test.ts`**: load/save YAML, zod validation
- **`git.test.ts`**: create/remove worktrees (temp git repo fixture via `git init`)
- **`vp-tools.test.ts`**: test tool functions in isolation, mock child_process
- **`secretary.test.ts`**: test config generation

---

## Implementation Order

1. `package.json` + `tsconfig.json` + scaffold → get `npx tsx src/index.ts` working
2. `config.ts` + test
3. `tracker.ts` + test
4. `git.ts` + test
5. `workers/types.ts` + `workers/claude-code.ts` — simplest driver first
6. Knowledge persistence: doc tools + worker CLAUDE.md generation
7. `vp/agent.ts` — all tool definitions
8. `vp/loop.ts` — daemon event loop with context limit handling + restart
9. `src/index.ts` — `start` command
10. `secretary.ts` — onboarding
11. Tests throughout

---

## Verification

1. `npx tsx src/index.ts setup` → secretary asks questions, produces `company/config.yaml`
2. `npx tsx src/index.ts start code-quality` → VP starts, spawns worker, monitors it
3. Check `company/logs/code-quality/events.jsonl` for logged events
4. Check `company/departments/code-quality/WORK.md` for VP's work log
5. `npx vitest` → all tests pass
