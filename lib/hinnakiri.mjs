// Compatibility adapter. Public catalog is the sole source of current offer data.
import { CATALOG, CATALOG_VERSION, SELLER, SERVICES, serviceById, serviceSnapshot } from '@leisson/shared/service-catalog';
export { CATALOG_VERSION, serviceSnapshot };
export const TUNNIHIND = CATALOG.hourlyRate;
export const KAIBEMAKS = {
  kohustuslane: SELLER.vatRegistered,
  number: SELLER.vatNumber,
  kontrollitud: SELLER.verifiedAt,
  allikas: SELLER.source,
  lause: SELLER.vatRegistered
    ? 'Hinnad sisaldavad kohaldatavat käibemaksu.'
    : 'LEISSON OÜ ei ole käibemaksukohustuslane. Hinnale käibemaksu ei lisandu.',
};
const asCrm = s => ({
  id: s.id, aliases: s.aliases, nimi: s.name.et, hind: s.price, tunnid: s.hours,
  tarne: s.lead.et, kohtumine: false, redel: false,
  aste: s.group === 'primary' ? 1 : s.group === 'product' ? 1 : 3,
  mark: s.includes.et, sisu: [s.includes.et], ei_sisalda: s.excludes?.et ?? [],
  aktiivne: s.status === 'active', status: s.status, group: s.group,
  ettemaks_protsent: s.depositPercent, parandusringid: s.revisionRounds,
  catalog_version: CATALOG_VERSION, currency: CATALOG.currency,
});
export const TEENUSED = SERVICES.filter(s => s.status === 'active').map(asCrm);
// Alias lookup preserves old references. Retired services are visible for history only.
export const teenus = id => { const s = serviceById(id); return s ? asCrm(s) : null; };
// There is no automatic price ladder: choose an offer from a confirmed customer need.
export function jargmineAste() { return null; }
// Legacy measurement API reports observations; it does not qualify a sale or promise ranking.
export const MASINLOETAV = [
  { id: 'desc', nimi: 'otsingukirjeldus puudub', katki: m => m.desc === 0 || m.desc === '' },
  { id: 'og', nimi: 'jagamismärgendid puuduvad', katki: m => m.og === false || m.og === 0 },
  { id: 'org', nimi: 'ettevõtte struktuurandmeid ei tuvastatud', katki: m => m.org === false || m.org === 0 },
  { id: 'pealkiri', nimi: 'pealkiri puudub', katki: m => m.tLen === 0 },
  { id: 'hreflang', nimi: 'keeleviiteid ei tuvastatud', katki: m => m.multilingual === true && (m.hreflang === false || m.hreflang === 0) },
];
export function masinloetavPuudu(m) { return m?.ok === true ? MASINLOETAV.filter(s => s.katki(m)).map(s => s.nimi) : []; }
