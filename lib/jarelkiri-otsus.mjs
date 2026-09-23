// Järelkirja otsus: puhas funktsioon, võrguta, testitav.
// Reeglid leisson-jarelkiri skillist: TÖÖPÄEVAD (mitte kalendripäevad), vastanule ei
// kirjutata, kolmandat puudet ei tule, sama mustandit kaks korda ei koostata.

// Eesti riigipühad, mis võivad järelkirja aknasse jääda (2026–2027).
export const PUHAD = new Set([
  '2026-12-24', '2026-12-25', '2026-12-26', '2027-01-01', '2027-02-24',
  '2027-03-26', '2027-03-28', '2027-05-01', '2027-05-16', '2027-06-23', '2027-06-24', '2027-08-20',
]);

const iso = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'Europe/Tallinn' });

// Mitu tööpäeva on möödunud saatmise päevast (saatmispäev ise ei loe).
export function toopaevi(saadetud, tana) {
  let n = 0;
  const d = new Date(`${iso(saadetud)}T12:00:00Z`);
  const lopp = iso(tana);
  for (;;) {
    d.setUTCDate(d.getUTCDate() + 1);
    const s = d.toISOString().slice(0, 10);
    if (s > lopp) return n;
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6 && !PUHAD.has(s)) n++;
  }
}

// s: { saadetud: Date|null, vastus: bool, jubaMustandis: bool, jubaSaadetud: bool, vaja: number, tana: Date }
export function otsus(s) {
  if (!s.saadetud) return { tee: false, pohjus: 'algkiri pole veel saadetud' };
  if (s.vastus) return { tee: false, pohjus: 'vastus on käes – edasi läheb inimene' };
  if (s.jubaSaadetud) return { tee: false, pohjus: 'see järelkiri on juba saadetud' };
  if (s.jubaMustandis) return { tee: false, pohjus: 'mustand juba ootab Drafts-kaustas' };
  const n = toopaevi(s.saadetud, s.tana);
  if (n < s.vaja) return { tee: false, pohjus: `${n}/${s.vaja} tööpäeva` };
  return { tee: true, pohjus: `${n} tööpäeva, vastust pole` };
}
