## Shared Knowledge
## Tooling notes
- `open_pr` auto-commits, pushes, and opens a PR. Use it instead of manual git add/commit in worktrees.
- Run `npm install` in worktrees before `npm test` — vitest may not be available otherwise.
- Run `npm test` before AND after every change to verify nothing broke.
## Code cleaning learnings
- When handling `execSync` failures, avoid `(err as any).status`; use a small type guard to safely narrow `unknown`.
- Avoid CI-brittle tests that assert presence/behavior of host tools (e.g., `pgrep`, `which`). Prefer unit-level parsing tests or integration tests gated by environment when truly needed.
- Prefer native Node APIs (e.g., `process.kill`) over shelling out, and avoid swallowing errors by default.

- Detect missing CLI tools (e.g., `pgrep`) via error message patterns like `ENOENT` / `not found` rather than relying on exit status codes, which can vary by environment.


## Worker/tooling constraints (2026-02-19)
- In this environment, workers may be restricted from reading/grepping `node_modules` directly. Prefer repo-local structural runtime checks and minimal type guards.
- When hardening message parsing, avoid changing observable output semantics (no new fallback strings / stricter filtering) unless intentionally specified and tested.


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
- Detect missing CLI tools (like `pgrep`) via thrown error text (e.g. `ENOENT` / `not found`) rather than relying on shell exit codes alone.

## Learnings: replacing `(x as any)` on external SDK messages
- Don’t depend on SDK `node_modules` `.d.ts` inspection in workers (tooling restriction + increases coupling).
- When removing `(msg as any)`, preserve *exact* user-visible string interpolation semantics; avoid introducing new fallback strings (e.g. 'unknown') or extra truthy checks that could drop content.
## Rules
- Write minimal, correct code. No unnecessary abstractions.
- Never silently swallow errors. Raise them.
- Write a comprehensive final report: what you did, what you learned, what remains.