Codex provides multiple programmatic interfaces to trigger and control agents, including starting agents and handling approvals via code. The main approaches are the MCP server, the app-server protocol, the TypeScript SDK, and direct core agent control.

## Quick Answer

- **MCP server**: Run `codex mcp-server` and use JSON-RPC methods like `newConversation`, `sendUserMessage`, and respond to `applyPatchApproval`/`execCommandApproval` requests [1](#0-0) 
- **App-server protocol**: Use JSON-RPC over stdio with `thread/start`, `turn/start`, and handle bidirectional approval requests [2](#0-1) 
- **TypeScript SDK**: Use `Codex` class with `startThread()` and `run()` methods [3](#0-2) 
- **Core control**: Use `AgentControl::spawn_agent()` and submit `Op::ExecApproval`/`Op::PatchApproval` ops [4](#0-3) [5](#0-4) 

## Detailed Options

### 1. MCP Server Interface
The experimental MCP server provides a JSON-RPC API over stdio for programmatic control:

```bash
codex mcp-server | your_mcp_client
```

Key methods:
- `newConversation` - Start a new agent session
- `sendUserMessage` - Send input to the agent
- Approval requests: `applyPatchApproval` and `execCommandApproval` (server→client requests requiring `{decision: "allow"|"deny"}` response) [6](#0-5) 

### 2. App-Server Protocol
The app-server exposes a JSON-RPC protocol used by IDE extensions:

- Start threads: `thread/start` method
- Send turns: `turn/start` method  
- Handle approvals: Respond to `item/commandExecution/requestApproval` and `item/fileChange/requestApproval` server requests [7](#0-6) 

### 3. TypeScript SDK
The npm package `@openai/codex-sdk` wraps the CLI:

```typescript
import { Codex } from "@openai/codex-sdk";
const codex = new Codex();
const thread = codex.startThread();
const turn = await thread.run("Your prompt");
```

The SDK handles spawning the CLI process and exchanging JSONL events over stdin/stdout [8](#0-7) .

### 4. Core Agent Control
For direct integration, the core provides:
- `AgentControl::spawn_agent()` - Spawn new agent threads [4](#0-3) 
- Approval ops: Submit `Op::ExecApproval {id, decision}` or `Op::PatchApproval {id, decision}` to accept/reject actions [5](#0-4) 
- Collaborative tools: `spawn_agent` and `send_input` tools for agent-to-agent communication [9](#0-8) 

## Notes

- The MCP interface is experimental and may change [10](#0-9) 
- Approval flows require bidirectional communication - the server sends requests and the client must respond with decisions
- All approaches ultimately use the same core agent system and approval mechanisms under the hood

Wiki pages you might want to explore:
- [App Server and IDE Integration (openai/codex)](/wiki/openai/codex#4.5)
- [Sandboxing Implementation (openai/codex)](/wiki/openai/codex#5.6)

### Citations

**File:** codex-rs/docs/codex_mcp_interface.md (L1-179)
```markdown
# Codex MCP Server Interface [experimental]

This document describes Codex’s experimental MCP server interface: a JSON‑RPC API that runs over the Model Context Protocol (MCP) transport to control a local Codex engine.

- Status: experimental and subject to change without notice
- Server binary: `codex mcp-server` (or `codex-mcp-server`)
- Transport: standard MCP over stdio (JSON‑RPC 2.0, line‑delimited)

## Overview

Codex exposes a small set of MCP‑compatible methods to create and manage conversations, send user input, receive live events, and handle approval prompts. The types are defined in `protocol/src/mcp_protocol.rs` and re‑used by the MCP server implementation in `mcp-server/`.

At a glance:

- Conversations
  - `newConversation` → start a Codex session
  - `sendUserMessage` / `sendUserTurn` → send user input into a conversation
  - `interruptConversation` → stop the current turn
  - `listConversations`, `resumeConversation`, `archiveConversation`
- Configuration and info
  - `getUserSavedConfig`, `setDefaultModel`, `getUserAgent`, `userInfo`
  - `model/list` → enumerate available models and reasoning options
  - `collaborationMode/list` → enumerate collaboration mode presets (experimental)
- Auth
  - `account/read`, `account/login/start`, `account/login/cancel`, `account/logout`, `account/rateLimits/read`
  - notifications: `account/login/completed`, `account/updated`, `account/rateLimits/updated`
- Utilities
  - `gitDiffToRemote`, `execOneOffCommand`
- Approvals (server → client requests)
  - `applyPatchApproval`, `execCommandApproval`
- Notifications (server → client)
  - `loginChatGptComplete`, `authStatusChange`
  - `codex/event` stream with agent events

See code for full type definitions and exact shapes: `protocol/src/mcp_protocol.rs`.

## Starting the server

Run Codex as an MCP server and connect an MCP client:

```bash
codex mcp-server | your_mcp_client
```

For a simple inspection UI, you can also try:

```bash
npx @modelcontextprotocol/inspector codex mcp-server
```

Use the separate `codex mcp` subcommand to manage configured MCP server launchers in `config.toml`.

## Conversations

Start a new session with optional overrides:

Request `newConversation` params (subset):

- `model`: string model id (e.g. "o3", "gpt-5.1", "gpt-5.1-codex")
- `profile`: optional named profile
- `cwd`: optional working directory
- `approvalPolicy`: `untrusted` | `on-request` | `on-failure` | `never`
- `sandbox`: `read-only` | `workspace-write` | `external-sandbox` (honors `networkAccess` restricted/enabled) | `danger-full-access`
- `config`: map of additional config overrides
- `baseInstructions`: optional instruction override
- `compactPrompt`: optional replacement for the default compaction prompt
- `includePlanTool` / `includeApplyPatchTool`: booleans

Response: `{ conversationId, model, reasoningEffort?, rolloutPath }`

Send input to the active turn:

- `sendUserMessage` → enqueue items to the conversation
- `sendUserTurn` → structured turn with explicit `cwd`, `approvalPolicy`, `sandboxPolicy`, `model`, optional `effort`, `summary`, optional `personality`, and optional `outputSchema` (JSON Schema for the final assistant message)

Valid `personality` values are `friendly`, `pragmatic`, and `none`. When `none` is selected, the personality placeholder is replaced with an empty string.

For v2 threads, `turn/start` also accepts `outputSchema` to constrain the final assistant message for that turn.

Interrupt a running turn: `interruptConversation`.

List/resume/archive: `listConversations`, `resumeConversation`, `archiveConversation`.

For v2 threads, use `thread/list` with `archived: true` to list archived rollouts and
`thread/unarchive` to restore them to the active sessions directory (it returns the restored
thread summary).

## Models

Fetch the catalog of models available in the current Codex build with `model/list`. The request accepts optional pagination inputs:

- `pageSize` – number of models to return (defaults to a server-selected value)
- `cursor` – opaque string from the previous response’s `nextCursor`

Each response yields:

- `items` – ordered list of models. A model includes:
  - `id`, `model`, `displayName`, `description`
  - `supportedReasoningEfforts` – array of objects with:
    - `reasoningEffort` – one of `minimal|low|medium|high`
    - `description` – human-friendly label for the effort
  - `defaultReasoningEffort` – suggested effort for the UI
  - `supportsPersonality` – whether the model supports personality-specific instructions
  - `isDefault` – whether the model is recommended for most users
  - `upgrade` – optional recommended upgrade model id
- `nextCursor` – pass into the next request to continue paging (optional)

## Collaboration modes (experimental)

Fetch the built-in collaboration mode presets with `collaborationMode/list`. This endpoint does not accept pagination and returns the full list in one response:

- `data` – ordered list of collaboration mode masks (partial settings to apply on top of the base mode)
  - For tri-state fields like `reasoning_effort` and `developer_instructions`, omit the field to keep the current value, set it to `null` to clear it, or set a concrete value to update it.

When sending `turn/start` with `collaborationMode`, `settings.developer_instructions: null` means "use built-in instructions for the selected mode".

## Event stream

While a conversation runs, the server sends notifications:

- `codex/event` with the serialized Codex event payload. The shape matches `core/src/protocol.rs`’s `Event` and `EventMsg` types. Some notifications include a `_meta.requestId` to correlate with the originating request.
- Auth notifications via method names `loginChatGptComplete` and `authStatusChange`.

Clients should render events and, when present, surface approval requests (see next section).

## Tool responses

The `codex` and `codex-reply` tools return standard MCP `CallToolResult` payloads. For
compatibility with MCP clients that prefer `structuredContent`, Codex mirrors the
content blocks inside `structuredContent` alongside the `threadId`.

Example:

```json
{
  "content": [{ "type": "text", "text": "Hello from Codex" }],
  "structuredContent": {
    "threadId": "019bbed6-1e9e-7f31-984c-a05b65045719",
    "content": "Hello from Codex"
  }
}
```

## Approvals (server → client)

When Codex needs approval to apply changes or run commands, the server issues JSON‑RPC requests to the client:

- `applyPatchApproval { conversationId, callId, fileChanges, reason?, grantRoot? }`
- `execCommandApproval { conversationId, callId, command, cwd, reason? }`

The client must reply with `{ decision: "allow" | "deny" }` for each request.

## Auth helpers

For the complete request/response shapes and flow examples, see the [“Auth endpoints (v2)” section in the app‑server README](../app-server/README.md#auth-endpoints-v2).

## Example: start and send a message

```json
{ "jsonrpc": "2.0", "id": 1, "method": "newConversation", "params": { "model": "gpt-5.1", "approvalPolicy": "on-request" } }
```

Server responds:

```json
{ "jsonrpc": "2.0", "id": 1, "result": { "conversationId": "c7b0…", "model": "gpt-5.1", "rolloutPath": "/path/to/rollout.jsonl" } }
```

Then send input:

```json
{ "jsonrpc": "2.0", "id": 2, "method": "sendUserMessage", "params": { "conversationId": "c7b0…", "items": [{ "type": "text", "text": "Hello Codex" }] } }
```

While processing, the server emits `codex/event` notifications containing agent output, approvals, and status updates.

## Compatibility and stability

This interface is experimental. Method names, fields, and event shapes may evolve. For the authoritative schema, consult `protocol/src/mcp_protocol.rs` and the corresponding server wiring in `mcp-server/`.
```

**File:** codex-rs/app-server/README.md (L558-583)
```markdown
## Approvals

Certain actions (shell commands or modifying files) may require explicit user approval depending on the user's config. When `turn/start` is used, the app-server drives an approval flow by sending a server-initiated JSON-RPC request to the client. The client must respond to tell Codex whether to proceed. UIs should present these requests inline with the active turn so users can review the proposed command or diff before choosing.

- Requests include `threadId` and `turnId`—use them to scope UI state to the active conversation.
- Respond with a single `{ "decision": "accept" | "decline" }` payload (plus optional `acceptSettings` on command executions). The server resumes or declines the work and ends the item with `item/completed`.

### Command execution approvals

Order of messages:

1. `item/started` — shows the pending `commandExecution` item with `command`, `cwd`, and other fields so you can render the proposed action.
2. `item/commandExecution/requestApproval` (request) — carries the same `itemId`, `threadId`, `turnId`, optionally `reason`, plus `command`, `cwd`, and `commandActions` for friendly display.
3. Client response — `{ "decision": "accept", "acceptSettings": { "forSession": false } }` or `{ "decision": "decline" }`.
4. `item/completed` — final `commandExecution` item with `status: "completed" | "failed" | "declined"` and execution output. Render this as the authoritative result.

### File change approvals

Order of messages:

1. `item/started` — emits a `fileChange` item with `changes` (diff chunk summaries) and `status: "inProgress"`. Show the proposed edits and paths to the user.
2. `item/fileChange/requestApproval` (request) — includes `itemId`, `threadId`, `turnId`, and an optional `reason`.
3. Client response — `{ "decision": "accept" }` or `{ "decision": "decline" }`.
4. `item/completed` — returns the same `fileChange` item with `status` updated to `completed`, `failed`, or `declined` after the patch attempt. Rely on this to show success/failure and finalize the diff state in your UI.

UI guidance for IDEs: surface an approval dialog as soon as the request arrives. The turn will proceed after the server receives a response to the approval request. The terminal `item/completed` notification will be sent with the appropriate status.
```

**File:** sdk/typescript/src/codex.ts (L21-38)
```typescript
  /**
   * Starts a new conversation with an agent.
   * @returns A new thread instance.
   */
  startThread(options: ThreadOptions = {}): Thread {
    return new Thread(this.exec, this.options, options);
  }

  /**
   * Resumes a conversation with an agent based on the thread id.
   * Threads are persisted in ~/.codex/sessions.
   *
   * @param id The id of the thread to resume.
   * @returns A new thread instance.
   */
  resumeThread(id: string, options: ThreadOptions = {}): Thread {
    return new Thread(this.exec, this.options, options, id);
  }
```

**File:** codex-rs/core/src/agent/control.rs (L40-68)
```rust
    pub(crate) async fn spawn_agent(
        &self,
        config: crate::config::Config,
        prompt: String,
        session_source: Option<SessionSource>,
    ) -> CodexResult<ThreadId> {
        let state = self.upgrade()?;
        let reservation = self.state.reserve_spawn_slot(config.agent_max_threads)?;

        // The same `AgentControl` is sent to spawn the thread.
        let new_thread = match session_source {
            Some(session_source) => {
                state
                    .spawn_new_thread_with_source(config, self.clone(), session_source)
                    .await?
            }
            None => state.spawn_new_thread(config, self.clone()).await?,
        };
        reservation.commit(new_thread.thread_id);

        // Notify a new thread has been created. This notification will be processed by clients
        // to subscribe or drain this newly created thread.
        // TODO(jif) add helper for drain
        state.notify_thread_created(new_thread.thread_id);

        self.send_prompt(new_thread.thread_id, prompt).await?;

        Ok(new_thread.thread_id)
    }
```

**File:** codex-rs/protocol/src/protocol.rs (L194-208)
```rust
    /// Approve a command execution
    ExecApproval {
        /// The id of the submission we are approving
        id: String,
        /// The user's decision in response to the request.
        decision: ReviewDecision,
    },

    /// Approve a code patch
    PatchApproval {
        /// The id of the submission we are approving
        id: String,
        /// The user's decision in response to the request.
        decision: ReviewDecision,
    },
```

**File:** sdk/typescript/README.md (L17-32)
```markdown
```typescript
import { Codex } from "@openai/codex-sdk";

const codex = new Codex();
const thread = codex.startThread();
const turn = await thread.run("Diagnose the test failure and propose a fix");

console.log(turn.finalResponse);
console.log(turn.items);
```

Call `run()` repeatedly on the same `Thread` instance to continue that conversation.

```typescript
const nextTurn = await thread.run("Implement the fix");
```
```

**File:** codex-rs/core/src/tools/handlers/collab.rs (L107-191)
```rust
    pub async fn handle(
        session: Arc<Session>,
        turn: Arc<TurnContext>,
        call_id: String,
        arguments: String,
    ) -> Result<ToolOutput, FunctionCallError> {
        let args: SpawnAgentArgs = parse_arguments(&arguments)?;
        let agent_role = args.agent_type.unwrap_or(AgentRole::Default);
        let prompt = args.message;
        if prompt.trim().is_empty() {
            return Err(FunctionCallError::RespondToModel(
                "Empty message can't be sent to an agent".to_string(),
            ));
        }
        let session_source = turn.session_source.clone();
        let child_depth = next_thread_spawn_depth(&session_source);
        if exceeds_thread_spawn_depth_limit(child_depth) {
            return Err(FunctionCallError::RespondToModel(
                "Agent depth limit reached. Solve the task yourself.".to_string(),
            ));
        }
        session
            .send_event(
                &turn,
                CollabAgentSpawnBeginEvent {
                    call_id: call_id.clone(),
                    sender_thread_id: session.conversation_id,
                    prompt: prompt.clone(),
                }
                .into(),
            )
            .await;
        let mut config = build_agent_spawn_config(
            &session.get_base_instructions().await,
            turn.as_ref(),
            child_depth,
        )?;
        agent_role
            .apply_to_config(&mut config)
            .map_err(FunctionCallError::RespondToModel)?;

        let result = session
            .services
            .agent_control
            .spawn_agent(
                config,
                prompt.clone(),
                Some(thread_spawn_source(session.conversation_id, child_depth)),
            )
            .await
            .map_err(collab_spawn_error);
        let (new_thread_id, status) = match &result {
            Ok(thread_id) => (
                Some(*thread_id),
                session.services.agent_control.get_status(*thread_id).await,
            ),
            Err(_) => (None, AgentStatus::NotFound),
        };
        session
            .send_event(
                &turn,
                CollabAgentSpawnEndEvent {
                    call_id,
                    sender_thread_id: session.conversation_id,
                    new_thread_id,
                    prompt,
                    status,
                }
                .into(),
            )
            .await;
        let new_thread_id = result?;

        let content = serde_json::to_string(&SpawnAgentResult {
            agent_id: new_thread_id.to_string(),
        })
        .map_err(|err| {
            FunctionCallError::Fatal(format!("failed to serialize spawn_agent result: {err}"))
        })?;

        Ok(ToolOutput::Function {
            body: FunctionCallOutputBody::Text(content),
            success: Some(true),
        })
    }
```
