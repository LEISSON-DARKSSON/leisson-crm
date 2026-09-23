// Mustandi värav: puhas funktsioon, võrguta. Kukutab kirja ENNE, kui see jõuab Drafts-kausta.
// Reeglid tulevad Rita saatmiseelsest auditist (23.09.2026): eesti kirjavahemärgid,
// ei kohatäiteid, ainult https-lingid, mõistlik pikkus.

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i;

export function words(s) {
  return String(s || '').trim().split(/\s+/).filter(Boolean).length;
}

export function links(s) {
  return [...String(s || '').matchAll(/\b(?:https?:\/\/|www\.)[^\s<>)]+/gi)].map((m) => m[0].replace(/[.,;:!?]+$/, ''));
}

export function checkDraft(d, { minWords = 40, maxWords = 260 } = {}) {
  const errors = [];
  const toRaw = String(d?.to || '').trim();
  const to = (/<([^<>]+)>$/.exec(toRaw)?.[1] || toRaw).trim(); // "Nimi <aadress>" lubatud
  const subject = String(d?.subject || '').trim();
  const body = String(d?.body || '');
  if (!d?.id || !/^[a-z0-9-]{3,64}$/.test(d.id)) errors.push('id: 3–64 tm [a-z0-9-]');
  if (!EMAIL.test(to)) errors.push(`to: vigane aadress "${to}"`);
  if (subject.length < 5 || subject.length > 90) errors.push(`subject: pikkus ${subject.length} (5–90)`);
  const n = words(body);
  if (n < minWords || n > maxWords) errors.push(`body: ${n} sõna (${minWords}–${maxWords})`);
  const all = `${subject}\n${body}`;
  if (all.includes('—')) errors.push('em-kriips "—" – eesti tekstis mõttekriips "–"');
  if (/"/.test(all)) errors.push('sirged jutumärgid " – kasuta „…“');
  if (/gmail/i.test(all)) errors.push('mainib Gmaili – kirjad lähevad gert@leisson.eu pealt');
  if (/\[[^\]]*\]|\{\{|TODO|XXX|<[a-z]+>/i.test(all)) errors.push('kohatäide ([…], {{, TODO, XXX, <…>)');
  if (/\n\s*--\s*\n/.test(body) || /LEISSON OÜ/.test(body)) errors.push('keha sisaldab allkirja – allkiri lisatakse automaatselt');
  for (const l of links(body)) {
    if (!l.startsWith('https://')) errors.push(`link pole https: ${l}`);
    if (/claude\.ai|localhost|vercel\.app/i.test(l)) errors.push(`keelatud link: ${l}`);
  }
  return { ok: errors.length === 0, errors, words: n, links: links(body) };
}

// Võrgukontroll eraldi, et testid jääksid võrguta: iga leisson.eu link peab andma 200.
export async function checkLinksLive(body, fetchImpl = globalThis.fetch) {
  const errors = [];
  for (const l of links(body).filter((x) => /leisson\.eu/.test(x))) {
    try {
      const r = await fetchImpl(l, { method: 'GET', redirect: 'follow' });
      if (r.status !== 200) errors.push(`${l} -> ${r.status}`);
    } catch (e) { errors.push(`${l} -> ${e.message}`); }
  }
  return errors;
}
