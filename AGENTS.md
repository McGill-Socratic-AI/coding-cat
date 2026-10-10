# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

## Getting a working checkout

The problem set is a submodule reached through the `src/problems` symlink, and `src/problems/problems.js` is **generated**:

```bash
git -c submodule.src/private-problems.update=none submodule update --init --recursive
npm ci && npm run build-problems   # writes src/problems/problems.js
```

Without that, `npm run build` and `tsc --noEmit` fail on `Cannot find module '../problems/problems'`.

## Sharp edge: `src/types.ts` is not import-free

`src/types.ts` imports `getCategoryList`, which imports the generated `src/problems/problems.js` at runtime. Babel erases type-only imports, so a module that imports only *types* from `src/types.ts` is safe — but importing a **runtime value** from it (a `const`, `BLANK_CONTRACT`) pulls the generated module into every Jest run, and the CI unit-test job (`.github/workflows/main.yml`, job `test`) does not run `build-problems`. Put shared runtime constants in their own module instead; `src/utils/analysisLimits.ts` is the worked example.

## Three test runners

| Scope | Command | In CI |
| --- | --- | --- |
| React app (Jest) | `npm run test` | yes |
| Browser end-to-end (Playwright) | `npm run build:e2e && npm run test:e2e` | yes |
| Edge Functions (Deno) | `cd supabase/functions/<name> && deno test --allow-env --allow-net` | **no** — run it locally before pushing |

The end-to-end suite lives in `e2e/` and runs the production bundle against the
fake backend in `e2e/mockBackend.ts`: every Supabase REST, auth and Edge
Function call is fulfilled in the browser, so it needs no Supabase project, no
credentials and spends no Socratic/Anthropic calls. Two things it does need:

- **Network for one script.** Brython (the Python runtime behind the Run
  button) executes in a web worker, and `page.route` cannot serve that worker's
  `importScripts`, so Brython still loads from its CDN as it does in a browser.
- **The `build:e2e` build, not `build`.** It points `REACT_APP_SUPABASE_URL` at
  a port nothing listens on, which is what the interception relies on.

`e2e/` is typechecked separately via `npm run typecheck:e2e`, because
`react-scripts` owns `tsconfig.json` (and that config only includes `src`).

## Where the pieces live

- Edge Functions: `supabase/functions/<name>/`, Deno runtime. See the "Edge Functions" section of `README.md` for secrets, local serve and deploy.
- Types are deliberately duplicated between `src/types.ts` (CRA) and `supabase/functions/analyze/types.ts` (Deno) — the two runtimes cannot share a file. The header comment in the latter is the contract; keep both sides in sync.
- Migrations: `supabase/migrations/`. Each file documents the queries its shape was inferred from; follow that style. `00000000000000_seed_existing_schema.sql` is for fresh projects only — read its header before applying anything to a live project.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
