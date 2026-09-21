# Teenuse protsess — üheksa etappi

Iga etapp lõpeb ühe dokumendiga ja ühe **väravaga**.
Värav: kui tingimus ei ole täidetud, järgmist etappi ei alustata.

Täielik versioon koos põhjendustega:
https://claude.ai/code/artifact/40018028-856b-43c8-903a-babab02c37bf

| # | Etapp | Aeg | Dokument | Värav |
|---|---|---|---|---|
| 01 | Päring saabub | 0,25 h | vastuskiri + CRM-i kirje | vastuseta kolmele küsimusele → ei pakuta |
| 02 | Sobivuskõne | 0,5 h | 3 rida CRM-i | otsustaja nimetamata → pakkumist ei saadeta |
| 03 | Eeltingimuste kontroll | 0,5 h | täidetud kontrollnimekiri | puuduv tingimus läheb pakkumisse eraldi reana |
| 04 | Pakkumine | 1 h | PAKKUMINE-2026-0NN | ilma alguskuupäeva ja „mis ei ole sees" jaotiseta ei lähe välja |
| 05 | Kinnitus + ettemaks | 0,5 h | ettemaksuarve + kalendrikutse | raha ei ole kontol → tööd ei alustata |
| 06 | Teostus | 20/30/40 h | toorandmed `output/` | leid ilma numbrita ei liigu aruandesse |
| 07 | Üleandmine | 1–2 h | ARUANNE (PDF + HTML) | aruanne 24 h enne kõnet |
| 08 | Arve ja makse | 0,25 h | ARVE-2026-0NN | e-arve saaja kontroll äriregistrist |
| 09 | Kordusmõõtmine | 1 h | kordusmõõtmise leht | tehakse ka siis, kui klient ei vastanud |

## Kolm küsimust etapis 01

1. Mis on see üks asi, mis peab pärast tööd teisiti olema?
2. Kas sa oled otsustaja või vahendad?
3. Mis kuupäevaks on vaja?

## Kust tunnid tulevad

Etapid 01–05 ja 09 (~4 h) **ei ole** paketi tundide sees — need on müügi- ja hoolduskulu.
Paketi tunnid katavad etappe 06 ja 07.
990 € audit maksab reaalselt ~24 h ehk 41 €/h.
Seepärast on väravad etappides 01–03 olulisemad kui hind.

## Mida pakkumisse ei panda

- **Allahindlust** — kui hind on vale, on vale pakett.
- **Lubatud tulemust** — „LCP alla 2,5 s" on lubadus, mille täitmine ei sõltu ainult sinust.
  Auditid on töövõtuleping aruande üle; sprint on töövõtuleping **tehtud muudatuste ja
  mõõtmise** üle, mitte mõõtmistulemuse suuruse üle. Number on eesmärk, mitte lubadus.
- **Kahte varianti** — kaks hinda muudab otsuse „kumb?" asemel „kas üldse?".

## Õiguslikud väravad

- **249 € toode eraisikule:** internetis sõlmitud tarbijalepingul on 14-päevane
  taganemisõigus. Teenuse võib kohe osutada ainult tarbija **sõnaselge, märkimata
  linnukesega antud nõusoleku** alusel. Teavitamata jätmisel pikeneb tähtaeg **12 kuuni**.
- **Andmetöötlusleping (GDPR art 28)** on vaja ainult siis, kui saad ligi analüütikale,
  CRM-ile, seansisalvestustele või andmebaasile. Avaliku lehe mõõtmine seda ei nõua.
- **Ligipääsud kliendi süsteemidesse lõpevad üleandmise päeval.**
