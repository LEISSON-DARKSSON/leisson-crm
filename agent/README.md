# CRM-i Codexi töötaja

Kiri → liigitus → versiooniga mustand → eraldi keeletoimetus → kasutaja ülevaatus.
Saatmine jääb CRM-i serverisse ning nõuab saaja ja täpse teksti kinnitamist.

## Käivitus ja õigused

Töötaja kasutab ChatGPT autentimist, mitte OpenAI API võtit ega Claude'i varuvarianti.
Mudelid: liigitus `gpt-5.6-luna`, mustand ja toimetamine `gpt-5.6-sol`, effort `medium`.
CLI käivitatakse otse peidetud protsessina, `shell:false`, stdin kaudu antava sisendiga.

Iga töö eel kontrollib `policy-probe.mjs` sama CLI, mudelikataloogi ja lippe kohaliku HTTP/WebSocket serveriga.
Kontroll kasutab võltsautentimist ning ei saada päringut tasulisele mudelile.
Tegelikust mudelipäringust on lubatud ainult tegevuseta `request_user_input`; shell, kirjutamine,
veeb, brauser, MCP, connectorid, tööriistaotsing ja alamagentide loomine peavad puuduma.
Kui päringut ei õnnestu kontrollida või sinna ilmub uus tööriist, jääb töö pausile.

Mudelikataloogis eemaldatakse tööriistu sundivad Code Mode ja multi-agent sätted.
Üksnes funktsioonilippudest ei piisa: seda tõestas kohaliku CLI 0.154.0 kontroll.
CLI uuendamine ei möödu kontrollist, sest kontroll tehakse iga mudelitöö eel uuesti.
Usaldatud baasjuhis on lühike model-instructions.md; rollispetsiifilised Codexi skillid loetakse kõvakodeeritud nimekirjast. Puuduv skill peatab töö enne mudelikutset.

CLI vajab olemasolevat mudelikataloogi `$CODEX_HOME/models_cache.json`.

Päris töö saab eraldi ajutise töökataloogi ja CODEX_HOME-i, kuhu kopeeritakse ainult ChatGPT autentimine
ning piiratud kataloog. Värskendatud ChatGPT tokenid säilivad privaatselt crm/data/codex-auth-cache all; võtmes on algse autentimise räsi ja konto identiteet. Üks kirjutaja ning atomaarne faili asendamine väldivad võistlust. Kasutaja globaalset auth.json faili ei muudeta. Uus kasutajalogin loob uue lähteidentiteedi.
Kasutaja konfiguratsioon, reeglid, pluginad, hook'id ja projekti juhised
ei laadu. Protsessi keskkond ei sisalda SMTP/IMAP ega API saladusi. Mudelile ei anta CRM-i failiteed.

`mcp-server.mjs` on nüüd alati ainult loetav, ka siis kui vana konfiguratsioon määrab `CRM_AGENT_MODE=write`.
Mudel ei kasuta seda serverit: `runtime.mjs` valmistab ette piiratud andmesisendi ja rakendab kontrollitud JSON-i tehinguna.

## Järjekord ja mustandid

- `enqueue()` eemaldab sama tüübi ja allikaversiooni duplikaadid.
- `claimNext()` kasutab SQLite'i kirjutustehingut, atomaarset uuendust ja 15-minutilist tööõigust.
- Katkenud tööõigus läheb inimese ülevaatusse. Vana töötaja ei saa hiljem tulemust salvestada.
- Allikakiri ja mustand kontrollitakse uuesti vahetult enne salvestamist.
- Keeletoimetus tekib alles pärast eduka mustandi salvestamist ning nõuab täpset mustandiversiooni.
- Saadetud või käsitsi muudetud mustandit ei kirjutata üle.
- Keeletoimetus ei tohi muuta arve, hindu, veebiaadresse või e-posti aadresse.
- Algkirja keeldumine, aegumine, puuduv sisu, kahtlus või muutunud identiteet blokeerib mustandi.
- `agent_draft_versions` säilitab muutumatu sisuajaloo. See ei ole vana saadetud posti tagantjärele tõend.

Päevane piir on vaikimisi 24 mudelitööd (`AGENT_MAX_RUNS_DAILY`), ühe `--drain` jooksul kuni kuus.
Konduktor valib kuni kolm uut mustandit päevas ja kuni kümme kirja liigituspaki kohta.
Automaatne liigitus hõlmab viimase 21 päeva kirju. Vanema arhiivi läbivaatus vajab selgesõnalist kirja-ID valikut.
Kvoodi- või autentimisviga peatab kogu töötaja. Automaatset mudeli-/teenusepakkujavahetust pole.
Ajalooline Claude'i dollarikulu säilib; Codexi kasutus salvestatakse tokenites ja kestuses, API maksumus on nullväärtus.

## Käsud

Käivita CRM-i kataloogist:

```text
node agent/conductor.mjs --dry
node agent/worker.mjs --status
node agent/worker.mjs --dry
node agent/dryrun.mjs
node agent/probe-codex-policy.mjs
node --test agent/runtime.test.mjs
node agent/regression.mjs --dry
```

Esimesed neli käsku ei muuda andmebaasi ega loo faile.
Poliitikakontroll loob ja eemaldab ainult oma ajutised katsefailid.
Regressiooni vaikimisi režiim ei kasuta mudelit; `--live` kasutab Codexi tellimuse kvooti.

Tavatöö:

```text
node agent/conductor.mjs
node agent/worker.mjs --drain
node agent/worker.mjs --enqueue=draft --message=INBOX:123
node agent/worker.mjs --resume --drain
```

`--resume` kasuta alles pärast kvoodi või autentimise põhjuse lahendamist.
Tõrke järel säilivad järjekord ja mustandid. Ära lülita vana saatjat või Claude'i tagasi sisse.
SMTP saatmise kontrollid ja ajastatud ülesannete paigaldus kuuluvad CRM-i serveri ning Windowsi käivituse juhistesse.

## Kontrollid

`runtime.test.mjs` kasutab eraldi ajutisi SQLite'i baase; ei ava päris postkasti ega saada kirju.
Testid hõlmavad kaht konkureerivat protsessi, tööõiguse aegumist, duplikaate, allika muutumist,
keeldumist, mustandiversioone, kvoodipausi, schema lisavälju, õigusi ja kuivjooksu failide puutumatust.
Poliitikakontroll tõendab tegelikku tööriistaloendit; see ei mõõda liigituse keelelist kvaliteeti.

Avalik Codexi seadistusviide: https://developers.openai.com/codex/config-reference/
Kohaliku CLI `exec --help` ja `features list` on toetatud lippude esimene kontrollallikas.

## Ainult loetav MCP ühilduvusliides

Tööriistad: list_inbox, get_message, search_companies, get_company, get_pricing, next_step_offer, list_groups.
Tööriistu ei anta mudelile. Vanad MCP write-konfiguratsioonid jäävad alati ainult loetavaks.

## Ajastatud käivitus

win/install-konduktor.ps1 registreerib ainult keelatud ülesande. Pärast kontrollitud pilooti saab omanik selle sisse lülitada. Tööpäevadel 08:00–18:00 Tallinna ajas on intervall 30 minutit. Peidetud käivitaja kasutab native Node’i ning argumentide loendit, ilma inline shellikoodita. scheduled-run.mjs kaitseb kattuvat käivitust ka protsessilukuga.

Järjekord on sync-mail.mjs (täielikud kehad, loobumiste kooskõlastus) → conductor.mjs → worker.mjs. Sünkroonimistõrge peatab enne mudelitööd. --dry ei käivita lapsprotsesse ega muuda faile.

### Mittesalajased piirangud

Järjekorra eelvaade loeb `AGENT_MAX_DRAFTS` (3), `AGENT_MAX_AGE_DAYS` (21), `AGENT_TRIAGE_BATCH` (10) ja `AGENT_MAX_RUNS_DAILY` (24) protsessi keskkonnast. Selleks ei loeta postkasti `.env`-faili ega nõuta IMAP-/SMTP-kontot. Piirangud ei tähista dollarieelarvet; kvoodi lõppemisel peatub Codexi töötaja.
