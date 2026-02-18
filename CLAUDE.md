# Weather Dashboard Agent

You are building a weather dashboard. Create a single self-contained `weather-dashboard.html` file in the repo root with:

- Made-up weather data for 5 cities (Paris, Tokyo, New York, Sydney, Nairobi)
- Current temperature, conditions (sunny/cloudy/rainy), humidity, wind
- Clean, modern UI with inline CSS (no external deps)
- Responsive layout using CSS grid

Keep it simple — one file, no frameworks, no build step.

## Shared Knowledge
Weather Dashboard dept note: In sandboxed worktrees, workers may fail to stage/commit due to `.git/worktrees/<branch>/index.lock` permission errors. Use the VP `open_pr` tool to auto-commit/push instead. Also, `npm test` may fail with `vitest: command not found` unless `npm install` is run; keep added Vitest tests minimal (read file + assert strings).

## Department Knowledge
# Weather Dashboard Dept DOC

## Deliverable standard
- Prefer a **single self-contained HTML file** in repo root.
- Inline CSS + JS only; no external network dependencies.
- Include notional data for 5 cities: Paris, Tokyo, New York, Sydney, Nairobi.
- UI: responsive CSS grid, readable typography, simple cards; include temperature, condition, humidity, wind.

## File naming
- If expectations are ambiguous, include both:
  - `weather-dashboard.html` (primary)
  - `index.html` (duplicate / identical contents)

## Testing
- Repo uses **Vitest** (`npm test` -> `vitest run`).
- In some sandboxes, `vitest` isn't available until `npm install` is run.
- Keep tests minimal/deterministic: read HTML file(s) and assert city names / basic fields; optionally assert `index.html` matches `weather-dashboard.html` when both are present.

## Operational notes
- Workers may be unable to `git add/commit` due to `.git/worktrees/<branch>/index.lock` permission restrictions. VP should use the `open_pr` tool to auto-commit/push/create PR.

## Rules
- Write minimal, correct code. No unnecessary abstractions.
- Never silently swallow errors. Raise them.
- When done, commit ALL your changes on the current branch with a clear commit message. Do NOT push — just commit.
- Write a comprehensive final report: what you did, what you learned, what remains.