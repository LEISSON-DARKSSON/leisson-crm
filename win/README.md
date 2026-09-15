# Leisson CRM Windowsis

## Käivitus

- `crm-server.vbs` käivitab usaldatud CRM-serveri peidetult, absoluutse skriptiteega.
- `crm-open.vbs` avab kohaliku CRM-i.
- `restart-server.ps1` peatab ainult selle CRM-i absoluutse skriptitee ja kuulava pordi järgi tõendatud protsessi. Ebamäärane vana protsess nõuab käsitsi identiteedikontrolli.
- `konduktor-hidden.vbs` käivitab `agent/scheduled-run.mjs`: postkasti sünkroonimine → otsustaja → üks Codexi järjekorratäitja.
- `install-konduktor.ps1` registreerib olemasoleva nimega ülesande vaikimisi **keelatuna**. Enne lubamist tee varukoopia ning runtime ja tööriistapoliitika kontroll.
- `install-autostart.ps1` paigaldab serveri ja töölaua otseteed.

Konduktori ajakava: tööpäeviti 08–18 Tallinna aja järgi, iga 30 minuti järel. Peidetud käivitus, IgnoreNew ja protsessilukk takistavad kattumist. Muutusteta tsükkel ei kutsu mudelit.

## Saatmine ja taastamine

Automaatne saatja ja järelkirjade saatja jäävad keelatuks. Loobumiste töötlemine jätkub.
Iga müügikirja saaja ning täpne tekst kinnitatakse CRM-is; saatja on gert@leisson.eu.

Kvoodi või autentimise viga peatab järjekorra. Kontrolli `node agent/worker.mjs --status` ja lahenda põhjus enne jätkamist. Täpne juhend on [agent/README.md](../agent/README.md).

Logid ja ülesannete varukoopiad jäävad privaatsesse `data/` kausta. Ära sulge kõiki node.exe või claude.exe protsesse; protsess peab olema selle CRM-iga tõendatult seotud.
