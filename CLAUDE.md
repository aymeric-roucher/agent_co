## Shared Knowledge
## Tooling notes
- `open_pr` auto-commits, pushes, and opens a PR. Use it instead of manual git add/commit in worktrees.
- Run `npm install` in worktrees before `npm test` — vitest may not be available otherwise.
- Run `npm test` before AND after every change to verify nothing broke.
## Code cleaning learnings
- When handling `execSync` failures, avoid `(err as any).status`; use a small type guard to safely narrow `unknown`.
- Avoid CI-brittle tests that assert presence/behavior of host tools (e.g., `pgrep`, `which`). Prefer unit-level parsing tests or integration tests gated by environment when truly needed.
- Prefer native Node APIs (e.g., `process.kill`) over shelling out, and avoid swallowing errors by default.


## Department Knowledge
# Code Cleaning Department — DOC

## Principles we enforce
- Changes must be **smaller and more robust**, not just refactors.
- Prefer **type guards** to `(x as any)` when narrowing unknown errors.
- Avoid adding helper files/abstractions unless they clearly reduce code and risk.
- Don’t add brittle tests that depend on host tooling (e.g., `which pgrep`) in CI.

## Patterns
### Narrowing execSync errors safely
When checking `execSync` failures, don’t use `(err as any).status`. Use a small type guard:

```ts
function isExecError(err: unknown): err is Error & { status: number } {
  return err instanceof Error && typeof (err as Record<string, unknown>).status === 'number';
}
```

### Prefer native Node APIs over shelling out
- Use `process.kill(pid, 'SIGTERM')` instead of `execSync('kill ...')`.
- Avoid swallowing errors; fail loudly unless the error is explicitly expected.

## CLI hardening notes
- For process discovery, `pgrep -f` is typically less fragile than parsing `ps` output.
- Provide a fallback only when necessary; keep diffs minimal and localized.
## Rules
- Write minimal, correct code. No unnecessary abstractions.
- Never silently swallow errors. Raise them.
- Write a comprehensive final report: what you did, what you learned, what remains.