// Varav: composeText/composeHtml (lib/mail.mjs) peavad panema allkirja ENNE
// loobumisrida, mitte selle taha. Avastatud 20.09.2026 Gerti enda kirja
// ulevaates (Kurgo Villa) - lisaLoobumisrida() lisab kehale ESS 103-1 opt-out
// rea, mis ISE kordab "LEISSON OU * 16952932" (nouab test allpool), ja kohe
// selle taha lisas composeText/Html PARIS allkirja, mis kordab sama identiteeti
// uuesti - kiri nagi valja nagu tal oleks KAKS jarjestikust "loppu". Kumbki
// sisu ei ole vale ega kaob - ainult jarjekord oli vale. See varav on ainus
// koht, mis testib PARIS composeText/composeHtml funktsioone (kolm gate-faili
// - gate-campaign, gate-owner-sales-pause, gate-revenue-safety, gate-state-
// invariants - kasutavad koik lihtsaid vote-funktsioone, mitte pariskoodi).
import assert from 'node:assert/strict';
import test from 'node:test';
import {composeText,composeHtml} from '../lib/mail.mjs';
import {lisaLoobumisrida,LOOBUMISRIDA} from '../lib/sendgate.mjs';

const KIRI = 'Tere,\n\nolen Gert Leisson.\n\nKas leiate 30 minutit lähipäevil? Võin tulla kohale või teeme lühikese kõne.';

test('vastuses ja sisemises kirjavahetuses (ilma loobumisreata) käitub compose täpselt nagu enne',()=>{
 const text=composeText(KIRI);
 assert.ok(!/Kirjutasin teile, sest mõõtsin/.test(text),'loobumisrida ei tohi ilmuda, kui seda ei lisatud');
 assert.ok(text.startsWith(KIRI),'põhisõnum peab jääma algusesse muutumatuna');
 assert.ok(/\n--\nGert Leisson/.test(text),'allkiri peab olema olemas');
 const html=composeHtml(KIRI);
 assert.ok(!/Kirjutasin teile/.test(html));
});

test('külma kirjaga (loobumisrida lisatud) tuleb allkiri ENNE loobumisrida, mitte selle taha',()=>{
 const keha=lisaLoobumisrida(KIRI);
 const text=composeText(keha);
 const sigIdx=text.indexOf('\n--\nGert Leisson');
 const loobIdx=text.indexOf('Kirjutasin teile, sest mõõtsin');
 assert.ok(sigIdx>-1&&loobIdx>-1,'mõlemad plokid peavad olemas olema');
 assert.ok(sigIdx<loobIdx,'allkiri (üks selge lõpp) peab tulema loobumisrea (vastavuse jalus) ette, mitte taha');
 // Põhisõnum ise ei tohi kaduda ega korduda.
 assert.equal((text.match(/Kas leiate 30 minutit/g)||[]).length,1);
 // ESS 103-1 nõue jääb kehtima: loobumisrida ise nimetab ettevõtte ja reg-koodi.
 assert.ok(/LEISSON OÜ/.test(LOOBUMISRIDA)&&/16952932/.test(LOOBUMISRIDA));
 // Sama kontroll HTML-i peal - mõlemad plokid peavad ilmuma, allkiri enne.
 const html=composeHtml(keha);
 const sigHtmlIdx=html.indexOf('Gert Leisson');
 const loobHtmlIdx=html.indexOf('Kirjutasin teile');
 assert.ok(sigHtmlIdx>-1&&loobHtmlIdx>-1&&sigHtmlIdx<loobHtmlIdx);
});

test('idempotentne lisamine ei tekita compose\'is kolmandat plokki',()=>{
 const keha=lisaLoobumisrida(lisaLoobumisrida(KIRI));
 const text=composeText(keha);
 assert.equal((text.match(/Kirjutasin teile, sest mõõtsin/g)||[]).length,1);
 assert.equal((text.match(/\n--\nGert Leisson/g)||[]).length,1);
});
