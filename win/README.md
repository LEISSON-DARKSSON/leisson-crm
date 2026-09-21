# Leisson CRM Windowsis

## Käivitus

- `crm-server.vbs` käivitab usaldatud CRM-serveri peidetult, absoluutse skriptiteega.
- `crm-open.vbs` avab kohaliku CRM-i.
- `restart-server.ps1` peatab ainult selle CRM-i absoluutse skriptitee ja kuulava pordi järgi tõendatud protsessi. Ebamäärane vana protsess nõuab käsitsi identiteedikontrolli.
- `konduktor-hidden.vbs` käivitab `agent/scheduled-run.mjs`: postkasti sünkroonimine → otsustaja → üks Codexi järjekorratäitja.
- `install-konduktor.ps1` registreerib olemasoleva nimega ülesande vaikimisi **keelatuna**. Enne lubamist tee varukoopia ning runtime ja tööriistapoliitika kontroll.
- `install-autostart.ps1` paigaldab serveri ja töölaua otseteed.
- `install-hanked-task.ps1` registreerib riigihangete radari kaks ajastatud ülesannet. **Vaikimisi ei registreeri keegi seda sinu eest** — käsk on allpool.

## Riigihangete ajastatud ülesanded

| Ülesanne | Ajakava | Käsk |
| --- | --- | --- |
| `Leisson CRM hanked sync` | iga päev 07:40 | `node agent\hanked-sync.mjs` |
| `Leisson CRM hanked ajalugu` | kuu 3. päeval 05:00 | `node agent\hanked-history.mjs --kuud=1` |

Nimemuster on sama mis mujal (`Leisson CRM <nimi>`, ilma mõttekriipsuta), et `-Eemalda` leiaks nad üles ja et konsooli kodeering ei teeks nimest prügi.

```
rem kuivjooks — ei registreeri midagi
powershell -NoProfile -ExecutionPolicy Bypass -File win\install-hanked-task.ps1 -Kuiv

rem päris paigaldus
powershell -NoProfile -ExecutionPolicy Bypass -File win\install-hanked-task.ps1

rem eemaldamine (puudutab täpselt neid kahte ülesannet)
powershell -NoProfile -ExecutionPolicy Bypass -File win\install-hanked-task.ps1 -Eemalda
```

`07:40` on valitud mõõdetud ajakavade järgi: konduktor hoiab E–R 08–18 iga poole tunni tagant (`:00` ja `:30`), loobumised 08:30, saatja tööpäeval iga tund, järelkirjad 10:30. Üks jooks päevas on piisav — lihthanke tähtaeg on mediaanis 12 päeva (min 6).

`-StartWhenAvailable` teeb magamise ajal vahele jäänud jooksu järele. `-WakeToRun` on teadlikult **välja jäetud**: see on tööarvuti.

`agent\hanked-history.mjs` on olemas: kuine ajaloo import (eForms `notice_award`, kuu kaupa XML -> `hanke_lepingud`; tehing käib kuu kaupa, seega katkenud jooks jätkab pooleli jäänud kuust). Käsitsi: `node agent\hanked-history.mjs [--kuud=N] [--alates=AAAA-KK] [--uuesti]` või `npm run hanked:ajalugu`. Paigaldaja registreerib ülesande ainult siis, kui fail on olemas; kui see kaoks, jätab skript ülesande **registreerimata** ja ütleb, miks — registreeritud ülesanne puuduva failiga kukuks iga kuu vaikselt.

Öine jooks on CRM-i vaates nähtav: `agent/hanked-sync.mjs` kirjutab otsekäivitusel ise rea `hanke_runs`-i (`cmd = sync`, `boot_id = otse:…`, seega „Peata" nuppu talle ei pakuta) ja paneb oma stdout-i JSON-read selle rea `log`-veergu. Eraldi logifaili ei ole — nagu saatja puhul, on jälg andmebaasis.

Kui CRM-i server parasjagu sünkroonib, jätab ajastatud jooks end **vahele** (väljumiskood 0, põhjus stdout-is) — `hanke_runs` osaline unikaalindeks lubab ühte `käib`-rida käsu kohta. Enda katkenud jooksu (masin kustus) koristab ta ise ära; serveri oma ta ei puutu.

Konduktori ajakava: tööpäeviti 08–18 Tallinna aja järgi, iga 30 minuti järel. Peidetud käivitus, IgnoreNew ja protsessilukk takistavad kattumist. Muutusteta tsükkel ei kutsu mudelit.

## Saatmine ja taastamine

Automaatne saatja ja järelkirjade saatja jäävad keelatuks. Loobumiste töötlemine jätkub.
Iga müügikirja saaja ning täpne tekst kinnitatakse CRM-is; saatja on gert@leisson.eu.

Kvoodi või autentimise viga peatab järjekorra. Kontrolli `node agent/worker.mjs --status` ja lahenda põhjus enne jätkamist. Täpne juhend on [agent/README.md](../agent/README.md).

Logid ja ülesannete varukoopiad jäävad privaatsesse `data/` kausta. Ära sulge kõiki node.exe või claude.exe protsesse; protsess peab olema selle CRM-iga tõendatult seotud.
