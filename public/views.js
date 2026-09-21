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
  /* ================= RIIGIHANKED (ülesanne 9) =================
     Puhas loogika — tähtajani jäänud päevad, seisufilter, kiireloomuliste
     loendur ja rea vormindus — elab public/hanked-loogika.js-is ja on
     test/gate-hanked-ui.mjs-is päris väidetega kaetud. Siin on ainult DOM.

     RHR on VÄLINE allikas: pealkiri, hankija nimi ja märkus tulevad sealt
     toorelt. Kogu tekst läheb lehele el()-i kaudu, mis kirjutab textContent-i.
     HTML-i otsekirjutamist selles projektis ei ole ja test/gate-hanked-ui.mjs
     hoiab, et teda ei tekiks. */
  const L = window.HankedLoogika;

  // Ainult need kaks seisu vajavad eestikeelset silti; ülejäänud kuus on juba
  // loetavad. Tundmatu seis näidatakse TOORELT, mitte ei kao ära — server võib
  // seisu juurde lisada ja vaade ei tohi seda vaikselt maha vaikida.
  const SEISU_SILT = { voidetud: 'võidetud', jatsin: 'jätsin' };
  const silt = (s) => SEISU_SILT[s] || s;

  const VEERUD = ['Tähtaeg', 'Viitenr', 'Hankija', 'Nimetus', 'Maksumus', 'Menetlus', 'Skoor', 'Seis', 'Dok'];

  let hankedData = {
    hanked: [], tasks: {}, runs: [], states: [], lopuseisud: [],
    filter: { seis: 'aktiivsed' }, valitud: null,
  };

  // Päring ja joonistamine on LAHUS. Seisumuutus ja ülesande 10 pollimine
  // joonistavad ilma uue täislaadimiseta; ainult sakk ja „Proovi uuesti"
  // toovad andmed uuesti.
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
  }

  // Vigane vastus ei tohi jätta valget lehte. Võrgukatkestusel viskab fetch
  // INGLISKEELSE TypeError-i ('Failed to fetch') — serveri enda vead on juba
  // eestikeelsed (lib/routes2.mjs vastaVeaga). Nupp jätab vaate kasutatavaks.
  function hankedViga(e) {
    const sonum = e instanceof TypeError ? 'server ei vasta' : e.message;
    return el('div', { class: 'head' }, [
      el('h1', { text: 'Riigihanked' }),
      el('p', { class: 'warn', text: 'Hangete nimekirja ei saanud: ' + sonum }),
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

  // ÜLESANNE 10 paneb #hankedRunbar sisse käivitusnupud (POST /api/hanked/run),
  // progressi ja „Peata". Praegu on riba informatiivne: millal andmed viimati
  // tulid ja kas sünkimist on üldse kordagi jooksutatud.
  function andmeRiba() {
    const kaib = hankedData.runs.find((r) => r.state === 'käib');
    const viimane = hankedData.runs.find((r) => r.cmd === 'sync' && r.state !== 'käib');
    const rida = kaib
      ? (kaib.cmd + ' käib praegu' + (kaib.progress ? ' · ' + kaib.progress : ''))
      : viimane
        ? 'Viimane sünk ' + dt(viimane.finished) + ' · ' + (viimane.rows ?? 0) + ' rida · '
          + (viimane.state === 'tehtud' ? 'korras' : (viimane.error || viimane.state))
        // Kaks eri "jooksusid ei ole": tuhi baas tahendab, et sunkimist ei ole
        // kordagi tehtud; hangetega baas ilma jooksudeta tahendab, et sunk kais
        // KASUREALT (voi enne seda serverit) ja logis teda ei ole.
        : hankedData.hanked.length
          ? 'Selle serveri kaudu ei ole sünki jooksutatud — read on tulnud käsurealt või varasemast jooksust.'
          : 'Sünkimist ei ole veel kordagi jooksutatud.';
    return block('Andmed', el('div', { class: 'runbar', id: 'hankedRunbar' },
      el('span', { class: 'run-row', text: rida })),
    'Käsud jooksevad CRM-i serveri all. Käivitusnupud lisab järgmine samm.');
  }

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
      // Number, mitte otsusesõna: ALLTÖÖVÕTT-verdikti EI SAA punktidest tagasi
      // arvutada (vt lib/hanked.mjs score) ja vale sõna oleks halvem kui arv.
      el('td', { class: 'n skoor ' + r.skooriKlass, title: 'Lõpliku otsuse annab detailvaade', text: r.score == null ? '—' : String(r.score) }),
      el('td', {}, seisuValik(h, r)),
      el('td', { class: 'n', text: String(r.docs) }),
    );
    tr.addEventListener('click', (ev) => {
      if (!(ev.target.closest && ev.target.closest('select,button,option'))) valiHange(r.ref);
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
     Seega: paranda mudelit, siis seda rida. Kui rida enam filtrisse ei kuulu,
     kaob AINULT tema; kui tabel jääb tühjaks, tuleb asemele seletav rida. */
  async function muudaSeis(h, s) {
    const vana = h.state;
    const uus = s.value;
    if (uus === vana) return;
    s.disabled = true;
    try {
      await api('/api/hanked/state', { ref: h.ref, state: uus });
    } catch (e) {
      s.value = vana;
      return toast('Seisu ei muudetud: ' + e.message, true);
    } finally { s.disabled = false; }

    h.state = uus;
    toast(h.ref + ' → ' + silt(uus));
    uuendaMark(L.kiireloomulised(hankedData.hanked, new Date()).length);
    uuendaLoendurid();

    const rows = $('#hankedRows');
    const tr = rows && [...rows.children].find((x) => x.dataset && x.dataset.ref === h.ref);
    if (!tr) return;
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
  // täielikult, kui neid ei ole — null kastis oleks vale signaal.
  function uuendaMark(n) {
    const b = document.querySelector('#hankedBadge');
    if (!b) return;
    b.textContent = String(n);
    b.hidden = n === 0;
    b.setAttribute('aria-label', n + ' kiireloomulist hanget');
  }

  function valiHange(ref) {
    hankedData.valitud = ref;
    for (const tr of document.querySelectorAll('#hankedRows tr[data-ref]')) {
      if (tr.dataset.ref === ref) tr.setAttribute('aria-current', 'true');
      else tr.removeAttribute('aria-current');
    }
    joonistaDetail();
  }

  // ÜLESANNE 10 ehitab siia päris detailpaneeli (POST /api/hanked/detail:
  // skoori põhjendusread, CPV, link RHR-i, märkuse väli, seisunupud, failid).
  // Praegu näitab konteiner valitud viidet, et valik oleks nähtav ja
  // klaviatuuriga kontrollitav — tühi konteiner peidetakse CSS-is.
  function joonistaDetail() {
    const host = $('#hankedDetail');
    if (!host) return;
    if (!hankedData.valitud) return host.replaceChildren();
    host.replaceChildren(
      el('h2', { text: 'Valitud hange' }),
      el('p', { class: 'why', text: hankedData.valitud + ' — detailvaade tuleb järgmise sammuga.' }),
    );
  }

  /* ================= router ================= */
  const R = { stats: renderStats, services: renderServices, billing: renderBilling, agents: renderAgents, hanked: renderHanked };
  window.CRMViews = {
    render(v) { if (R[v]) { try { R[v](); } catch (e) { toast('Vaade ' + v + ': ' + e.message, true); } } },
  };
})();
