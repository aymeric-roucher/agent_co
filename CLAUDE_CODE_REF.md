Claude Code provides several programmatic ways to trigger and control agents without using the CLI directly.

## Programmatic Agent Control Options

### 1. Task Tool for Agent Invocation
Agents can be programmatically launched using the `Task` tool, which allows spawning subagents with specific configurations. This is the primary mechanism for agent-to-agent delegation [1](#0-0) .

### 2. MCP Server Integration
You can trigger agents through MCP (Model Context Protocol) servers, which expose tools with the naming pattern `mcp__servername__toolname` [2](#0-1) . This allows external systems to invoke Claude Code capabilities as tool calls.

### 3. Permission System Control
The permission system allows programmatic control over what agents can do:
- Configure `allowedTools` and `disallowedTools` to restrict agent capabilities [3](#0-2) 
- Use wildcard patterns like `mcp__server__*` to allow/deny entire server toolsets [4](#0-3) 
- PermissionRequest hooks can automatically approve/deny tool requests [5](#0-4) 

### 4. GitHub Actions Example
The codebase shows programmatic agent usage in GitHub workflows, where Claude Code is invoked with specific tool restrictions and prompts [6](#0-5) :

```yaml
claude_args: |
  --model claude-sonnet-4-5-20250929
  --mcp-config /tmp/mcp-config/mcp-servers.json
  --allowedTools "Bash(gh label list),mcp__github__get_issue,mcp__github__get_issue_comments,mcp__github__update_issue,mcp__github__search_issues,mcp__github__list_issues"
```

### 5. Background Agents
Agents can run asynchronously in the background and send messages to wake up the main agent [7](#0-6) , enabling programmatic workflows where agents work independently.

## Implementation Approach

To implement your use case of triggering agents and programmatically accepting/rejecting changes:

1. **Create a custom agent** that exposes tools for starting other agents and managing permissions
2. **Use the Task tool** to spawn Codex or other specialized agents
3. **Implement PermissionRequest hooks** to handle accept/reject decisions programmatically
4. **Configure MCP servers** if you need external system integration

The multi-agent workflow in the code-review plugin demonstrates this pattern, where a main agent delegates to multiple specialized agents and manages their outputs [8](#0-7) .

## Notes

- The Task tool is the core mechanism for programmatic agent spawning
- MCP integration allows external systems to trigger Claude Code capabilities
- Permission hooks provide fine-grained control over tool execution
- GitHub Actions demonstrate real-world programmatic usage with restricted tool access
- Background agents enable asynchronous workflows where agents can work independently and notify when complete

Wiki pages you might want to explore:
- [MCP Server Integration (anthropics/claude-code)](/wiki/anthropics/claude-code#3.5)
- [Code Review Plugin (anthropics/claude-code)](/wiki/anthropics/claude-code#4.2)

### Citations

**File:** CHANGELOG.md (L403-404)
```markdown
- Added wildcard pattern matching for Bash tool permissions using `*` at any position in rules (e.g., `Bash(npm *)`, `Bash(* install)`, `Bash(git * main)`)
- Added unified Ctrl+B backgrounding for both bash commands and agents - pressing Ctrl+B now backgrounds all running foreground tasks simultaneously
```

**File:** CHANGELOG.md (L405-405)
```markdown
- Added support for MCP `list_changed` notifications, allowing MCP servers to dynamically update their available tools, prompts, and resources without requiring reconnection
```

**File:** CHANGELOG.md (L406-408)
```markdown
- Added `/teleport` and `/remote-env` slash commands for claude.ai subscribers, allowing them to resume and configure remote sessions
- Added support for disabling specific agents using `Task(AgentName)` syntax in settings.json permissions or the `--disallowedTools` CLI flag
- Added hooks support to agent frontmatter, allowing agents to define PreToolUse, PostToolUse, and Stop hooks scoped to the agent's lifecycle
```

**File:** CHANGELOG.md (L555-555)
```markdown
- Added wildcard syntax `mcp__server__*` for MCP tool permissions to allow or deny all tools from a server
```

**File:** CHANGELOG.md (L606-606)
```markdown
- Agents and bash commands can run asynchronously and send messages to wake up the main agent
```

**File:** CHANGELOG.md (L723-723)
```markdown
- Added `PermissionRequest` hook to automatically approve or deny tool permission requests with custom logic
```

**File:** .github/workflows/claude-issue-triage.yml (L102-105)
```yaml
          claude_args: |
            --model claude-sonnet-4-5-20250929
            --mcp-config /tmp/mcp-config/mcp-servers.json
            --allowedTools "Bash(gh label list),mcp__github__get_issue,mcp__github__get_issue_comments,mcp__github__update_issue,mcp__github__search_issues,mcp__github__list_issues"
```

**File:** plugins/code-review/commands/code-review.md (L30-52)
```markdown
4. Launch 4 agents in parallel to independently review the changes. Each agent should return the list of issues, where each issue includes a description and the reason it was flagged (e.g. "CLAUDE.md adherence", "bug"). The agents should do the following:

   Agents 1 + 2: CLAUDE.md compliance sonnet agents
   Audit changes for CLAUDE.md compliance in parallel. Note: When evaluating CLAUDE.md compliance for a file, you should only consider CLAUDE.md files that share a file path with the file or parents.

   Agent 3: Opus bug agent (parallel subagent with agent 4)
   Scan for obvious bugs. Focus only on the diff itself without reading extra context. Flag only significant bugs; ignore nitpicks and likely false positives. Do not flag issues that you cannot validate without looking at context outside of the git diff.

   Agent 4: Opus bug agent (parallel subagent with agent 3)
   Look for problems that exist in the introduced code. This could be security issues, incorrect logic, etc. Only look for issues that fall within the changed code.

   **CRITICAL: We only want HIGH SIGNAL issues.** Flag issues where:
   - The code will fail to compile or parse (syntax errors, type errors, missing imports, unresolved references)
   - The code will definitely produce wrong results regardless of inputs (clear logic errors)
   - Clear, unambiguous CLAUDE.md violations where you can quote the exact rule being broken

   Do NOT flag:
   - Code style or quality concerns
   - Potential issues that depend on specific inputs or state
   - Subjective suggestions or improvements

   If you are not certain an issue is real, do not flag it. False positives erode trust and waste reviewer time.

```
