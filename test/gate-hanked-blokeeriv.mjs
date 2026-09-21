// VARAV: isikupohine blokeeriv kvalifikatsiooninoue peab verdikti liigutama.
//
// MIKS (mõõdetud 21.09.2026, hange 315437, TTJA „Rakendusuuring andmepõhise
// riskihindamise ja ohuprognooside metoodika väljatöötamiseks"):
// selle hanke AINUS tehnilise pädevuse tingimus oli doktorikraad või kehtiv
// doktorantuuri staatus ühel võtmeeksperdil. Rolle nõuti ÜKS, käibenõuet ei
// olnud — ehk mõlemad senised alltöövõtuväravad (`rollid >= 3`, `käive > 50k`)
// vaikisid ja radar andis verdikti KAALU skooriga 45. Päris vastus on, et
// LEISSON ei kvalifitseeru sellele hankele üksi ÜLDSE. Inimene pidi selle
// PDF-idest käsitsi välja lugema.
//
// Laused allpool on PARIS laused nendest dokumentidest, mitte välja mõeldud.
import { strict as assert } from 'node:assert';
import { leiaBlokeeriv, koguLeiud, leiaKvaliteet } from '../lib/hanked-leiud.mjs';
import { score } from '../lib/hanked.mjs';

// --- 1. Paris lause Lisa 4-st annab KINDLA leiu ----------------------------
const LISA4 = 'Vähemalt ühel võtmeeksperdil (nt andmeanalüütikul või andmeteaduse '
  + 'eksperdil) peab olema: doktorikraad või sellele vastav kvalifikatsioon või '
  + 'pakkumuste esitamise tähtpäeval kehtiv doktorantuuris õppimise staatus.';
{
  const r = leiaBlokeeriv(LISA4, 'Lisa 4 - Nouded meeskonnale.pdf');
  assert.deepEqual(r.nouded, ['doktorikraad'], 'Lisa 4 lause peab andma kindla blokeeriva nõude');
  const l = r.leiud.find((x) => x.noue === 'doktorikraad');
  assert.equal(l.kindlus, 'kindel');
  assert.equal(l.fail, 'Lisa 4 - Nouded meeskonnale.pdf', 'leid peab kandma failinime (tõendireegel R1)');
  assert.ok(l.lause.includes('doktorikraad'), 'leid peab kandma lauset, millest ta tuli');
}

// --- 2. HINDAMINE ei ole kvalifitseerimine ---------------------------------
// Kui doktorikraad on hindamiskriteerium (annab punkte), siis hanget EI TOHI
// käest anda. Vale ALLTÖÖVÕTT ei anna endast kunagi märku — seda viga ei näe.
{
  const r = leiaBlokeeriv('Kõrgemalt hinnatakse pakkujat, kelle meeskonnas on doktorikraadiga ekspert.');
  assert.deepEqual(r.nouded, [], 'hindamise kontekstis ei tohi tekkida kindlat blokeerivat nõuet');
  assert.equal(r.leiud[0].kindlus, 'kontrolli', 'leid peab jääma nähtavaks märkega kontrolli');
  assert.match(r.leiud[0].markus, /kriteerium/, 'põhjus peab ütlema, MIKS ta ei loe');
}

// --- 3. Vabatahtlik kaasamine ei ole noue ---------------------------------
{
  const r = leiaBlokeeriv('Pakkuja võib kaasata täiendavalt doktorikraadiga eksperte.');
  assert.deepEqual(r.nouded, [], 'võib/täiendavalt = vabatahtlik, mitte nõue');
}

// --- 3b. SEADUSETSITAAT ei ole selle hanke noue --------------------------
// Paris lause 315437 hankepassist. Ta andis esimeses versioonis kindla nõude
// „kutsetunnistus", mida see hange ei nõudnud.
{
  const r = leiaBlokeeriv('Viide seadusele: RHS § 101 lg 1 p 6 „andmed pakkuja või taotleja, '
    + 'tema juhtide või teenuste osutamise eest vastutavate isikute hariduse ja '
    + 'kutsekvalifikatsiooni kohta, kui need on vastavate teenuste osutamiseks vajalikud".');
  assert.deepEqual(r.nouded, [], 'seadusetsitaadist ei tohi tekkida kindlat nõuet');
  assert.match(r.leiud[0].markus, /seadusetsitaat/, 'põhjus peab ütlema, et tegu on tsitaadiga');
}

// --- 4. Kutsetunnistus ja atesteering on sama laadi varav ----------------
{
  assert.deepEqual(leiaBlokeeriv('Projektijuhil peab olema kehtiv kutsetunnistus tase 6.').nouded,
    ['kutsetunnistus']);
  assert.deepEqual(leiaBlokeeriv('Töid juhtiv isik peab olema volitatud insener.').nouded,
    ['atesteering']);
}

// --- 5. koguLeiud koondab ja score() muudab verdikti ---------------------
{
  const leiud = koguLeiud([{ nimi: 'Lisa 4 - Nouded meeskonnale.pdf', tekst: LISA4 }]);
  assert.deepEqual(leiud.blokeerivad, ['doktorikraad']);
  assert.equal(leiud.rollid, null, '315437 nõudis ÜHT rolli — rollivärav peab jääma vaikseks');
  assert.equal(leiud.kaiveNoue, null, '315437-l käibenõuet ei olnud');

  // Sama hange, mis andis 21.09.2026 verdikti KAALU / 45.
  const hange = { title: 'Rakendusuuring andmepõhise riskihindamise ja ohuprognooside metoodika väljatöötamiseks',
    menetlus: 'Lihthange', segment: 'nišš', deadline: '2026-09-25' };
  const ilma = score(hange, { docs: { rollid: 1 } });
  const koos = score(hange, { docs: { rollid: 1, blokeerivad: leiud.blokeerivad } });
  assert.notEqual(ilma.verdict, 'ALLTÖÖVÕTT', 'ilma blokeeriva nõudeta oli verdikt muu — see oli täpselt viga');
  assert.equal(koos.verdict, 'ALLTÖÖVÕTT', 'blokeeriv nõue peab andma verdikti ALLTÖÖVÕTT');
  assert.equal(koos.points, ilma.points - 25, 'värav maksab -25 punkti, täpselt üks kord');
  assert.ok(koos.why.some((w) => /isikup[õo]hine n[õo]ue/.test(w)),
    'põhjus peab ütlema, MIS nõue verdikti muutis: ' + JSON.stringify(koos.why));
}

// --- 6. Kvaliteedikaal uhikuveeruga tabelireast --------------------------
// 315437 hindamiskriteeriumide tabel: osakaal 60 EI OLE rea lõpus, tema järel
// on veel ühikuveerg „Punkt". Ilma selle kujuta jäi kvaliteedikaal NULL-i
// hankel, kus kvaliteet kaalub rohkem kui hind (60 vs 40).
{
  const rida = '  2    Proovitöö      Pakkuja esitatud projektiplaani kvaliteeti Kvaliteet - hankija              60                           Punkt';
  const r = leiaKvaliteet(rida, '315437_hindamiskriteeriumid.pdf');
  assert.equal(r.kaal, 60, 'ühikuveeruga tabelirida peab andma kvaliteedikaalu 60');
  assert.equal(r.kindel, true);
}

// --- 7. NEGATIIVTEST: vana vale leid ei tohi tagasi tulla ---------------
// Hange 312645, fail „20260804 Pakkumuse esitamise ettepanek.docx": siit luges
// varasem versioon kvaliteedikaaluks 100, kuigi tegelik kaal on 15. Number on
// SIDEKRIIPSUGA sõna küljes, seega ühikukuju ei tohi teda püüda.
{
  const rida = 'Pakkumusi hinnatakse hindamiskriteeriumitele (sh hindamismetoodikale) vastavalt 100-VÄÄRTUSPUNKTI süsteemis kvaliteedi ja hinna alusel.';
  const r = leiaKvaliteet(rida, '312645.docx');
  assert.notEqual(r.kaal, 100, 'sidekriipsuga seotud number ei ole osakaal — see viga oli juba korra');
}

console.log('OK gate-hanked-blokeeriv: doktorikraad/kutse annab ALLTÖÖVÕTT, hindamiskeel ei anna, ühikuveeru kaal loetakse');
