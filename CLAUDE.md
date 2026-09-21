# leisson-crm

Local CRM for LEISSON CREATIVE: mail (IMAP/SMTP), sales pipeline, Codex-driven agents, riigihanked (public procurement) radar. Node >=22.5 (`node:sqlite`, no native deps), Windows-first, server on `127.0.0.1:4310` only. Repo `LEISSON-DARKSSON/leisson-crm`, split from a monorepo (it was `crm/`). Most code comments, UI text and gate names are Estonian.

## Layout

- `server.mjs` router + background poller; `setup.mjs` first-run; `public/` vanilla SPA (`app.js`, `views.js`, css).
- `lib/` domain rules, one module per rule set (`sendgate`, `hinnakiri`, `jarelgate`, `eelfilter`, `hanked*`, `registry`, `db`/`salesdb`/`agentdb`). `lib/shared-path.mjs` resolves files inside `@leisson/shared`.
- `agent/` workers and CLIs: `conductor` (planner), `worker`/`runtime` (Codex job queue), `scheduled-run`, `campaign-worker`, `hanked-*`, `registry-*`, `saatja`, `jarelkiri`; `prompts/`, `schemas/`. Details: `agent/README.md`.
- `win/` Windows install/ops scripts and `.vbs` launchers (`win/README.md`). `test/` gates. `tools/`: `varav.mjs` runner, `check-pin.mjs`, `dev-link.mjs`, `validate-skills.py`.
- `riigihanked/` local procurement docs (gitignored except `rhr_tools/` parity oracles). `docs/`: `ARCHITECTURE.md`, `HANDOFF-CODEX.md` (15.09 snapshot, still useful for the "why"), `plans/`.

## Commands

| Need                                                               | Command                                                                                               |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Install (needs GitHub access to leisson-shared)                    | `npm ci`                                                                                              |
| First-run setup / start / health                                   | `npm run setup` / `npm start` / `npm run doctor`                                                      |
| All offline gates (CI equivalent, a skipped gate = failure)        | `npm run varav:range`                                                                                 |
| One gate group / one gate                                          | `node tools/varav.mjs --ainult=hanked` / `node test/gate-hanked.mjs`                                  |
| Browser gates (playwright + chromium)                              | `npm run varav:brauser`                                                                               |
| `npm test` = `test/gate.mjs` (touches the LIVE db) + offline chain | avoid unless the owner asks                                                                           |
| Skills validation                                                  | `python tools/validate-skills.py`                                                                     |
| Hanked                                                             | `npm run hanked:sync` / `hanked:ajalugu [-- --kuud=1]` / `hanked:dokumendid -- --ref=<nr> [--uuesti]` |
| Registry                                                           | `npm run registry:sync` / `:enrich` / `:financials` / `:backfill` / `:update` / `:kandidaadid`        |
| Agent status, dry plan                                             | `npm run agent:status`; `node agent/conductor.mjs --dry --why`                                        |
| Link sibling shared / undo                                         | `npm run dev:link` / `npm install`                                                                    |
| Parity oracles                                                     | `npm run pariteet:gate`, `pariteet:uuenda`, `pariteet:python`                                         |

## Live data: read carefully

- Gitignored and never committed: `.env`, `data/`, `seed/`, `aruanded/`, `signature/`, `riigihanked/*` (except `rhr_tools`). Never `git add -A` blindly; `.commitmsg*` is ignored too.
- `data/crm.sqlite` is the production DB. Measure read-only: `new DatabaseSync(path, {readOnly:true})`. Never call `lib/db.mjs` `open()` on it, never `npm run seed` (`--reseed`), never read `.env` wholesale (IMAP/SMTP passwords).
- Gates must use fixtures/temp DBs (`test/fixtures/`; `test/vaba-port.mjs` picks a free port so gates never take one from the production range).
- Sending: no agent has a send tool, ever. Mail leaves only via `POST /api/send` after an exact human confirmation. `saatja` and `jarelkirjad` automation stay disabled; the campaign worker is off unless `CRM_CAMPAIGN_SEND_ENABLED=1` is set for one manual sweep.

## Agents and skills

`.agents/skills/` is what the Codex worker loads (`agent/runtime.mjs` hard-codes the names; a missing skill aborts the job with `required_skill_missing`): `leisson-mail-triage` (triage), `leisson-kirja-toimetaja` (draft/edit), `eesti-keele-toimetaja` (Estonian polish), `leisson-prospect-audit` (site audit to service mapping), `leisson-crm-agent` (operate/repair the worker). `.claude/skills/` holds separate Estonian Claude Code variants, not mirrors; when a fact (paths, catalog) changes, check both. CI runs `tools/validate-skills.py` over `.agents/skills` only (frontmatter, name == dir, <=500 lines, a verification section, local links).
The service catalog lives in the pinned package: `node_modules/@leisson/shared/service-catalog/catalog.json` (`sharedFile('service-catalog/catalog.json')`; `test/gate-shared-path.mjs` checks it resolves). Never hard-code prices: `lib/hinnakiri.mjs` is the single price source in this repo.

## Gates

- `tools/varav.mjs` auto-discovers `test/gate-*.mjs`: new gate = new file, no list to edit. `test/gate.mjs` is deliberately excluded. Browser gates must be listed in `VALJAJATED` (with a reason) and run in the CI `browser` job.
- Every gate must fail under sabotage: break the rule, watch it go red, restore (HANDOFF section 0 rule 3; a false-green already happened).
- A value lives in exactly one module and a gate forbids a second copy (prices, send limits, hours). Add a value, add a copy-forbidding gate.
- `.gitattributes` forces LF. CRLF changes byte counts and breaks `gate-pariteet` and the `.xml` fixtures on a fresh Windows checkout; never commit CRLF.

## CI (`.github/workflows/ci.yml`, PR + push to main)

- `offline`: checkout, Node 24, `npm ci`, apt `poppler-utils` (pdftotext is required by the document-reader gate), `npm run varav:range`, `python3 tools/validate-skills.py`.
- `browser`: `npm ci`, `npx playwright install --with-deps chromium`, `npm run varav:brauser`.
- Private dependency recipe (both jobs; copy it into any new job): `actions/checkout@v4` with `persist-credentials: false`; `GIT_AUTH=https://x-access-token:${{ secrets.SHARED_READ_TOKEN }}@github.com/`; `git config --global url."$GIT_AUTH".insteadOf "https://github.com/"` and `git config --global --add url."$GIT_AUTH".insteadOf "ssh://git@github.com/"` (the lockfile may resolve to ssh); then `npm ci`.
- `shared-drift.yml` (weekly Mon 06:00 + manual) runs `tools/check-pin.mjs`: fails if the pinned `@leisson/shared` tag (`package.json`, `#vX.Y.Z`) is more than a minor behind. Bump tag and lockfile together.
- Changes go through a PR; squash-merge only when `offline` and `browser` are green.

## Windows scheduled tasks

Names start with `Leisson CRM ` (no dash): `konduktor` (registered disabled by `install-konduktor.ps1`), `loobumised`, `saatja` and `jarelkirjad` (both disabled on purpose), `kampaaniad` (only via `install-kampaania.ps1`), `hanked sync`, `hanked ajalugu`. They store the ABSOLUTE checkout path: install only from the main checkout, or pass `win\install-hanked-task.ps1 -Crm <path>`; a worktree path makes the task fail silently once the worktree is gone. Moving or renaming this folder means reinstalling. Do not install, enable, disable, delete or restore any task or autostart entry on your own initiative (the owner removed one autostart deliberately on 2026-09-13). Inspect with `-Kuiv` dry runs. Server restart: `win\restart-server.ps1`; never kill all `node.exe`/`claude.exe`.

## Gotchas

- `pdftotext` is found via `PDFTOTEXT` env, PATH, then known locations (`leiaPdftotext()`). Poppler and xpdf read tables differently; a missing binary once produced NULL requirements and a wrong verdict.
- Hanked sync never overwrites `state`/`note` (the owner's own); old document folders are moved to `docs-vana-*`, never deleted.
- Local `127.0.0.1` + Origin + CSRF token is not authentication of the owner; campaign approval is stored as `local-crm-operator`.
- A post-edit formatter hook may rewrite whole files: prefer `sed`/scripts for line edits and check `git diff --stat`.
- Use `python`, not `python3`, locally (CI uses `python3`). Git Bash syntax; the `*:win` npm scripts call PowerShell.
- A few Estonian passages in skills, `agent/README.md` and `win/README.md` still say `crm/` or mention unfinished tasks; treat `crm/` as this repo root.
