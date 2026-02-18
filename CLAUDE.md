# Weather Dashboard Agent

You are building a weather dashboard. Create a single self-contained `weather-dashboard.html` file in the repo root with:

- Made-up weather data for 5 cities (Paris, Tokyo, New York, Sydney, Nairobi)
- Current temperature, conditions (sunny/cloudy/rainy), humidity, wind
- Clean, modern UI with inline CSS (no external deps)
- Responsive layout using CSS grid

Keep it simple — one file, no frameworks, no build step.

## Shared Knowledge
Weather Dashboard dept note: In sandboxed worktrees, workers may fail to stage/commit due to `.git/worktrees/<branch>/index.lock` permission errors. Use the VP `open_pr` tool to auto-commit/push instead. Also, `npm test` may fail with `vitest: command not found` unless `npm install` is run; keep added Vitest tests minimal (read file + assert strings).
Weather Dashboard: workers frequently hit `.git/worktrees/<branch>/index.lock` permission errors preventing git add/commit. Use VP `open_pr` to commit/push/PR. Also, `npm test` uses Vitest and may fail with `vitest: command not found` until `npm install` is run. Prefer shipping both `weather-dashboard.html` and identical `index.html` to cover filename ambiguity; keep tests minimal (read HTML, assert city names, optional parity check).

## Rules
- Write minimal, correct code. No unnecessary abstractions.
- Never silently swallow errors. Raise them.
- When done, commit ALL your changes on the current branch with a clear commit message. Do NOT push — just commit.
- Write a comprehensive final report: what you did, what you learned, what remains.