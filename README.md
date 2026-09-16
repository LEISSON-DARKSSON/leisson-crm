# Leisson CRM

Kohalik müügitöölaud: Zone IMAP, inimese kinnitatud SMTP, SQLite ja ChatGPT tellimusega Codex.

## Käivitamine

Node 24+; `npm ci`, olemasolev kohalik `.env`, `npm start`.
Ava http://127.0.0.1:4310. Andmed ja postkasti paroolid jäävad `data/` ja `.env` sisse.
Algandmete import lisab ainult puuduvaid ettevõtteid; taaskäivitus ei kirjuta käsitsi parandusi üle.

## Müügi töövoog

1. Vaata päringut ja viimast inimvastust. Keeldumine, loobumine, “mitte praegu” ja olemasolev arendaja peatavad uue müügijada.
2. Kinnita vajadus ja sobiv töömaht; vali pakett ühisest `../packages/service-catalog/catalog.json` kataloogist.
3. Koosta pakkumine või vastus. Kõigi müügikirjade saatja on **gert@leisson.eu**.
4. Saatmisaken näitab saajat, teemat ja täielikku kirja. Iga saatmine vajab inimese täpset kinnitust. Teksti, saaja või allikkirja muutus tühistab kinnituse.
5. Arve ja laekumine on eraldi. Märgi raha laekunuks ainult pangaväljavõtte alusel, koos kuupäeva ja kordumatu viitega.

290 € pakett: 100% ette. 590/1190 €: 50% ette. Tasumata ettemaks ei muutu automaatselt tasutud summaks.
SMTP ebaselge tulemus jääb kontrollimiseks; automaatset kordussaatmist ei tehta.

## Codex

`node agent/worker.mjs --status` — ainult lugemine.
`node agent/conductor.mjs --dry --why` — plaani ülevaade ilma kirjutamiseta.
`node agent/probe-codex-policy.mjs` — kohaliku tööriistapoliitika kontroll.
`node agent/scheduled-run.mjs` — eraldatud sünkroonimine, otsustaja ja üks järjekorratäitja.
Tööpäeviti 08–18 Tallinnas, kontroll iga 30 minuti järel; muutuseta ei kutsuta mudelit.
Vana üldine automaatne saatja ja järelkirjade saatja peavad jääma välja lülitatuks. Loobumiste töötlemine säilib.

### Kinnitatud kampaania

Ava CRM-is **Kampaaniad**. Vali ainult asjakohased ärikontaktid, vaata üle iga saaja, teema,
täielik tekst, HTML-versioon ja allkiri ning kinnita kogu muutumatu loend ühe korraga.
Ettevalmistus ega kinnitamine ei saada kirju. Saaja, kirja, allkirja või kliendi seisu muutus
peatab selle kirja; uus variant vajab uut eelvaadet ja kinnitust. Tuttavad jäävad omaniku
müügipausiga välja. Loobumine ja inimvastus peatavad vana külmkirja.

Deterministlik töötaja on vaikimisi **väljas**, ajastajat ei paigaldata:
`CRM_CAMPAIGN_SEND_ENABLED=1 node agent/campaign-worker.mjs <kinnitatud-kampaania-id>`
teeb ühe postkasti sünkroonimise ja kõige rohkem ühe saatmiskatse. Saatja peab olema
`gert@leisson.eu`; tööaeg, päevane/tunnine piir ja minimaalne vahe kehtivad.
SMTP ebaselguse või katkestuse korral ei korrata kirja automaatselt. Kui protsess katkeb
pärast kirja võtmist, jääb see käsitsi kontrolli ootama ja peatab järgmise automaatse katse.
Ära lülita ajastajat sisse enne, kui Gert on päris kampaania täpse loendi kinnitanud.

Kampaania tulemuste vaade koondab saadetised, viimased inimvastused, kirjeldatud vajadused
ja pärast saatmist registreeritud laekumised. Ajalisest järgnevusest ei järeldu müügi põhjus.
Soovitus puudutab ainult uut ettevalmistatavat versiooni; kinnitatud kampaaniat ega hinda
ei muudeta automaatselt. Uus versioon läbib sama täieliku kinnituse.

Kampaania kinnitus salvestatakse nimega `local-crm-operator`. Kohalik `127.0.0.1` ühendus,
lubatud Origin ja CSRF-token kaitsevad teiste veebilehtede päringute eest, kuid **ei tõenda
Gerti isikut**. Sama Windowsi kasutaja õigustega kohaliku protsessi vastu see ei ole
autentimine. Enne saatja ajastamist tuleb omaniku kinnitusvoog eraldi üle vaadata.

Luna medium liigitab, Sol medium koostab/toimetab. Mudelil pole SMTP võtmeid, shelli ega saatmistööriista.
Kvoodi, autentimise või tööriistapoliitika viga peatab töö; Claude'i või tasulise API varuvarianti pole.
Jooksu ajalugu näitab tegelikke tokeneid ja teenusepakkujat. Ajalooline Claude'i dollarikulu jääb ajalooks.
Põhjalik runtime juhend: [agent/README.md](agent/README.md).

## Kontrollid ja andmed

`npm test` — kohalikud käitumiskontrollid. `npm run test:offline` — CI-s lubatud eraldatud katsed.
`node agent/mail-inventory.mjs` — kogu olemasoleva Zone konto kaustade inventuur, Seen-lippe muutmata.
`node agent/import-prouxaudit.mjs --help` — allika-ID järgi teostusabi impordi töövoog; vaikimisi eelvaade.
`node agent/proof-prouxaudit.mjs --help` — kohalik tõendipakk ilma tasulise API-ta.

Privaatne kirjavahetuse analüüs: `data/mail-strategy-audit.md`; tegevused: `data/contact-next-actions.json`.
Need ei kuulu Giti. Postkasti inventuuri täielikkus ei tähenda, et iga manust on loetud.
PROUXAUDITi päring ja veebivormi metadata on kontrollimist vajav sisend, mitte saatmisluba või ostu tõend.

Skillid asuvad `.agents/skills/`; ühised Leissoni ja PROUXAUDITi töövõtted repo `../.agents/skills/`.
