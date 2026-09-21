# AGENTS.md (tool-neutral)

Local CRM (Node >=22.5, `node:sqlite`, `127.0.0.1:4310`, Windows-first) for LEISSON CREATIVE: mail, sales pipeline, agents, riigihanked radar. Full guidance: [CLAUDE.md](CLAUDE.md). Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). History and "why": [docs/HANDOFF-CODEX.md](docs/HANDOFF-CODEX.md) (15.09 snapshot; its old `crm/` paths now start at this repo root).

## Rules that must not be broken

1. Agents have NO send tool. Mail is sent only through `POST /api/send` after an exact human confirmation of recipient and full text. `saatja` and `jarelkirjad` automation stay disabled.
2. Every claim in a customer email is measured; no measurement, no email.
3. Every gate must fail under sabotage; a green gate proves nothing until you have broken the rule once.
4. One value, one module (prices `lib/hinnakiri.mjs`, send limits `lib/sendgate.mjs`, cadence `lib/jarelgate.mjs`); a gate forbids a second copy.
5. Live data is private: never commit `.env`, `data/`, `seed/`, `aruanded/`, `signature/`, `riigihanked/*` (except `rhr_tools`). Never read `.env` wholesale. `data/crm.sqlite` is production: read it only with `new DatabaseSync(path,{readOnly:true})`, never `lib/db.mjs open()`.
6. Do not create, enable, disable, delete or restore Windows scheduled tasks (`Leisson CRM *`) or autostart entries unless the owner asks in the current session. Tasks are installed from this checkout via `win/install-*.ps1` (absolute paths).
7. `@leisson/shared` is pinned by tag in `package.json`. The service catalog is `node_modules/@leisson/shared/service-catalog/catalog.json` (`sharedFile()` in `lib/shared-path.mjs`). Change it in `../leisson-shared`, tag, then bump the pin; `npm run dev:link` links the sibling for local co-development (undo: `npm install`).

## Commands

- `npm ci`, `npm start`, `npm run doctor`
- `npm run varav:range` offline gates (what CI runs); `npm run varav:brauser` browser gates; `python tools/validate-skills.py`
- `npm test` also runs `test/gate.mjs` against the live DB: avoid.
- `npm run hanked:sync`, `hanked:ajalugu`, `hanked:dokumendid -- --ref=<nr>`; `npm run registry:update`

## Conventions

- New gate: add `test/gate-*.mjs` (auto-discovered by `tools/varav.mjs`). Browser gates need a `VALJAJATED` entry there.
- LF line endings are enforced by `.gitattributes`; do not commit CRLF.
- Codex worker skills live in `.agents/skills/` (names hard-coded in `agent/runtime.mjs`); keep `.claude/skills/` consistent.
- Changes go through a PR; CI jobs `offline` and `browser` must be green (private-dependency recipe in CLAUDE.md).
