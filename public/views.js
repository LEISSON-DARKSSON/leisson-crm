/* Leisson CRM — viis lisavaadet: statistika, teenused, arved, agendid, riigihanked.
   Kasutab app.js-i jagatud pinda window.CRM. Sõltuvusteta. */
(() => {
  const { api, el, toast, eur, dt, usd } = window.CRM;
  const btnDeleteDoc = (d, after) => window.CRM.btnDeleteDoc(d, after);
  const $ = (s) => document.querySelector(s);
  const pct = (n, max) => (max > 0 ? Math.max(1, Math.round((n / max) * 100)) : 0);

  function bars(rows, fmt) {
    const max = Math.max(1, ...rows.map((r) => r.v));
    return el('div', { class: 'bars' }, rows.map((r, i) => el('div', { class: 'bar' }, [
      el('span', { class: 'k', text: r.k },),
      el('span', { class: 'track' }, el('i', { class: i === 0 ? 'top' : '', style: 'width:' + pct(r.v, max) + '%' })),
      el('u', { text: fmt ? fmt(r) : String(r.v) }),
    ])));
  }
  // cls: 'laic' annab plokile kaks veergu — tabelid ei mahu ühte.
  const block = (title, kids, note, cls) => el('section', { class: 'panel' + (cls ? ' ' + cls : '') },
    [el('h2', { text: title }), ...[].concat(kids), note ? el('p', { class: 'why', text: note }) : null].filter(Boolean));
  const statRow = (items) => el('div', { class: 'bigstats' }, items.map(([v, l, hot]) =>
    el('div', {}, [el('b', { class: hot ? 'signal' : '', text: String(v) }), el('span', { text: l })])));

  /* ================= STATISTIKA ================= */
  async function renderStats() {
    const host = $('#statsBody');
    let d;
    try { d = await api('/api/stats'); } catch (e) { return host.replaceChildren(el('p', { class: 'warn', text: e.message })); }
    const S = window.CRM.state() || {};
    const torulabel = S.statusLabels || {};

    const pipe = d.pipeline.map((r) => ({ k: torulabel[r.status] || r.status, v: r.eur || 0, n: r.n }));
    const offers = d.offers.map((r) => ({ k: r.k || 'määramata', v: r.eur, n: r.n }));
    const prio = d.priority.map((r) => ({ k: 'Prioriteet ' + (r.k || '—'), v: r.eur, n: r.n }));
    const cats = d.categories.map((r) => ({ k: r.k, v: r.n }));
    const runs = d.runs.map((r) => ({ k: r.k + ' · ' + (r.model || '—'), v: r.usd, n: r.n, s: r.s }));

    host.replaceChildren(
      el('div', { class: 'head' }, [
        el('h1', { text: 'Statistika' }),
        el('div', { class: 'head-meta' }, [el('span', { text: 'Kõik arvud tulevad päringust andmebaasi peale, mitte vahemälust.' })]),
      ]),
      statRow([
        [d.sent, 'seisu muutnud'], [d.letters, 'kirja valmis'],
        [d.classified, 'kirja sorteeritud'], [d.unclassified, 'sorteerimata', d.unclassified > 0],
        [d.confidence == null ? '—' : Number(d.confidence).toFixed(2), 'keskmine kindlus'],
        [d.highOpen, 'kõrge, vastamata', d.highOpen > 0],
        [usd(d.spentTotal), 'Claude’i varasem API-kulu'],
      ]),
      block('Kontaktide ajaloolised hinnangud staatuse kaupa', bars(pipe, (r) => r.n + ' · ' + eur(r.v)),
        'Summad pärinevad ettevõtetele varem määratud hinnangutest. Need ei ole kvalifitseeritud müügitoru, kinnitatud tellimused ega laekunud tulu.'),
      block('Varasemad hinnangud teenuse kaupa', bars(offers, (r) => r.n + ' · ' + eur(r.v)), 'Ajaloolised hinnangud, mitte kinnitatud tellimused ega tulu.'),
      block('Kontaktide varasemad hinnangud', bars(prio, (r) => r.n + ' · ' + eur(r.v)), 'Prioriteet ei tõenda vajadust ega maksevalmidust. Summad ei ole kvalifitseeritud müügitoru.'),
      block('Postkast kategooriate kaupa · messages.category', bars(cats, (r) => String(r.v)),
        'Kohaliku sisuga kirju: ' + d.bodies + ' / ' + d.messages + '. Sisu olemasolu ei tähenda, et kiri on klassifitseeritud.'),
      block('Ajalooline API-kulu töötüübi kaupa', bars(runs, (r) => r.n + ' tööd · kokku ' + usd(r.v) + ' · ' + r.s + ' s'),
        'Codex kasutab ChatGPT tellimust. Dollarid kirjeldavad varasemaid API-käivitusi. Mustandite piir '+d.limits.maxDrafts+', vanusepiir '+d.limits.maxAgeDays+' päeva.'),
      block('Dokumendid', el('div', { class: 'kv2' }, [
        el('span', { class: 'k', text: 'Arved' }), el('span', { class: 'v', text: d.invoices.length ? d.invoices.map((x) => x.k + ' ' + x.n + ' (' + eur(x.eur) + ')').join(' · ') : 'ühtegi ei ole' }),
        el('span', { class: 'k', text: 'Pakkumised' }), el('span', { class: 'v', text: d.offersDocs.length ? d.offersDocs.map((x) => x.k + ' ' + x.n + ' (' + eur(x.eur) + ')').join(' · ') : 'ühtegi ei ole' }),
        el('span', { class: 'k', text: 'Ülevaatuses' }), el('span', { class: 'v', text: d.review + ' · kahtlaseid ' + d.suspicious }),
      ])),
    );
  }

  /* ================= TEENUSED ================= */

  function renderServices() {
    const S=window.CRM.state() || {};
    const cards=(S.services||[]).map(service=>block(service.name.et,[
      el('p',{class:'price',text:(service.kind==='from'?'Alates ':'')+eur(service.price)}),
      el('p',{text:service.includes.et}),
      el('p',{text:service.lead.et+' · Ettemaks '+service.depositPercent+'%'+(service.revisionRounds?' · '+service.revisionRounds+' parandusring':'')}),
      el('p',{class:'why',text:service.fit.et}),
    ],service.group==='primary'?'Kõne on vabatahtlik. Töö algab kokkulepitud sisendi ja ligipääsu saamisest.':null));
    $('#servicesBody').replaceChildren(
      el('div',{class:'head'},[el('h1',{text:'Teenused ja tellimine'}),el('p',{text:'Ühine teenusekataloog · '+S.catalogVersion})]),
      ...cards,
      block('Tellimise käik',el('ol',{},['Kliendi vajadus ja otsustaja','Kirjalik töömaht, hind ja vastuvõtt','Kinnitus ning tegelik ettemakse','Teostus ja kontroll','Üleandmine ning lõppmakse'].map(text=>el('li',{text}))))
    );
  }

  /* ================= ARVED JA PAKKUMISED ================= */
  const DOC_STATES = {
    pakkumine: ['mustand', 'saadetud', 'kinnitatud', 'aegunud', 'tagasi_lukatud'],
    arve: ['mustand', 'saadetud', 'tasutud', 'ule_tahtaja', 'tuhistatud'],
  };

  async function renderBilling() {
    const host = $('#billingBody');
    const S = window.CRM.state();
    if (!S) return;
    const docs = S.docs || [];

    const rows = docs.map((d) => el('tr', {}, [
      el('td', {}, el('a', { href: '/doc?kind=' + d.kind + '&id=' + d.id, target: '_blank', rel: 'noopener', text: d.number })),
      el('td', {}, el('span', { class: 'tag', text: d.kind })),
      el('td', { text: d.company }),
      el('td', { class: 'n', text: eur(d.total) }),
      el('td', { class: 'n', text: (d.issued || '').split('-').reverse().join('.') }),
      el('td', { class: 'n', text: (d.due || '').split('-').reverse().join('.') }),
      el('td', {}, (() => {
        const s = el('select', { class: 'input sm' });
        for (const st of DOC_STATES[d.kind]) {
          const o = el('option', { value: st, text: st });
          if (st === d.state) o.selected = true;
          s.append(o);
        }
        s.addEventListener('change', async () => {
          try { if(d.kind==='arve' && s.value==='tasutud'){const amount=prompt('Pangas kinnitatud laekunud summa eurodes',String(d.total));if(amount===null)return;const reference=prompt('Makseviide või pangatehingu ID (kohustuslik)');if(!reference)return;await api('/api/payment',{invoiceId:d.id,amount:Number(amount.replace(',','.')),reference});}else await api('/api/doc/state', { kind: d.kind, id: d.id, state: s.value }); toast(d.number + ' → ' + s.value); await window.CRM.reload(); renderBilling(); }
          catch (e) { toast(e.message, true); }
        });
        return s;
      })()),
      el('td', {}, btnDeleteDoc(d, renderBilling)),
    ]));

    const kandidaadid = (S.companies || []).filter((c) => c.price);
    const pick = el('select', { class: 'input' }, kandidaadid.map((c) => el('option', { value: c.id, text: c.name + ' · ' + eur(c.price) + ' · ' + (c.offer || '') })));

    const servicePick=el('select',{class:'input'},(S.services||[]).filter(x=>x.group==='primary').map(x=>el('option',{value:x.id,text:x.name.et+' · '+eur(x.price)})));
    const kindPick=el('select',{class:'input'},[['deposit','Ettemaksuarve'],['balance','Lõpparve pärast laekumist'],['full','Kogu summa arve']].map(([value,text])=>el('option',{value,text})));
    const gen = el('div', { class: 'genrow' }, [
      el('div', { class: 'field grow' }, [el('label', { text: 'Ettevõte torust' }), pick]),
      el('div',{class:'field'},[el('label',{text:'Uue pakkumise pakett'}),servicePick]),
      el('div',{class:'field'},[el('label',{text:'Arve liik'}),kindPick]),
      el('button', {
        class: 'btn ghost', type: 'button', text: 'Koosta pakkumine',
        onclick: async (ev) => {
          ev.target.disabled = true;
          try { const r = await api('/api/offer', { companyId: pick.value,serviceId:servicePick.value }); toast(r.note || ('Pakkumine ' + r.number)); await window.CRM.reload(); renderBilling(); }
          catch (e) { toast(e.message, true); } finally { ev.target.disabled = false; }
        },
      }),
      el('button', {
        class: 'btn', type: 'button', text: 'Väljasta arve',
        onclick: async (ev) => {
          if (!confirm('Väljastan arve? Number on järjestikune ja seda ei saa tagasi võtta.')) return;
          ev.target.disabled = true;
          try { const r = await api('/api/invoice', { companyId: pick.value,kind:kindPick.value }); toast('Arve ' + r.number + ' — tasumisele ' + eur(r.payable)); await window.CRM.reload(); renderBilling(); }
          catch (e) { toast(e.message, true); } finally { ev.target.disabled = false; }
        },
      }),
    ]);

    // Vaba ostja: arve või pakkumine sellele, keda müügitorus ei ole.
    // Ühekordne töö, edasimüüja, tuttav. Müügitorru ei teki selle pärast
    // valekirjet, mis rikuks statistika ja toru väärtuse.
    const vN = el('input', { class: 'input', placeholder: 'Ostja nimi, nt Näide OÜ' });
    const vR = el('input', { class: 'input', placeholder: 'Registrikood' });
    const vA = el('input', { class: 'input', placeholder: 'Aadress' });
    const vE = el('input', { class: 'input', type: 'email', placeholder: 'arved@naide.ee' });
    const vT = el('input', { class: 'input', placeholder: 'Töö kirjeldus, nt AI-nähtavuse audit' });
    const vP = el('input', { class: 'input', type: 'number', min: '1', step: '1', placeholder: 'Summa €' });
    const vabaKorje = () => ({
      buyer: { name: vN.value, reg: vR.value, addr: vA.value, email: vE.value },
      title: vT.value, price: Number(vP.value),
    });
    const vabaTee = async (ev, tee) => {
      if (!vN.value.trim()) return toast('Ostja nimi on tühi', true);
      if (!Number(vP.value)) return toast('Summa on tühi', true);
      ev.target.disabled = true;
      try {
        const r = await api(tee, vabaKorje());
        toast((tee === '/api/invoice' ? 'Arve ' : 'Pakkumine ') + r.number);
        vN.value = vR.value = vA.value = vE.value = vT.value = vP.value = '';
        await window.CRM.reload(); renderBilling();
      } catch (e) { toast(e.message, true); } finally { ev.target.disabled = false; }
    };
    const vaba = el('div', { class: 'formgrid' }, [
      el('div', { class: 'field' }, [el('label', { text: 'Ostja nimi' }), vN]),
      el('div', { class: 'field' }, [el('label', { text: 'Registrikood' }), vR]),
      el('div', { class: 'field' }, [el('label', { text: 'Aadress' }), vA]),
      el('div', { class: 'field' }, [el('label', { text: 'E-post' }), vE]),
      el('div', { class: 'field wide2' }, [el('label', { text: 'Töö kirjeldus' }), vT]),
      el('div', { class: 'field' }, [el('label', { text: 'Summa €' }), vP]),
      el('div', { class: 'field wide2 endrow' }, el('div', { class: 'send-row' }, [
        el('button', { class: 'btn ghost', type: 'button', text: 'Koosta pakkumine', onclick: (ev) => vabaTee(ev, '/api/offer') }),
        el('button', {
          class: 'btn', type: 'button', text: 'Väljasta arve',
          onclick: (ev) => { if (confirm('Väljastan arve? Number on järjestikune ja seda ei saa tagasi võtta.')) vabaTee(ev, '/api/invoice'); },
        }),
      ])),
    ]);

    host.replaceChildren(
      el('div', { class: 'head' }, [
        el('h1', { text: 'Arved ja pakkumised' }),
        el('div', { class: 'head-meta' }, [
          el('span', { text: 'A4 · 210 × 297 mm portree' }),
          el('span', { text: S.vatRegistered ? 'käibemaksukohustuslane' : 'käibemaksurida puudub — LEISSON OÜ ei ole käibemaksukohustuslane' }),
        ]),
      ]),
      block('Generaator torust', gen, 'Hind tuleb müügitoru kirjest, mitte käsitsi. Number tuleb counters-tabelist ja on järjestikune ilma auguta. Arve avaneb uues aknas A4-lehena — sealt „Prindi / PDF".'),
      block('Generaator vabale ostjale', vaba, 'Ostja, keda müügitorus ei ole: ühekordne töö, edasimüüja, tuttav. Dokument kannab ostja andmeid ise ja müügitorru ei teki valekirjet, mis rikuks toru väärtuse ja statistika.'),
      block('Arhiiv', docs.length
        ? el('table', { class: 'tbl' }, [
          el('thead', {}, el('tr', {}, ['Number', 'Liik', 'Ostja', 'Summa', 'Kuupäev', 'Tähtaeg', 'Seis', ''].map((h) => el('th', { text: h })))),
          el('tbody', {}, rows),
        ])
        : el('p', { class: 'why', text: 'Ühtegi dokumenti ei ole veel väljastatud.' }),
        'Pakkumise võib alati kustutada. Arve saab kustutada ainult siis, kui seda ei ole kordagi välja saadetud — välja läinud arve tühistatakse, et number jääks seeriasse alles.', 'laic'),
      block('Laekumised',el('p',{text:'Laekunuks loetakse ainult summa ja makseviitega kinnitatud makse. Arve väljastamine ega ettemaksuprotsent ei tõenda tasumist.'})),

    );
  }

  /* ================= AGENDID ================= */

  async function renderAgents() {
    const host=$('#agentsBody');
    let d;try{d=await api('/api/agent');}catch(e){host.replaceChildren(el('p',{text:e.message,class:'warn'}));return;}
    const q=Object.fromEntries(d.queue.map(x=>[x.status,x.n]));
    const rows=d.runs.slice(0,20).map(r=>el('tr',{},[
      el('td',{text:r.type}),el('td',{text:(r.model||'—')+(r.effort?' / '+r.effort:'')}),
      el('td',{text:r.provider==='codex-chatgpt'?'ChatGPT tellimus':usd(r.total_cost_usd)+' (ajalugu)'}),
      el('td',{text:r.input_tokens==null?'—':String(r.input_tokens)+' / '+String(r.output_tokens??'—')}),
      el('td',{text:Math.round((r.duration_ms||0)/1000)+' s'}),
      el('td',{text:r.ok?'Valmis':(r.error_code||'Vajab ülevaatust')}),
    ]));
    host.replaceChildren(
      el('div',{class:'head'},[el('h1',{text:'Codexi agendid'}),el('p',{text:'ChatGPT tellimus · eraldi API-kulu ei lisata · saatmise kinnitad sina'})]),
      statRow([[q.ootel||0,'järjekorras'],[q.running||q.toos||0,'töös'],[q.needs_human||0,'vajab ülevaatust'],[q.paused||0,'peatatud']]),
      block('Töö seis',el('p',{text:d.runtimePause || 'Pausi pole salvestatud. Ajastus ja viimase jooksu aeg on allpool.'})),
      block('Töövoog',el('ol',{},['Reeglipõhine eelfilter','Codexi liigitus ja vastuse kavatsus','Vajadusel mustand','Eraldi keele- ja faktitoimetus','Täpse saaja ja teksti eelvaade','Sinu kinnitus ning ühekordne saatmine'].map(text=>el('li',{text})))),
      block('Käivitused',el('table',{class:'tbl'},[el('thead',{},el('tr',{},['Töö','Mudel / effort','Arvestus','Sisend / väljund tokenid','Kestus','Tulemus'].map(text=>el('th',{text})))),el('tbody',{},rows)]),null,'laic'),
      ...(d.digest?[block('Viimane kokkuvõte · '+dt(d.digestTs),el('pre',{class:'mailbody',text:d.digest}),null,'laic')]:[])
    );
  }
  /* ================= RIIGIHANKED (ülesanded 9 ja 10) =================
     Puhas loogika — tähtajani jäänud päevad, seisufilter, kiireloomuliste
     loendur, rea vormindus, otsuseveerg ja käsunupu seis — elab
     public/hanked-loogika.js-is ja on test/gate-hanked-ui.mjs-is päris
     väidetega kaetud. Siin on ainult DOM ja võrk.

     RHR on VÄLINE allikas: pealkiri, hankija nimi, skoori põhjendusread ja
     märkus tulevad sealt toorelt. Kogu tekst läheb lehele el()-i kaudu, mis
     kirjutab textContent-i (märkus läheb textarea .value-sse). HTML-i
     otsekirjutamist selles projektis ei ole ja test/gate-hanked-ui.mjs
     hoiab, et teda ei tekiks. */
  const L = window.HankedLoogika;

  // Ainult need kaks seisu vajavad eestikeelset silti; ülejäänud kuus on juba
  // loetavad. Tundmatu seis näidatakse TOORELT, mitte ei kao ära — server võib
  // seisu juurde lisada ja vaade ei tohi seda vaikselt maha vaikida.
  const SEISU_SILT = { voidetud: 'võidetud', jatsin: 'jätsin' };
  const silt = (s) => SEISU_SILT[s] || s;

  const VEERUD = ['Tähtaeg', 'Viitenr', 'Hankija', 'Nimetus', 'Maksumus', 'Menetlus', 'Otsus', 'Seis', 'Dok'];

  // RHR-i hankeleht. Viimane osa on rhr_id — SEE ON ERI VÄLI kui viitenumber
  // (ref), mida kasutaja tabelis näeb. Ilma rhr_id-ta linki EI MÕELDA VÄLJA:
  // vale link viiks võõra hanke juurde ja seda ei märkaks keegi.
  const RHR_URL = 'https://riigihanked.riik.ee/rhr-web/#/procurement/';

  let hankedData = {
    hanked: [], tasks: {}, runs: [], states: [], lopuseisud: [],
    filter: { seis: 'aktiivsed' }, valitud: null,
    // Detail on VAHEMÄLUS. Ilma selleta küsiks iga joonistus uue POST-i ja
    // pollimine teeks seda iga kahe sekundi tagant.
    detail: null,
    // Käsu enda veateade (nt 409 „käib juba") elab SELLE käsu juures, mitte
    // anonüümses toastis, mis kaob kolme sekundiga.
    kasuViga: {},
    pollViga: null,
  };

  // Päring ja joonistamine on LAHUS. Seisumuutus, pollimine ja detailpaneel
  // joonistavad ilma uue täislaadimiseta; ainult sakk, „Proovi uuesti" ja
  // LÕPPENUD JOOKS toovad andmed uuesti.
  async function renderHanked() {
    const host = $('#hankedBody');
    if (!host) return;
    if (!L) return host.replaceChildren(el('p', { class: 'warn', text: 'hanked-loogika.js ei ole laetud' }));
    let d;
    try { d = await api('/api/hanked'); } catch (e) { return host.replaceChildren(hankedViga(e)); }
    hankedData = {
      ...hankedData,
      hanked: Array.isArray(d.hanked) ? d.hanked : [],
      tasks: d.tasks || {},
      runs: Array.isArray(d.runs) ? d.runs : [],
      states: Array.isArray(d.states) ? d.states : [],
      lopuseisud: Array.isArray(d.lopuseisud) ? d.lopuseisud : [],
    };
    joonistaHanked();
    // Vaade avati ajal, mil jooks juba käib (nt käsurealt või teisest aknast
    // käivitatud sünk): siis peab riba ise elama minema, mitte jääma seisma.
    if (hankedData.runs.some((r) => r.state === 'käib')) alustaPoll();
  }

  // Vigane vastus ei tohi jätta valget lehte. Võrgukatkestusel viskab fetch
  // INGLISKEELSE TypeError-i ('Failed to fetch') — serveri enda vead on juba
  // eestikeelsed (lib/routes2.mjs vastaVeaga). Nupp jätab vaate kasutatavaks.
  const veaSonum = (e) => (e instanceof TypeError ? 'server ei vasta' : e.message);

  function hankedViga(e) {
    return el('div', { class: 'head' }, [
      el('h1', { text: 'Riigihanked' }),
      el('p', { class: 'warn', text: 'Hangete nimekirja ei saanud: ' + veaSonum(e) }),
      el('p', { class: 'why', text: 'Ülejäänud CRM töötab edasi. Kui server on kinni, käivita ta uuesti.' }),
      el('button', { class: 'btn ghost', type: 'button', text: 'Proovi uuesti', onclick: () => renderHanked() }),
    ]);
  }

  function joonistaHanked() {
    const host = $('#hankedBody');
    if (!host) return;
    const nyyd = new Date();
    const kiired = L.kiireloomulised(hankedData.hanked, nyyd);
    uuendaMark(kiired.length);
    const read = L.filtreeri(hankedData.hanked, hankedData.filter, hankedData.lopuseisud);
    host.replaceChildren(
      el('div', { class: 'head' }, [
        el('h1', { text: 'Riigihanked' }),
        el('div', { class: 'head-meta' }, [
          el('span', {
            text: kiired.length
              ? kiired.length + ' hanget tähtajaga kuni ' + L.KIIRE_PAEVI + ' päeva ootab otsust'
              : 'Kiireloomulisi hankeid ei ole',
          }),
          el('span', { text: hankedData.hanked.length + ' hanget andmebaasis' }),
        ]),
      ]),
      andmeRiba(),
      block('Nimekiri', [filtriRiba(), tabel(read, nyyd)],
        'Seis ja märkus on sinu omad — sünkimine ei kirjuta neid kunagi üle.', 'laic'),
      el('div', { class: 'panel hanked-detail', id: 'hankedDetail', 'aria-live': 'polite' }),
    );
    joonistaDetail();
  }

  /* ---------------- käsuriba: nupud, progress ja „Peata" ---------------- */

  function andmeRiba() {
    return block('Andmed',
      el('div', {
        class: 'runbar', id: 'hankedRunbar',
        // Jooksva käsu seis peab jõudma ka ekraanilugejani, mitte ainult silma.
        'aria-live': 'polite', 'aria-busy': kaibMidagi() ? 'true' : 'false',
      }, ribaSisu()),
      'Käsud jooksevad CRM-i serveri all. Öine Task Scheduleri jooks kirjutab samasse tabelisse.');
  }

  const kaibMidagi = () => hankedData.runs.some((r) => r.state === 'käib');

  // Pollimine uuendab AINULT seda riba. Täisjoonistus iga kahe sekundi tagant
  // kustutaks detailpaneeli koos poolikult kirjutatud märkusega ja viskaks
  // fookuse ära — jooksu ajal juhtuks see kümneid kordi.
  function uuendaRiba() {
    const host = $('#hankedRunbar');
    if (!host) return;
    host.replaceChildren(...ribaSisu());
    host.setAttribute('aria-busy', kaibMidagi() ? 'true' : 'false');
  }

  function ribaSisu() {
    const kasud = Object.entries(hankedData.tasks).map(([cmd, t]) => kasuPlokk(cmd, t));
    if (!kasud.length) kasud.push(el('span', { class: 'run-row', text: 'Server ei andnud ühtegi käsku.' }));
    if (hankedData.pollViga) kasud.push(el('span', { class: 'run-row warn', text: hankedData.pollViga }));
    if (!kaibMidagi() && !hankedData.runs.length && hankedData.hanked.length) {
      // Kaks eri „jooksusid ei ole": tühi baas tähendab, et sünkimist ei ole
      // kordagi tehtud; hangetega baas ilma jooksudeta tähendab, et sünk käis
      // KÄSUREALT (või enne seda serverit) ja logis teda ei ole.
      kasud.push(el('span', { class: 'run-row',
        text: 'Selle serveri kaudu ei ole sünki jooksutatud — read on tulnud käsurealt või varasemast jooksust.' }));
    }
    return kasud;
  }

  function kasuPlokk(cmd, t) {
    const n = L.nupuSeis(cmd, t, hankedData.runs);
    const viga = hankedData.kasuViga[cmd];
    return el('div', { class: 'cmd' + (n.kaib ? ' busy' : ''), 'data-cmd': cmd }, [
      el('button', {
        class: 'btn' + (n.keelatud ? ' ghost' : ''), type: 'button', text: n.tekst,
        // Keelatud nupp on KEELATUD JA SELETATUD: agent/hanked-history.mjs ja
        // agent/hanked-docs.mjs ei ole veel olemas ja klikk annaks 400.
        disabled: n.keelatud ? 'disabled' : null,
        'aria-disabled': n.keelatud ? 'true' : null,
        title: n.pohjus,
        onclick: () => kaivita(cmd),
      }),
      // „Peata" AINULT oma jooksul: võõra serveri-instantsi pid võib vahepeal
      // ringlusse minna ja server keeldub teda tapmast (lib/hanked-runs.mjs).
      n.peata ? el('button', {
        class: 'btn ghost sm', type: 'button', text: 'Peata',
        'aria-label': 'Peata ' + n.label, onclick: () => peata(n.kaib.id),
      }) : null,
      n.kaib ? el('span', { class: 'run-row', text: n.seis }) : null,
      n.kaib && !n.peata
        ? el('span', { class: 'run-row', text: 'Jooks kuulub eelmisele serverile — peatada ei saa' })
        : null,
      viga ? el('span', { class: 'run-row warn', text: viga }) : null,
      !n.kaib && n.lopp
        ? el('span', { class: 'run-row' + (n.lopp.viga ? ' warn' : ''),
          text: dt(n.lopp.finished) + ' · ' + n.lopp.rows + ' rida · ' + n.lopp.tulemus })
        : null,
    ].filter(Boolean));
  }

  async function kaivita(cmd) {
    delete hankedData.kasuViga[cmd];
    let r;
    try {
      r = await api('/api/hanked/run', { cmd });
    } catch (e) {
      // 409 EI OLE anonüümne toast. Server ütleb { error, runId } — „käib juba"
      // kuulub selle käsu juurde ja runId ütleb, KUMB jooks käib. Sama jooksu
      // seisu tasub edasi jälgida, seega ahel läheb ikka käima.
      const runId = e.keha && e.keha.runId;
      hankedData.kasuViga[cmd] = veaSonum(e) + (runId == null ? '' : ' (jooks #' + runId + ')');
      if (e.status === 409) { uuendaRiba(); return alustaPoll(); }
      toast(veaSonum(e), true);
      return uuendaRiba();
    }
    // Nupp läheb kohe „…" peale, mitte alles kahe sekundi pärast. Rida on
    // OSALINE (server annab id, cmd ja seisu) — järgmine pollimine toob täiskuju.
    hankedData.runs = [{ id: r.id, cmd, state: 'käib', progress: null, logTail: null, oma: true },
      ...hankedData.runs];
    uuendaRiba();
    alustaPoll();
  }

  async function peata(id) {
    try {
      const r = await api('/api/hanked/stop', { id });
      // stopRun vastab struktuurselt: „see jooks ei käi enam" ei ole erind.
      if (!r.ok) toast(r.error || 'Jooksu ei peatatud', true);
      else if (r.error) toast(r.error);
    } catch (e) { return toast(veaSonum(e), true); }
    await uuendaJooksud();
  }

  async function uuendaJooksud() {
    try {
      const { runs } = await api('/api/hanked/runs');
      hankedData.runs = Array.isArray(runs) ? runs : [];
      hankedData.pollViga = null;
    } catch (e) {
      hankedData.pollViga = 'Jooksude seisu ei saanud: ' + veaSonum(e);
    }
    uuendaRiba();
  }

  /* ---------------- pollimine: ÜKS ahel, mis lõpeb ----------------
     Kolm viga, mida see osa väldib:
       1. mitu ahelat korraga. clearTimeout üksi ei aita, kui kaks poll()-i on
          juba lennus — seega on lipp (pollKaib) ja PÕLVKOND (pollPolv): peatatud
          ahela lennus olev päring ei ärata teda enam ellu;
       2. vaikne surm. Veakäsitluseta ahel sureb esimese katkestuse peale ja nupp
          jääb igaveseks „…" peale. Viga on nähtav ja pärast kolme katset
          LOOBUTAKSE — siis on server kinni, mitte hetke ummikus;
       3. taustal koputamine. Vaatelt lahkumine peatab ahela (vt CRMViews.render). */
  const POLL_MS = 2000;
  const POLL_KATSEID = 3;
  let pollKaib = false;
  let pollPolv = 0;
  let pollTimer = null;
  let pollVigu = 0;

  function alustaPoll() {
    if (pollKaib) return;
    pollKaib = true;
    pollVigu = 0;
    hankedData.pollViga = null;
    const polv = ++pollPolv;
    pollTimer = setTimeout(() => poll(polv), POLL_MS);
  }

  function peataPoll() {
    pollKaib = false;
    pollPolv++;
    clearTimeout(pollTimer);
    pollTimer = null;
  }

  async function poll(polv) {
    if (polv !== pollPolv) return;
    let runs;
    try {
      ({ runs } = await api('/api/hanked/runs'));
    } catch (e) {
      if (polv !== pollPolv) return;
      pollVigu++;
      const loobus = pollVigu >= POLL_KATSEID;
      hankedData.pollViga = 'Jooksude seisu ei saanud: ' + veaSonum(e)
        + (loobus ? ' — lõpetasin jälgimise, ava vaade uuesti' : ' (katse ' + pollVigu + '/' + POLL_KATSEID + ')');
      if (loobus) peataPoll();
      else pollTimer = setTimeout(() => poll(polv), POLL_MS);
      return uuendaRiba();
    }
    if (polv !== pollPolv) return;
    pollVigu = 0;
    hankedData.pollViga = null;
    const enne = hankedData.runs;
    hankedData.runs = Array.isArray(runs) ? runs : [];
    // Käsu enda veateade („Sünkroon käib juba (jooks #3)") kuulub SELLE jooksu
    // juurde. Kui jooks on läbi, ei ole teade enam tõsi ja ta ei tohi ribale
    // seisma jääda — mõõdetud päris serveri peal.
    for (const cmd of Object.keys(hankedData.kasuViga)) {
      if (!hankedData.runs.some((r) => r.cmd === cmd && r.state === 'käib')) delete hankedData.kasuViga[cmd];
    }
    // LÕPPENUD JOOKS TOOB UUED READ. Ainult `runs` uuendamine jätaks tabeli
    // vanaks — sünk lisas just kuus hanget ja kasutaja ei näeks neid. Seega
    // TÄPSELT ÜKS täislaadimine, lõppemise peale, mitte iga pollimise peale.
    const lopetas = hankedData.runs.some((r) => r.state !== 'käib'
      && enne.some((v) => v.id === r.id && v.state === 'käib'));
    if (kaibMidagi()) pollTimer = setTimeout(() => poll(polv), POLL_MS);
    else { pollKaib = false; pollTimer = null; }
    if (lopetas) await renderHanked();
    else uuendaRiba();
  }

  /* ---------------- nimekiri ---------------- */

  // Filtririba EI hoia oma seisunimekirja: „aktiivsed" tuleb serveri
  // lopuseisud-väljast ja iga seisu kiip serveri states-väljast.
  function filtriRiba() {
    const loend = (seis) => L.filtreeri(hankedData.hanked, { seis }, hankedData.lopuseisud).length;
    const kiip = (seis, tekst) => el('button', {
      class: 'chip', type: 'button', 'data-seis': seis,
      'aria-pressed': hankedData.filter.seis === seis ? 'true' : 'false',
      onclick: () => { hankedData.filter.seis = seis; joonistaHanked(); },
    }, [el('span', { text: tekst }), el('i', { text: String(loend(seis)) })]);
    return el('div', { class: 'chips', role: 'group', 'aria-label': 'Seisufilter' }, [
      kiip('aktiivsed', 'Aktiivsed'),
      kiip('kõik', 'Kõik'),
      ...hankedData.states.map((s) => kiip(s, silt(s))),
    ]);
  }

  function tabel(read, nyyd) {
    return el('table', { class: 'tbl hanked' }, [
      el('thead', {}, el('tr', {}, VEERUD.map((text) => el('th', { scope: 'col', text })))),
      el('tbody', { id: 'hankedRows' }, read.length ? read.map((h) => reaElement(h, nyyd)) : tyhiRida()),
    ]);
  }

  // Tühi tabel ilma seletuseta on halb: kasutaja ei tea, kas hankeid ei ole või
  // ei ole neid veel kordagi tõmmatud. Kaks eri põhjust, kaks eri lauset.
  function tyhiRida() {
    const pohjus = hankedData.hanked.length
      ? 'Selle filtriga ei ole ühtegi hanget. Vali „Kõik" või mõni teine seis.'
      : 'Ühtegi hanget ei ole andmebaasis — sünkimist ei ole veel jooksutatud.';
    return el('tr', { class: 'tyhi' }, el('td', { colspan: String(VEERUD.length), class: 'why', text: pohjus }));
  }

  function reaElement(h, nyyd) {
    const r = L.riviks(h, nyyd);
    const tr = el('tr', { 'data-ref': r.ref, class: r.kiire ? 'kiire' : '' });
    if (hankedData.valitud === r.ref) tr.setAttribute('aria-current', 'true');
    tr.append(
      el('td', { class: 'n taht ' + r.tahtaeg.klass }, [
        el('b', { text: r.tahtaeg.text }), el('span', { class: 'kp', text: r.kuupaev }),
      ]),
      // Viitenumber on NUPP, mitte ainult klikitav rida: detail peab olema
      // klaviatuuriga kättesaadav (Tab + Enter), mitte ainult hiirega.
      el('td', {}, el('button', {
        class: 'linkbtn', type: 'button', text: r.ref,
        'aria-label': 'Ava hange ' + r.ref, onclick: () => valiHange(r.ref),
      })),
      el('td', { class: 'hankija', text: r.buyer }),
      el('td', { class: 'nimetus', text: r.title }),
      el('td', { class: 'n', text: r.est == null ? '—' : eur(r.est) }),
      el('td', { text: r.menetlus }),
      // Verdikt tuleb BAASIST (lib/hanked.mjs score), mitte punktidest: ALLTÖÖVÕTT
      // on seal ülimuslik ja teda EI SAA arvust tagasi arvutada. Punktid jäävad
      // kõrvale, sest nende vahe on järjestamisel nähtav.
      el('td', { class: 'n skoor ' + r.otsus.klass,
        title: 'Otsus tuleb skoorimootorist; põhjendusread on detailvaates', text: r.otsus.tekst }),
      el('td', {}, seisuValik(h, r)),
      el('td', { class: 'n', text: String(r.docs) }),
    );
    tr.addEventListener('click', (ev) => {
      if (!(ev.target.closest && ev.target.closest('select,button,option,textarea,a'))) valiHange(r.ref);
    });
    return tr;
  }

  function seisuValik(h, r) {
    const s = el('select', { class: 'input sm', 'aria-label': 'Seis — hange ' + r.ref });
    for (const st of (hankedData.states.length ? hankedData.states : [h.state])) {
      const o = el('option', { value: st, text: silt(st) });
      if (st === h.state) o.selected = true;
      s.append(o);
    }
    s.addEventListener('change', () => muudaSeis(h, s));
    return s;
  }

  /* Seisumuutus puudutab ÜHTE rida. Täisjoonistus (renderHanked) laeks kogu
     nimekirja uuesti ja kaotaks kerimiskoha, valiku ja fookuse — seda tehakse
     siin kolmekümne rea kaupa järjest, seega on see päris kadu, mitte teooria.
     Seega: paranda mudelit, siis seda rida. */
  async function muudaSeis(h, s) {
    const vana = h.state;
    const uus = s.value;
    if (uus === vana) return;
    s.disabled = true;
    try {
      await api('/api/hanked/state', { ref: h.ref, state: uus });
    } catch (e) {
      s.value = vana;
      return toast('Seisu ei muudetud: ' + veaSonum(e), true);
    } finally { s.disabled = false; }
    seisMuutus(h, uus);
  }

  // Detailpaneeli seisunupud käivad SAMA teed: baas, siis kohalik mudel, siis
  // ainult see üks rida. Kaks eri teed sama muutuse jaoks triiviksid lahku.
  async function seisNupust(ref, uus) {
    const h = hankedData.hanked.find((x) => x.ref === ref);
    if (!h || h.state === uus) return;
    try {
      await api('/api/hanked/state', { ref, state: uus });
    } catch (e) { return toast('Seisu ei muudetud: ' + veaSonum(e), true); }
    seisMuutus(h, uus);
    if (hankedData.detail && hankedData.detail.hange) hankedData.detail.hange.state = uus;
    joonistaDetail();
  }

  /* Kui rida enam filtrisse ei kuulu, kaob AINULT tema; kui tabel jääb tühjaks,
     tuleb asemele seletav rida. */
  function seisMuutus(h, uus) {
    h.state = uus;
    toast(h.ref + ' → ' + silt(uus));
    uuendaMark(L.kiireloomulised(hankedData.hanked, new Date()).length);
    uuendaLoendurid();

    const rows = $('#hankedRows');
    const tr = rows && [...rows.children].find((x) => x.dataset && x.dataset.ref === h.ref);
    if (!tr) return;
    const s = tr.querySelector('select');
    if (s && s.value !== uus) s.value = uus;
    if (!L.filtreeri([h], hankedData.filter, hankedData.lopuseisud).length) {
      tr.remove();
      if (!rows.children.length) rows.append(tyhiRida());
    } else {
      tr.className = L.riviks(h, new Date()).kiire ? 'kiire' : '';
    }
  }

  function uuendaLoendurid() {
    for (const kiip of document.querySelectorAll('#viewHanked .chip[data-seis]')) {
      const i = kiip.querySelector('i');
      if (i) i.textContent = String(L.filtreeri(hankedData.hanked, { seis: kiip.dataset.seis }, hankedData.lopuseisud).length);
    }
  }

  // Märk loeb ainult kiireloomulisi (seis 'uus', tähtajani 0…7 päeva) ja kaob
  // täielikult, kui neid ei ole. Kirjutaja on app.js-is ÜKS (window.CRM.mark) —
  // sama funktsioon paneb numbri sakile ka load()-i peale, serveri loenduri
  // (/api/state → hankedKiireid) pealt.
  function uuendaMark(n) {
    window.CRM.mark('hankedBadge', n, 'kiireloomulist hanget');
  }

  /* ---------------- detailpaneel ---------------- */

  async function valiHange(ref) {
    hankedData.valitud = ref;
    for (const tr of document.querySelectorAll('#hankedRows tr[data-ref]')) {
      if (tr.dataset.ref === ref) tr.setAttribute('aria-current', 'true');
      else tr.removeAttribute('aria-current');
    }
    if (hankedData.detail && hankedData.detail.ref === ref && hankedData.detail.hange) {
      return joonistaDetail();
    }
    hankedData.detail = { ref, laeb: true };
    joonistaDetail();
    let d;
    try {
      d = await api('/api/hanked/detail', { ref });
    } catch (e) {
      if (hankedData.valitud !== ref) return;   // kasutaja valis vahepeal teise
      hankedData.detail = { ref, viga: veaSonum(e) };
      return joonistaDetail();
    }
    if (hankedData.valitud !== ref) return;
    hankedData.detail = {
      ref, hange: d.hange || {}, why: Array.isArray(d.why) ? d.why : [],
      // ÜLESANNE 13: sarnased lepingud tulevad SAMA vastusega. Eraldi päring
      // tähendaks teist võrguringi iga valiku peale ja kaht eri hetke, mille
      // pealt mediaan ja skoori põhjendus on arvutatud.
      sarnased: d.sarnased || null,
      mustand: null,   // poolikult kirjutatud märkus, mida täisjoonistus ei tohi süüa
    };
    joonistaDetail();
  }

  function joonistaDetail() {
    const host = $('#hankedDetail');
    if (!host) return;
    const d = hankedData.detail;
    if (!hankedData.valitud || !d) return host.replaceChildren();
    if (d.viga) {
      return host.replaceChildren(
        el('h2', { text: 'Hange ' + d.ref }),
        el('p', { class: 'warn', text: 'Detaile ei saanud: ' + d.viga }),
        el('button', { class: 'btn ghost', type: 'button', text: 'Proovi uuesti',
          onclick: () => { hankedData.detail = null; valiHange(d.ref); } }),
      );
    }
    if (d.laeb || !d.hange) {
      return host.replaceChildren(el('h2', { text: 'Hange ' + d.ref }),
        el('p', { class: 'why', text: 'Laen detaile…' }));
    }
    const h = d.hange;
    const r = L.riviks(h, new Date());
    host.replaceChildren(
      el('div', { class: 'detail-head' }, [
        el('h2', { text: h.ref + ' · ' + r.title }),
        el('span', { class: 'tag ' + r.otsus.klass, text: r.otsus.tekst }),
      ]),
      el('div', { class: 'kv2' }, [
        el('span', { class: 'k', text: 'Hankija' }), el('span', { class: 'v', text: r.buyer }),
        el('span', { class: 'k', text: 'Tähtaeg' }), el('span', { class: 'v', text: r.kuupaev + ' · ' + r.tahtaeg.text }),
        el('span', { class: 'k', text: 'Maksumus' }), el('span', { class: 'v', text: r.est == null ? 'teadmata' : eur(r.est) }),
        el('span', { class: 'k', text: 'Menetlus' }), el('span', { class: 'v', text: r.menetlus }),
        el('span', { class: 'k', text: 'CPV' }), el('span', { class: 'v', text: L.tekst(h.cpv, 'puudub') }),
        el('span', { class: 'k', text: 'Segment' }), el('span', { class: 'v', text: L.tekst(h.segment, 'määramata') }),
        el('span', { class: 'k', text: 'RHR' }), el('span', { class: 'v' }, rhrLink(h)),
      ]),
      pohjendused(d.why),
      seisuNupud(h),
      markuseValja(h, d),
      sarnasedPlokk(d.sarnased),
    );
  }

  // Osa teised võitjad ÜHE reana. Eesti keel käänab ainsuse ja mitmuse eri
  // moodi ja „+ 1 konsortsiumipartnerit" on lihtsalt vale — see tekst on
  // kasutaja ees iga mitmevõitjalise osa juures.
  function kaaslased(r) {
    const n = (r.voitjaid || 0) - 1;
    if (n < 1) return '';
    const sona = r.konsortsium
      ? (n === 1 ? 'konsortsiumipartner' : 'konsortsiumipartnerit')
      : (n === 1 ? 'võitja' : 'võitjat');
    return ' + ' + n + ' ' + sona;
  }

  // ÜLESANNE 13: varasemad sarnased lepingud.
  //
  // SEE PLOKK KANNAB OTSUST, seega ta peab ütlema ka selle, MILLEL otsus
  // põhineb. Paljas mediaan on halvem kui mitte midagi: kahel lepingul põhinev
  // arv näeb ekraanil välja täpselt nagu kahekümnel põhinev, aga skoori
  // liigutab ainult teine (lib/hanked.mjs SARNASED_MIN). Seega on paneelil
  // ALATI kolm asja: mille järgi võrreldi, mitmel lepingul mediaan põhineb ja
  // mitu lepingut jäi välja.
  //
  // Võitja nimi ja pealkiri tulevad RHR-ist — kogu tekst läheb lehele el()-i
  // kaudu (textContent), nagu mujal selles failis.
  function sarnasedPlokk(s) {
    const lapsed = [el('h3', { text: 'Sarnased lepingud' })];
    if (!s) {
      // „Me ei ole neid veel kordagi küsinud" EI OLE sama, mis „lepinguid ei ole".
      lapsed.push(el('p', { class: 'why', text: 'Varasemaid lepinguid ei ole veel päritud.' }));
      return el('section', { class: 'detail-plokk', id: 'hankedSarnased' }, lapsed);
    }
    if (!s.alus) {
      lapsed.push(el('p', { class: 'why',
        text: 'Ajaloo tabelis ei ole selle CPV ega segmendi kohta ühtegi lepingut — '
          + 'lae ajalugu („Lae ajalugu" nupp) või oota järgmist kuist importi.' }));
      return el('section', { class: 'detail-plokk', id: 'hankedSarnased' }, lapsed);
    }
    // VARUTEE ON NÄHTAV, MITTE VAIKNE. RSS ei anna CPV-d üldse, seega segmendi
    // järgi võrdlemine on TAVALINE vastus — ja kasutaja peab teadma, et ta ei
    // vaata sama CPV hindu. Segmendi pool võrdleb ainult pealkirjatabamusi:
    // lepinguteate kirjelduses on registri boilerplate ja nii sattus nišši
    // „Kunda alajaama jõutrafode ost" summaga 4,4 miljonit eurot.
    lapsed.push(el('p', { class: 'why', text: s.alus === 'cpv'
      ? 'Võrdlus CPV ' + s.cpv + ' järgi.'
      : 'CPV-d ei ole — võrdlus segmendi järgi (' + s.segment + ', ainult pealkirjatabamused).' }));
    lapsed.push(el('div', { class: 'kv2' }, [
      el('span', { class: 'k', text: 'Mediaanhind' }),
      el('span', { class: 'v', text: s.medianAmount == null ? 'teadmata' : eur(s.medianAmount) }),
      el('span', { class: 'k', text: 'Pakkujaid (mediaan)' }),
      el('span', { class: 'v', text: s.medianTenders == null ? 'teadmata' : String(s.medianTenders) }),
      el('span', { class: 'k', text: 'Alus' }),
      el('span', { class: 'v', text: s.n + ' lepingut'
        + (s.valjaJai ? ' · ' + s.valjaJai + ' lepingut jäi välja (summa või võitja puudub)' : '') }),
    ]));
    if (!s.piisav) {
      lapsed.push(el('p', { class: 'warn',
        text: 'Mediaan põhineb ainult ' + s.n + ' lepingul — skoori see ei mõjuta.' }));
    }
    lapsed.push(s.read.length
      ? el('table', { class: 'tbl' }, [
        el('thead', {}, el('tr', {}, ['Kuupäev', 'Võitja', 'Summa', 'Pakkujaid']
          .map((t) => el('th', { text: t })))),
        el('tbody', {}, s.read.map((r) => el('tr', {}, [
          el('td', { class: 'n', text: L.tekst(r.date, '—') }),
          // Konsortsiumi ja mitme võitjaga osa puhul on real ÜKS nimi (summat
          // kandev juht) — ülejäänud on loendatud, mitte maha vaikitud.
          el('td', { text: L.tekst(r.winner, 'võitjata') + kaaslased(r) }),
          el('td', { class: 'n', text: r.amount == null ? '—' : eur(r.amount) }),
          el('td', { class: 'n', text: r.tenders == null ? '—' : String(r.tenders) }),
        ]))),
      ])
      : el('p', { class: 'why', text: 'Ühelgi leitud lepingul ei ole nii summat kui võitjat.' }));
    return el('section', { class: 'detail-plokk', id: 'hankedSarnased' }, lapsed);
  }

  // Link RHR-i käib rhr_id pealt (parseRss loeb ta kirje lingist). Kui teda ei
  // ole — käsitsi import, eForms-tee, vana rida — siis linki EI MÕELDA VÄLJA.
  function rhrLink(h) {
    const id = L.tekst(h.rhr_id, null);
    if (!id) return el('span', { class: 'why', text: 'RHR-i viide puudub — see rida ei ole RSS-i lingi kaudu tulnud.' });
    return el('a', {
      class: 'linkbtn', href: RHR_URL + encodeURIComponent(id) + '/general-info',
      target: '_blank', rel: 'noopener noreferrer', text: 'Ava hange RHR-is (' + id + ')',
    });
  }

  // Skoori põhjendusread tulevad score_why-st ehk skoorimootorist, aga nad
  // kannavad RHR-i teksti (segment, maksumus, menetlus) — seega läheb iga rida
  // lehele el()-i kaudu tekstina.
  function pohjendused(why) {
    return el('section', { class: 'detail-plokk' }, [
      el('h3', { text: 'Skoori põhjendus' }),
      why.length
        ? el('ul', { class: 'why-list' }, why.map((x) => el('li', { text: x })))
        : el('p', { class: 'why', text: 'Seda rida ei ole veel skooritud — sünk arvutab põhjenduse järgmisel jooksul.' }),
    ]);
  }

  function seisuNupud(h) {
    const nupud = (hankedData.states.length ? hankedData.states : [h.state]).map((st) => el('button', {
      class: 'chip', type: 'button', 'data-seis-nupp': st,
      'aria-pressed': h.state === st ? 'true' : 'false',
      text: silt(st),
      onclick: () => seisNupust(h.ref, st),
    }));
    return el('section', { class: 'detail-plokk' }, [
      el('h3', { text: 'Seis' }),
      el('div', { class: 'chips', role: 'group', 'aria-label': 'Hanke seis' }, nupud),
    ]);
  }

  function markuseValja(h, d) {
    const ta = el('textarea', {
      class: 'input', rows: '3', 'aria-label': 'Märkus hanke ' + h.ref + ' kohta',
      placeholder: 'Märkus jääb sinu omaks — sünkimine ei kirjuta seda kunagi üle',
    });
    // .value, mitte textContent: võõras tekst ei tohi muutuda ega HTML-iks minna.
    ta.value = d.mustand != null ? d.mustand : (h.note || '');
    // Poolik märkus elab mudelis üle täisjoonistuse (lõppenud jooks joonistab
    // vaate uuesti ja võtaks muidu pooliku lause kaasa).
    ta.addEventListener('input', () => { d.mustand = ta.value; });
    ta.addEventListener('blur', async () => {
      const uus = ta.value;
      if (uus === (h.note || '')) { d.mustand = null; return; }
      try {
        await api('/api/hanked/note', { ref: h.ref, note: uus });
      } catch (e) { return toast('Märkust ei salvestatud: ' + veaSonum(e), true); }
      h.note = uus.trim() ? uus : null;
      d.mustand = null;
      const rida = hankedData.hanked.find((x) => x.ref === h.ref);
      if (rida) rida.note = h.note;
      toast(h.ref + ' · märkus salvestatud');
    });
    return el('section', { class: 'detail-plokk' }, [
      el('h3', { text: 'Märkus' }),
      ta,
      el('p', { class: 'why', text: 'Salvestub siis, kui väljalt lahkud.' }),
    ]);
  }

  /* ================= router ================= */
  const R = { stats: renderStats, services: renderServices, billing: renderBilling, agents: renderAgents, hanked: renderHanked };
  window.CRMViews = {
    render(v) {
      // Pollimine peab lõppema, kui kasutaja lahkub vaatelt: muidu koputab leht
      // serverit iga kahe sekundi tagant taustal, kuigi riba ei ole näha.
      // renderHanked paneb ahela vajadusel ise uuesti käima.
      if (v !== 'hanked') peataPoll();
      if (R[v]) { try { R[v](); } catch (e) { toast('Vaade ' + v + ': ' + e.message, true); } }
    },
  };
})();
