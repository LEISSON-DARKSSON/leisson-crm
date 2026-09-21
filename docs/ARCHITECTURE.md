# Architecture

One local Node process plus a few scheduled CLI jobs, all around one SQLite file. Nothing is exposed beyond `127.0.0.1:4310`.

## Components

| Component            | Where                                                                               | Role                                                                                                                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP server + poller | `server.mjs`, `public/`                                                             | Zero-dependency router, vanilla SPA, background mail poller. Host, Origin and CSRF checks; loopback only.                                                                                            |
| Database             | `data/crm.sqlite` (`node:sqlite`, WAL), `lib/db.mjs`, `salesdb.mjs`, `agentdb.mjs`  | Companies, messages, activity, drafts, agent queue, hanked tables. Live data, gitignored.                                                                                                            |
| Mail                 | `lib/mail.mjs`, `agent/sync-mail.mjs`, `lib/outbound.mjs`                           | IMAP read (imapflow, mailparser), SMTP send (nodemailer). Source account is scoped (`lib/mail-source-scope.mjs`).                                                                                    |
| Send gate            | `lib/sendgate.mjs`, `POST /api/send`                                                | The only path out. Limits, work hours, opt-out line added server-side, exact human confirmation.                                                                                                     |
| Agents               | `agent/conductor.mjs`, `worker.mjs`, `runtime.mjs`, `scheduled-run.mjs`             | Deterministic planner and a Codex job queue (triage, draft, edit). No shell, SMTP or send tool for the model; input is prepared and JSON output applied by `runtime.mjs`.                            |
| Campaigns            | `lib/campaign.mjs`, `agent/campaign-worker.mjs`                                     | Owner-approved immutable recipient list; worker off by default.                                                                                                                                      |
| Hanked radar         | `agent/hanked-sync.mjs`, `hanked-history.mjs`, `hanked-docs.mjs`, `lib/hanked*.mjs` | RHR RSS to `hanked`, eForms XML to `hanke_lepingud`, tender documents to `riigihanked/<ref>/docs/` (text via `pdftotext`), score and verdict. Runs are logged in `hanke_runs`. Never sends anything. |
| Registry             | `agent/registry-*.mjs`, `lib/registry.mjs`                                          | Company registry sync, enrichment, financials, candidates.                                                                                                                                           |
| Windows layer        | `win/`                                                                              | Task installers, launchers, ops scripts.                                                                                                                                                             |
| Gates                | `test/gate-*.mjs`, `tools/varav.mjs`                                                | Fixture-based behavior checks; see CI.                                                                                                                                                               |

## Data flow

```
IMAP (Zone) --sync--> messages --eelfilter (free)--> classified
                          |                              |
                          +--> conductor (plan) --> agent queue --> worker/runtime (Codex)
                                                      triage -> draft -> edit
                                                                  |
                                              drafts (awaiting approval) --> UI --> human click
                                                                  |
                                          POST /api/send --> sendgate --> SMTP --> activity(sent)

RHR RSS -----hanked:sync-----> hanked  --+
RHR eForms --hanked:ajalugu--> hanke_lepingud --+--> score / verdict --> Riigihanked tab
RHR docs ----hanked:dokumendid--> riigihanked/<ref>/docs (pdftotext) --+   (owner state/note never overwritten)

@leisson/shared (pinned tag) --sharedFile()--> Orbit tokens/CSS for UI and signature; service catalog for agents and humans
```

Shared assets resolve through `lib/shared-path.mjs` (`require.resolve('@leisson/shared/...')`); today the code reads `orbit-tokens/*` (`server.mjs`, `lib/signature.mjs`), while the service catalog (`service-catalog/catalog.json`) is read by agents/skills and checked by `test/gate-shared-path.mjs`.

## Scheduled tasks (Windows Task Scheduler)

| Task                         | Installer                     | Schedule / state                                                |
| ---------------------------- | ----------------------------- | --------------------------------------------------------------- |
| `Leisson CRM konduktor`      | `win/install-konduktor.ps1`   | Mon-Fri 08-18 every 30 min; installed disabled                  |
| `Leisson CRM loobumised`     | `win/install-saatja.ps1`      | daily, before the conductor window; opt-out processing stays on |
| `Leisson CRM saatja`         | `win/install-saatja.ps1`      | disabled on purpose                                             |
| `Leisson CRM jarelkirjad`    | `win/install-saatja.ps1`      | disabled on purpose                                             |
| `Leisson CRM kampaaniad`     | `win/install-kampaania.ps1`   | only on explicit owner activation                               |
| `Leisson CRM hanked sync`    | `win/install-hanked-task.ps1` | daily 07:40                                                     |
| `Leisson CRM hanked ajalugu` | `win/install-hanked-task.ps1` | 3rd of month 05:00, `--kuud=1`                                  |

Plus a login autostart and desktop shortcut from `win/install-autostart.ps1`. Tasks hold absolute paths of the checkout they were installed from. Current per-machine state may differ; check with `Get-ScheduledTask -TaskName 'Leisson CRM*'` (read-only).

## CI and dependency pipeline

- `@leisson/shared` is a private GitHub dependency pinned by tag (`git+https://github.com/LEISSON-DARKSSON/leisson-shared.git#v1.0.0`). Sibling repos: `../leisson-shared` (package), `../leisson-site` (public site, consumes the same package). Local co-development: `npm run dev:link`.
- CI (`.github/workflows/ci.yml`): `offline` (`npm ci`, poppler, `npm run varav:range`, skills validation) and `browser` (playwright chromium, `npm run varav:brauser`). Both fetch the private package with `SHARED_READ_TOKEN` via `git config url.insteadOf` for https and ssh, with `persist-credentials: false`.
- `shared-drift.yml` weekly runs `tools/check-pin.mjs` so the pin cannot fall more than a minor behind.

## Key decisions

- Local-first, no cloud: data and mailbox credentials never leave the machine; loopback binding is the access control (not owner authentication).
- Human-in-the-loop sending: models classify and draft, a person confirms the exact text; ambiguous SMTP results are never auto-retried.
- Deterministic first: free `eelfilter` before any model call; unchanged state means the conductor does not invoke a model.
- Rules over vibes: one module per rule set, gates forbid duplicates, gates must survive sabotage.
- `node:sqlite` and few dependencies (imapflow, mailparser, nodemailer; playwright dev-only) to keep the Windows install trivial.
- Ownership of data: hanked sync updates discovery fields only; owner fields (`state`, `note`) and manual fixes are never overwritten; seed import only adds missing companies.
- Shared code lives in a versioned package rather than sibling paths, so CI and clones work without a monorepo layout.
