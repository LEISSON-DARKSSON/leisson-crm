# Eeltingimuste kontrollnimekiri

Saadetakse kliendile **enne pakkumise koostamist** (protsessi etapp 03).
Iga rida on jah/ei küsimus. Vastus „tegeleme sellega" loeb **ei**.

## Kõik teenused

- [ ] Kas sait on avalikult ligipääsetav ilma paroolita? Kui ei — kas saan tunnused testkeskkonda?
- [ ] Kas on lavastuskeskkond (staging), mis vastab toodangule?
- [ ] Kes on otsustaja parandusjärjekorra üle — nimi ja e-post?
- [ ] Kas saidil on küpsiseriba või vanusekontroll, mis blokeerib automaatse mõõtmise?
- [ ] Mitu keelt ja mitu peamist vaadet (avaleht, kategooria, toode, vorm) auditisse kuuluvad?
- [ ] Kas ma saan ligi analüütikale? **Kui jah → andmetöötlusleping (GDPR art 28).**

## Lisaks Next.js kiirussprindile

- [ ] Kas `git clone` **töötab** mulle antud kontolt? (Mitte „kas repo on olemas".)
- [ ] Kas mul on õigus luua haru ja avada pull request?
- [ ] Kas CI jookseb täna rohelisena peaharul? Kui ei — mis katki on?
- [ ] Kas `npm ci && npm run build` läbib puhtal masinal? Mis Node'i versioon?
- [ ] Kas on keskkonnamuutujaid, ilma milleta build ei tööta? Kes need annab?
- [ ] Kas hostingu projektile (Vercel vms) on mul lugemisõigus — build-logid, analüütika?
- [ ] Kas samas repos on kellegi teise pooleliolev töö, mis konflikti tekitab?
- [ ] Kes ja millal muudatused toodangusse viib — mina või teie?

## Reegel

Kolm või rohkem „ei" sprindi nimekirjas → **sprint ei alga sprindina.**
Paku 8 h ettevalmistust eraldi tööna ja sprinti pärast seda.

Puuduv eeltingimus ei blokeeri pakkumist — ta läheb pakkumisse **eraldi reana koos tundidega**.
Vaikides ta pakkumisse ei kao.
