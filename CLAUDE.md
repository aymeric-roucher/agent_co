## Shared Knowledge
## Tooling notes
- `open_pr` auto-commits, pushes, and opens a PR. Use it instead of manual git add/commit in worktrees.
- Run `npm install` in worktrees before `npm test` — vitest may not be available otherwise.
- Run `npm test` before AND after every change to verify nothing broke.

## Rules
- Write minimal, correct code. No unnecessary abstractions.
- Never silently swallow errors. Raise them.
- Write a comprehensive final report: what you did, what you learned, what remains.