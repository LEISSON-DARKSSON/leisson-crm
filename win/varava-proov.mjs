// Negatiivne test nadalapaeva-varavale.
//
// TAHTIS: rikkuda tuleb SEED-FAILI, mitte andmebaasi. server.mjs kutsub igal
// kaivitusel seed(db) ja see kirjutab meet_day tingimusteta seed-failist ule —
// seega baasi tehtud rike kaob enne, kui varav jouab lugeda. See oli esimene
// katse ja see andis VALE rohelise.
//
// Kasutus: node win\varava-proov.mjs riku | taasta
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../lib/env.mjs';

const P = join(ROOT, 'seed', 'parnu2.json');
const ID = 'saare-automaathostel';
const OIGE = 'T 15.09';
const VALE = 'L 19.09';   // laupaev — vale nii nadalapaeva kui tookorra poolest

const d = JSON.parse(readFileSync(P, 'utf8'));
const c = d.companies.find((x) => x.id === ID);
if (!c) { console.error('rida ei leitud:', ID); process.exit(1); }
const uus = process.argv[2] === 'riku' ? VALE : OIGE;
c.day = uus;
c.body = c.body.replace(/Olen\s+[ETKNRLP]\s+\d{2}\.\d{2}\s+teie kandis/, `Olen ${uus} teie kandis`);
writeFileSync(P, JSON.stringify(d, null, 1) + '\n');
console.log(`${ID}: day = ${uus}`);
