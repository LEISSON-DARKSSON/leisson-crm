# leisson-crm

Local CRM for LEISSON CREATIVE: mail (IMAP/SMTP), sales pipeline, agents, riigihanked radar. Windows-first, runs locally.

- Shared code lives in `leisson-shared` (`@leisson/shared`, pinned tag in package.json). Sibling checkouts: `../leisson-shared`, `../leisson-site`.
- Edit shared and CRM together: `npm run dev:link` (links `../leisson-shared`), undo with `npm install`.
- Offline gates: `npm run varav:range`. Browser gates: `npm run varav:brauser`.
- Never commit: `.env`, `data/`, `seed/`, `aruanded/`, `signature/`, `riigihanked/*` (except `rhr_tools`). They are gitignored on purpose.
- Windows scheduled tasks are installed from THIS checkout (`win/install-*.ps1`); moving the folder means reinstalling them.
