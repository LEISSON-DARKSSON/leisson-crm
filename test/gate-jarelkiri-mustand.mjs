// Järelkirja otsustaja (võrguta): tööpäevad, vastus peatab, ei dubleeri, ei saada.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toopaevi, otsus } from '../lib/jarelkiri-otsus.mjs';

const t = (s) => new Date(`${s}T09:00:00+03:00`);

// Tööpäevad: saatmispäev ei loe, nädalavahetus ei loe, riigipüha ei loe
assert.equal(toopaevi(t('2026-09-24'), t('2026-09-29')), 3, 'N 24.09 -> T 29.09 = 3');
assert.equal(toopaevi(t('2026-09-24'), t('2026-10-07')), 9, 'N 24.09 -> K 7.10 = 9');
assert.equal(toopaevi(t('2026-09-25'), t('2026-09-28')), 1, 'reedel saadetud ei saa esmaspäeval T+3');
assert.equal(toopaevi(t('2026-12-23'), t('2026-12-28')), 1, '24.–26.12 ei loe');
assert.equal(toopaevi(t('2026-09-24'), t('2026-09-24')), 0);

const alus = { saadetud: t('2026-09-24'), vastus: false, jubaSaadetud: false, jubaMustandis: false, vaja: 3 };
assert.equal(otsus({ ...alus, tana: t('2026-09-29') }).tee, true, 'T+3 vastuseta -> mustand');
assert.equal(otsus({ ...alus, tana: t('2026-09-28') }).tee, false, 'liiga vara');
assert.equal(otsus({ ...alus, saadetud: null, tana: t('2026-10-30') }).tee, false, 'algkiri saatmata -> mitte midagi');
assert.equal(otsus({ ...alus, vastus: true, tana: t('2026-10-30') }).tee, false, 'vastanule ei kirjutata');
assert.equal(otsus({ ...alus, jubaMustandis: true, tana: t('2026-10-30') }).tee, false, 'ei dubleeri mustandit');
assert.equal(otsus({ ...alus, jubaSaadetud: true, tana: t('2026-10-30') }).tee, false, 'ei korda saadetut');

// Staatiline: järelkirja toru ei tunne saatmist
for (const f of ['lib/jarelkiri-otsus.mjs', 'win/jarelkiri-mustand.mjs']) {
  const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /sendMail|createTransport|smtp/i, `${f} ei tohi saata`);
}
console.log('gate-jarelkiri-mustand: OK (tööpäevad 5, otsus 6, saatmiskeeld)');
