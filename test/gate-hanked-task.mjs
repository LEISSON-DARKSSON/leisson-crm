// ULESANNE 11: Task Scheduleri paigaldusskripti varav.
//
// SEE VARAV EI REGISTREERI MIDAGI. Kasutaja eemaldas 13.09.2026 teadlikult Swarm24
// automaatkaivituse ja utles, et seda ei taastata - ajastatud ulesande loomine on
// TEMA otsus. Siin kontrollitakse ainult skripti SISU ja tema invariante; paris
// registreerimine kaib kasutaja enda kaivitatud kasuga, kuivjooks aga meie omaga.
//
// Miks sisukontroll ja mitte kaivitamine: `Register-ScheduledTask` on Windowsi
// kirjutus, mida ei saa varavas tagasi keerata, ja Linuxi VM-is ei ole PowerShelli
// uldse. Invariandid, mida siin valvatakse, on tapselt need, mille peale see
// skriptiklass vaikselt kukub.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEE = join(ROOT, 'win/install-hanked-task.ps1');
const toores = readFileSync(TEE);
const ps = toores.toString('utf8');

// Kommentaarideta kood: allpool kusitakse "kas skript TEEB X", mitte "kas ta
// SELGITAB X-i". Kommentaaris olev Register-ScheduledTask ei registreeri midagi.
const kood = ps.split('\n').filter((r) => !/^\s*#/.test(r)).join('\n');

const SYNC_NIMI = 'Leisson CRM hanked sync';
const AJALUGU_NIMI = 'Leisson CRM hanked ajalugu';

// A1: NIMETAMINE. Masinal on neli ulesannet ja koik kannavad mustrit
// "Leisson CRM <nimi>" ILMA mottekriipsuta (moodetud: schtasks /query 21.09.2026).
// Plaani "LEISSON — hanked sync" oleks mustrist valjas JA kannaks U+2014, mis
// laheb schtasks/PowerShelli vaikekodeeringus prugiks.
{
  assert.ok(ps.includes(SYNC_NIMI), 'sunkiulesanne peab kandma masina nimemustrit: ' + SYNC_NIMI);
  assert.ok(ps.includes(AJALUGU_NIMI), 'ajalooulesanne peab kandma masina nimemustrit: ' + AJALUGU_NIMI);
  // Kontroll kaib KOODI, mitte kommentaari peale: kommentaar TOHIB plaani nime
  // tsiteerida (ta seda teebki, pohjendusega), ulesande nimi mitte.
  assert.ok(!/LEISSON\s*[—–-]\s*hanked/i.test(kood),
    'plaani mottekriipsuga nimi on mustrist valjas ja kodeeringuloks');
  console.log('PASS hanked task: nimed jargivad masina mustrit');
}

// A2: KODEERING. install-saatja.ps1, install-konduktor.ps1 ja restart-server.ps1 on
// koik puhas ASCII ilma BOM-ita. Windowsi vaikekonsool (cp437/cp1257) teeks UTF-8
// tapitahtedest prugi ja ulesande NIMI on samas failis - prugine nimi tahendab
// ulesannet, mida -Eemalda enam ules ei leia.
{
  assert.ok(!(toores[0] === 0xef && toores[1] === 0xbb && toores[2] === 0xbf),
    'BOM-i ei tohi olla (install-saatja.ps1 mustris seda ei ole)');
  const mitteAscii = [...ps].filter((c) => c.charCodeAt(0) > 126);
  assert.deepEqual(mitteAscii, [],
    'skript peab olema puhas ASCII, leiti: ' + JSON.stringify(mitteAscii.join('')));
  console.log('PASS hanked task: puhas ASCII ilma BOM-ita');
}

// A3: KUIVJOOKS. -Kuiv trukib, mida ta teeks, ja EI KIRJUTA MIDAGI. Kontroll on
// struktuurne: registreerimist ja eemaldamist tohib olla tapselt uks koht ja
// molemad peavad olema $Kuiv-valve taga. Kaks koopiat on tapselt see viis, kuidas
// kuivjooks vaikselt pooleks jaab.
{
  assert.match(kood, /param\s*\([^)]*\[switch\]\s*\$Kuiv/s, '-Kuiv lipp peab olema param-plokis');
  assert.match(kood, /param\s*\([^)]*\[switch\]\s*\$Eemalda/s, '-Eemalda lipp peab olema param-plokis');

  // Registreerimisel on KAKS haru (-Xml kuisele, -Action/-Trigger paevasele), sest
  // Register-ScheduledTask keeldub CIM-ist ehitatud kuisest kaivitist. Seega ei saa
  // noudja "tapselt uks kutse" - noue on, et IGA kutse oleks $Kuiv-valve taga ja
  // samas funktsioonis. Kaks valveta koopiat on tapselt see viis, kuidas kuivjooks
  // vaikselt pooleks jaab.
  const kohad = (m) => { const v = []; let i = kood.indexOf(m);
    while (i !== -1) { v.push(i); i = kood.indexOf(m, i + 1); } return v; };

  const regKohad = kohad('Register-ScheduledTask').filter((i) => kood[i - 2] !== 'n'); // mitte Unregister
  assert.ok(regKohad.length >= 1, 'Register-ScheduledTask peab olema olemas');
  assert.ok(regKohad.length <= 2,
    'registreerimisharusid tohib olla kuni kaks (paevane + kuine XML), leiti ' + regKohad.length);
  const unregKohad = kohad('Unregister-ScheduledTask');
  assert.equal(unregKohad.length, 1,
    'Unregister-ScheduledTask tohib olla TAPSELT uhes kohas, leiti ' + unregKohad.length);

  for (const i of [...regKohad, ...unregKohad]) {
    const kirjutus = kood.slice(i, i + 24);
    const ees = kood.slice(Math.max(0, i - 900), i);
    assert.match(ees, /if\s*\(\s*\$Kuiv\s*\)/,
      kirjutus + ' peab olema $Kuiv-valve taga (valvet ei leitud kirjutuse eest)');
    assert.match(ees, /return/, kirjutus + ' kuivjooksu haru peab varakult valjuma');
  }

  // Kuine ulesanne EI TOHI kaia CIM-i kaudu: Register-ScheduledTask keeldub temast
  // veaga "PSTypeNames of the argument do not match ... MSFT_TaskTrigger".
  // Moodetud 21.09.2026 paris masinal - paevane registreerus, kuine kukkus.
  assert.ok(!/MSFT_TaskMonthlyTrigger/.test(kood),
    'kuine kaiviti ei tohi tulla CIM-klassist - Register-ScheduledTask keeldub temast');
  assert.match(kood, /Register-ScheduledTask -TaskName \$Nimi -Xml \$Xml/,
    'kuine ulesanne peab registreeruma XML-ist');
  assert.match(kood, /<ScheduleByMonth>/, 'XML peab kandma kuist ajakava');
  assert.match(kood, /<DaysOfMonth><Day>3<\/Day><\/DaysOfMonth>/, 'kuu 3. paev peab XML-is olema');
  assert.match(kood, /<ExecutionTimeLimit>PT4H<\/ExecutionTimeLimit>/,
    'ajaloo import kestab kumneid minuteid - 4 tunni lagi peab alles jaama');
  console.log('PASS hanked task: -Kuiv valvab molemat kirjutust');
}

// A4: -EEMALDA PUUTUB TAPSELT KAHTE ULESANNET. Masinal on korval "Leisson CRM
// saatja/loobumised/jarelkirjad/konduktor" - laiem muster (nt 'Leisson CRM*')
// kustutaks need kaasa.
{
  const m = /\$nimed\s*=\s*@\(([^)]*)\)/.exec(kood);
  assert.ok(m, '$nimed massiiv peab olema olemas');
  const nimed = [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
  assert.deepEqual(nimed, [SYNC_NIMI, AJALUGU_NIMI],
    '-Eemalda tohib puutuda tapselt neid kahte ulesannet, leiti: ' + JSON.stringify(nimed));
  assert.ok(!/-TaskName\s+'Leisson CRM\*'|Leisson CRM\*/.test(kood),
    'metamargiga muster tabaks ka saatjat ja konduktorit');
  console.log('PASS hanked task: -Eemalda puutub tapselt kahte ulesannet');
}

// A5: NODE PEAB OLEMA LEITAV. Ajastatud ulesanne jookseb TEISE keskkonnaga; kui
// (Get-Command node).Source on tuhi, annab Register-ScheduledTask segase vea
// ("Cannot bind argument to parameter 'Execute'") - ja seda naeb inimene alles
// siis, kui ta skripti juba jooksutab.
{
  assert.match(kood, /Get-Command\s+node(\.exe)?\s+-ErrorAction\s+SilentlyContinue/,
    'node tuleb otsida vaikselt ja ise kontrollida');
  const i = kood.indexOf('Get-Command node');
  const jarel = kood.slice(i, i + 500);
  assert.match(jarel, /throw|Write-Error/, 'puuduv node peab andma selge eestikeelse vea');
  assert.match(jarel, /Test-Path/, 'leitud node.exe tee olemasolu tuleb ule kontrollida');
  console.log('PASS hanked task: node valideeritakse enne registreerimist');
}

// A6: PUUDUVA SKRIPTIGA ULESANNET EI REGISTREERITA. agent/hanked-history.mjs
// valmib alles ulesandes 12. Plaani kujul registreeritaks kuuulesanne, mis kukuks
// IGA KUU vaikselt Task Scheduleri logis - keegi ei vaata sinna. Seega: enne
// registreerimist Test-Path, ja kui skripti ei ole, jaab ulesanne tegemata ja
// skript UTLEB, miks.
{
  // Molemad ulesanded kaivad LABI SAMA registreerimisfunktsiooni ja see funktsioon
  // kontrollib skripti olemasolu ENNE registreerimist - seega valve kehtib
  // automaatselt ka sunkile, mitte ainult ajaloole.
  const i = kood.indexOf('Register-ScheduledTask');
  const fn = kood.indexOf('function PaigaldaUlesanne');
  assert.ok(fn >= 0 && fn < i, 'registreerimine peab olema PaigaldaUlesanne-funktsioonis');
  const ees = kood.slice(fn, i);
  assert.match(ees, /Test-Path/, 'skripti olemasolu tuleb kontrollida enne registreerimist');
  assert.match(ees, /return\s+\$false/, 'puuduv skript peab andma varajase valjumise');
  assert.match(kood, /-Skript\s+'agent\\hanked-history\.mjs'/,
    'ajaloo ulesanne peab kaima sama valve alt labi');
  assert.match(kood, /-Skript\s+'agent\\hanked-sync\.mjs'/,
    'sunk peab kaima sama valve alt labi');
  assert.match(ps, /VAHELE|vahele/, 'vahelejatt peab olema inimesele nahtav');
  console.log('PASS hanked task: puuduva skriptiga ulesannet ei registreerita');
}

// A7: SKRIPTID, MILLELE ULESANDED OSUTAVAD, ON KETTAL (voi teadlikult puudu).
// Umbernimetamine peab siin punaseks minema, mitte alles ajastatud jooksus.
{
  assert.ok(existsSync(join(ROOT, 'agent/hanked-sync.mjs')),
    'agent/hanked-sync.mjs peab olema olemas - ulesanne osutab talle');
  const ajalugu = existsSync(join(ROOT, 'agent/hanked-history.mjs'));
  if (!ajalugu) {
    assert.match(ps, /ulesanne 12|ULESANNE 12|ulesandes 12/i,
      'kui ajaloo skripti ei ole, peab skript utlema, kust ta tuleb');
  }
  console.log('PASS hanked task: osutatud skriptid on kettal voi teadlikult puudu');
}

// A8: MAGAV MASIN JA AKU. -StartWhenAvailable teeb vahele jaanud jooksu jarele.
// -WakeToRun ON KEELATUD: see on kasutaja TOOARVUTI ja hanke tahtaeg on mediaanis
// 12 paeva (min 6) - uks kord paevas on piisav, arvuti aratamine ei ole.
{
  assert.match(kood, /-StartWhenAvailable/, 'vahele jaanud jooks tuleb jarele teha');
  assert.ok(!/-WakeToRun/.test(kood), 'tooarvutit ei arata: -WakeToRun on keelatud');
  assert.match(kood, /-ExecutionTimeLimit/, 'ripuma jaanud jooks tuleb ajalimiidiga tappa');
  assert.match(kood, /-MultipleInstances\s+IgnoreNew/, 'kaks paralleelset jooksu ei tohi tekkida');
  assert.match(kood, /-LogonType\s+Interactive/, 'paroole ulesandesse ei kirjutata');
  console.log('PASS hanked task: magamine, aku ja paralleelsus on teadlikult seatud');
}

// A9: KELLAAEG EI POROKA. Moodetud masinalt 21.09.2026:
//   konduktor    E-R 08:00-18:00 iga 30 min (ehk :00 ja :30 on hoivatud)
//   loobumised   iga paev 08:30
//   saatja       E-R 09:00-16:00 iga tund (keelatud, aga aeg jaab broneerituks)
//   jarelkirjad  E-R 10:30 (keelatud)
// 07:40 on enne konduktori akent ja ei lange uhegi olemasoleva kaivitusega kokku.
// Kuujooks 05:00 (kuupaev 3) on samuti vaba.
{
  assert.match(kood, /07:40/, 'paevane jooks kell 07:40 (enne konduktori akent)');
  assert.ok(!/0[89]:[03]0|1[0-8]:[03]0/.test(kood.replace(/08:00-18:00/g, '')),
    'ajad :00 ja :30 vahemikus 08-18 on konduktori kaes');
  // Kuine kaiviti: KAKS teed on labi proovitud ja molemad kukkusid.
  //   1. New-ScheduledTaskTrigger EI TUNNE -Monthly lippu (ainult -Once/-Daily/
  //      -Weekly/-AtLogOn/-AtStartup) - plaani koodiloige oleks kukkunud kohe;
  //   2. New-CimInstance MSFT_TaskMonthlyTrigger LOOB objekti, aga
  //      Register-ScheduledTask keeldub temast ("PSTypeNames of the argument do
  //      not match ... MSFT_TaskTrigger"). Moodetud 21.09.2026 paris masinal:
  //      paevane ulesanne registreerus, kuine kukkus tapselt selle veaga.
  // Seega kuine ulesanne tuleb XML-ist, kus ScheduleByMonth on Task Scheduleri
  // oma skeem ja midagi ei ole kavaldada.
  assert.ok(!/New-ScheduledTaskTrigger[^\n]*-Monthly/.test(kood),
    'New-ScheduledTaskTrigger -Monthly ei ole olemas');
  assert.match(kood, /05:00|AddHours\(5\)/, 'kuujooks kell 05:00');
  console.log('PASS hanked task: kellaajad ei porka olemasolevatega');
}

// A10: TOOKATALOOG JA SUHTELINE ARGUMENT. node peab jooksma crm/ juurest, muidu
// lib/env.mjs ROOT naitab mujale ja baas satub vale kohta.
{
  assert.match(kood, /-WorkingDirectory\s+\$juur/, 'tookataloog peab olema crm/ juur');
  assert.match(kood, /agent\\hanked-sync\.mjs/, 'argument on suhteline tee crm/ juurest');
  assert.match(kood, /Split-Path\s+-Parent\s+\$PSScriptRoot/, 'juur tuletatakse skripti asukohast');
  console.log('PASS hanked task: tookataloog ja argument on paigas');
}

// A11: VARAV ON AHELAS. tools/varav.mjs avastab test/gate-*.mjs mustriga - kui see
// fail sinna ei satuks, ei jookseks ta kunagi.
{
  const failid = readdirSync(join(ROOT, 'test')).filter((f) => /^gate-.+\.mjs$/.test(f));
  assert.ok(failid.includes('gate-hanked-task.mjs'), 'see varav peab olema avastatav');
  console.log('PASS hanked task: varav on offline-ahelas');
}

// -Crm ja worktree-tee keeld. Ajastatud ulesanne kannab CRM-i teed ENDA sees,
// seega see tee peab ule elama checkout'i, kust skript jooksutati. Ilma selleta
// vottis skript alati $PSScriptRoot vanema ja worktree'st jooksutades lains
// ulesandesse ajutine tee - mis parast merge'i ja worktree kustutamist KAOB.
// Ulesanne ei kukuks siis nahtavalt, vaid teataks iga paev "faili ei leitud"
// Task Scheduleri ajaloos, kuhu keegi ei vaata. Tapselt see vaikne lopp, mida
// see projekt korduvalt on maksnud.
{
  assert.match(ps, /param\(\[switch\]\$Eemalda,\s*\[switch\]\$Kuiv,\s*\[string\]\$Crm\)/,
    '-Crm lipp peab olema olemas');
  assert.match(ps, /\$juur = if \(\$Crm\)/, '-Crm peab $juure ule kirjutama');
  assert.match(ps, /package\.json[^\n]*PathType Leaf/,
    'CRM-i teed tuleb kontrollida (package.json), mitte uskuda');

  // Keeld ise: PARIS valve, mitte kommentaar.
  const valve = ps.match(/if \(-not \$Eemalda -and \$juur -match [^\n]*_worktrees[^\n]*\) \{/);
  assert.ok(valve, 'worktree-tee keeld peab olema paris tingimus, mitte kommentaar');
  const plokk = ps.slice(ps.indexOf(valve[0]), ps.indexOf(valve[0]) + 500);
  assert.match(plokk, /throw \("Ajutine worktree-tee ei kolba/, 'keeld peab VISKAMA, mitte hoiatama');
  assert.match(plokk, /-Crm/, 'veateade peab utlema, KUIDAS edasi minna');

  // -Eemalda peab keelust labi paasema: vana, vale teega ulesande peab saama maha
  // votta ka worktree'st, muidu jaab ta igaveseks kettale.
  assert.match(valve[0], /-not \$Eemalda/, '-Eemalda peab worktree-keelust labi paasema');
  console.log('PASS hanked task: -Crm lipp ja worktree-tee keeld');
}
