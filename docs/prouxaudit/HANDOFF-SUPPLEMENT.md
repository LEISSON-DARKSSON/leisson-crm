# HANDOFF LISA — ProUXAudit

Kirjutatud 15.09.2026.

**See ei asenda `CLAUDE.md`-d ega `docs/claude-handoff/` pakki — need on head ja
neid tuleb lugeda esimesena.** See fail parandab selle, mis neis on vananenud,
ja lisab selle, mida repos üldse ei ole.

---

## 1. Mis on repos vananenud — loe see ENNE CLAUDE.md-d

`CLAUDE.md` ja `docs/claude-handoff/PROJECT_STATE.md` kirjeldavad seisu
**„`origin/staging` at PR #24"**, merge-commit `7426daa`.

**Tegelik seis 15.09.2026: `staging` on PR #115 juures**, viimane merge
13.09.2026 23:01. Vahepeal on läinud ~90 PR-i.

| Dokumendis | Tegelikult |
|---|---|
| „after PR #24" | staging = PR #115, 13.09.2026 |
| „Public report MVP exists" | kehtib, aga selle peale on ehitatud palju: paid-audit SLA, refund safety, notification delivery, production login allowlist, subscription entitlement |
| „Repo State: clean worktree from `7426daa`" | kohalik checkout on hoopis mujal, vt § 3 |

**Kõik ülejäänu `CLAUDE.md`-s — arhitektuur, piirid, valideerimiskäsud,
testinõuded, „Non-Negotiable Boundaries" — kehtib endiselt.** Vananenud on
ainult staatuseosa. Ära viska last välja veega.

**Esimene asi, mida uus agent peaks tegema:** lugeda `git log origin/staging`
viimased ~20 commiti ja uuendada `PROJECT_STATE.md`-d. See on väike töö ja see
takistab järgmisel agendil vale seisu pealt otsustamast.

---

## 2. Väljalasketee — see EI OLE repos kirjas

**`staging` ON tootmisharu.** Vercel projekt `prouxaudit-web`, domeen
`prouxaudit.com`, repo `LEISSON-DARKSSON/PROUXAUDIT`.

```
codex/<teema>  ──PR──▶  staging  ═══▶  TOOTMINE
                                        (promote-sammu EI OLE)
```

`master` on olemas, aga see EI OLE see, kuhu tööd lähevad — kõik viimased PR-id
(#110–#115) läksid `staging`-usse.

**Merge `staging`-usse ON tootmisse väljalase.** Ei ole eraldi „promote"-nuppu
ega teist kinnitust. Seda ei ole kuskil repos kirjas ja see on kõige kallim
asi, mida valesti eeldada.

Väljalase käib nii:

```bash
npm run release:verify -- --pr=<number>
```

Gert on andnud **püsiva õiguse** ProUXAuditi väljalaseteks. Aga see õigus ei
tähenda, et `CLAUDE.md` reegel „Do not change production unless the user
explicitly says production" kaob — see tähendab, et luba on juba antud.
Roheline väravaahel on endiselt eeltingimus.

**Gerti enda põhjendus, miks vundamendiviil võib varakult minna** (tasub korrata):
puhas lisandusviil on ühe failiga tagasipööratav; kliendile nähtav parandus
teenib oma merge'i ära; lahtine haru jookseb ikka ja jälle samasse
`.closeout/slice-closeout.json` konflikti; ja hilisemad viilud kannaksid muidu
oma koopiat tokenitest, mida `staging`-us veel ei ole.

---

## 3. Kohalik checkout — kus see päriselt on

**`C:\Users\gert\Desktop\UIAI`** (mitte `Desktop\LEISSON.CREATIVE` all).

Seis 15.09.2026:

- haru `codex/paid-audit-sla-risk-hardening`
- **15 muudetud faili ja ~50 jälgimata faili** — sh terveid teenuseid
  (`productionLoginAllowlistService`, `subscriptionEntitlementService`),
  skripte, skille ja `output/*.json` tõendeid

`PROJECT_STATE.md` hoiatab juba: *„Do not use dirty desktop changes as
authority."* See hoiatus kehtib ja on praegu rohkem asjakohane kui kunagi varem.

⚠️ **Seal on jälgimata all päris tööd, mis ei ole üheski harus.** Enne kui keegi
selle checkouti puhastab, tuleb see läbi vaadata — `git clean` kustutaks
teenused, mis mujal ei eksisteeri.

---

## 4. Skillid, mis on juba olemas

Neid ei pea uuesti leiutama:

| Skill | Milleks |
|---|---|
| `prouxaudit-pr` | PR-i ettevalmistus ja väravad |
| `proux-release-verify` | väljalase `release:verify` kaudu |
| `prouxaudit-engine-change-review` | mootorimuudatuse ülevaatus |
| `prouxaudit-token-drift-slice` | tokenite triivi parandus |
| `prouxaudit-grant-pro-account` | Pro-konto andmine |
| `proux-content-slice` | sisuviil |
| `proux-mobile-polish-pass` | mobiiliviimistlus |
| `proux-ai-handoff` | üleandmine |

Repos on lisaks `.agents/skills/` all kohalikke skille (jälgimata, vt § 3).

---

## 5. Lõksud, mis on raha või aega maksnud

**Vercel lükkab tagasi `gertleisson-sys` autorluse.** Commit peab olema autoriks
LEISSON / `gertleisson@gmail.com`, muidu deploy ei lähe läbi. Sama kehtib
leisson.eu kohta.

**`.closeout/slice-closeout.json` on korduv konfliktikoht.** Iga lahtine haru,
mis seda faili puudutab, jookseb varem või hiljem sama konflikti otsa. Seepärast
on parem viil varakult sisse viia kui pikalt lahti hoida.

**Migratsioonide metaandmete triiv.** PR #24 ajal tuli
`0015_public_report_shares.sql` rakendada eelvaate-andmebaasi otse, sest
`drizzle/meta/_journal.json` oli sihtbaasiga eri seisus. **Enne tootmisse
viimist tuleb Drizzle'i migratsiooniseis sihtbaasiga võrrelda.** Käsitsi
lapitud eelvaatebaas ei tõesta tootmisvalmidust.

**Eelvaate tõend ei ole tootmise tõend.** See on `CLAUDE.md`-s kirjas ja seda
rikutakse kõige sagedamini.

---

## 6. Suhe teiste projektidega

- **leisson.eu** (`LEISSON-DARKSSON/leisson-greative`, Vercel `leisson-creative`):
  väljalase `git push origin main:release/production`. Siin on Production Branch
  `release/production` ja `main` teeb ainult eelvaateid — **vastupidi ProUXAuditile**,
  kus `staging` ongi tootmine. Ära aja neid segi.
- **Leisson CRM** (`Desktop\LEISSON.CREATIVE\Leisson Creative\crm`): müügitoru,
  mis ProUXAuditi teenuseid müüb. Vt `crm/docs/HANDOFF-CODEX.md`. Hinnakirjas on
  „UX-audit Pro 249 €" märkega *prouxaudit.com — eraldi bränd, mitte selle
  redeli aste*: CRM ei paku seda külmkirjas.
- **AgroNutikas**: eraldi maailm, oma reeglid (ADR 0009/0010, Production Branch
  `release/production`). Ei puutu siia.

---

## 7. Mida uus agent peaks kõigepealt tegema

1. `git log origin/staging --oneline -20` — vaata, mis on PR #24 järel juhtunud.
2. Uuenda `docs/claude-handoff/PROJECT_STATE.md` ja `CLAUDE.md` staatuseosa.
3. Vaata `C:\Users\gert\Desktop\UIAI` jälgimata failid läbi — seal on päris tööd.
4. Alles siis võta järgmine ülesanne `CLAUDE.md` „How To Choose Next Tasks"
   järjekorra järgi.
