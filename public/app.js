/* Leisson CRM — klient. Sõltuvusteta. Kuus vaadet; siin on müügitoru ja postkast. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const el = (t, a = {}, kids = []) => {
    const n = document.createElement(t);
    for (const [k, v] of Object.entries(a)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const c of [].concat(kids)) if (c) n.append(c);
    return n;
  };
  const eur = (n) => new Intl.NumberFormat('et-EE', { maximumFractionDigits: 0 }).format(n) + ' €';
  const dt = (iso) => (iso ? new Date(iso).toLocaleString('et-EE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
  const usd = (n) => Number(n || 0).toFixed(2).replace('.', ',') + ' $';

  let S = null;
  let sel = null;
  let selMail = null;
  let view = 'pipeline';
  const bodies = new Map();
  const filter = { prio: new Set(), status: new Set(), list: new Set(), q: '' };
  const mailFilter = { account: null, unread: false, linked: false, q: '', cat: null };
  const picked = new Set();
  let bulkTask = 'triaaz';
  let bulkGate = null;

  /* ---------- režiim ----------
     Päises nuppu enam ei ole: CRM on öörežiimis tööriist ja lüliti võttis
     päisest rea, mida on vaja ühele reale mahtumiseks. Varem tehtud valik
     loetakse ikka localStorage-ist, et kellelgi seis ära ei kaoks. */
  const MODE_KEY = 'leisson-crm-mode';
  try { const m = localStorage.getItem(MODE_KEY); if (m) document.documentElement.dataset.mode = m; } catch {}

  /* ---------- vaated ---------- */
  const VIEWS = ['pipeline', 'inbox', 'stats', 'services', 'billing', 'agents'];
  const viewEl = (v) => $('#view' + v[0].toUpperCase() + v.slice(1));
  $$('.view-tab').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  function setView(v) {
    if (!VIEWS.includes(v)) v = 'pipeline';
    view = v;
    $$('.view-tab').forEach((b) => b.setAttribute('aria-selected', b.dataset.view === v ? 'true' : 'false'));
    for (const x of VIEWS) { const n = viewEl(x); if (n) n.hidden = x !== v; }
    try { localStorage.setItem('leisson-crm-view', v); } catch {}
    if (window.CRMViews && typeof window.CRMViews.render === 'function') window.CRMViews.render(v);
  }
  try { const v = localStorage.getItem('leisson-crm-view'); if (v) setView(v); } catch {}

  /* ---------- toast ---------- */
  let toastTimer;
  function toast(msg, bad) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (bad ? ' bad' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, bad ? 9000 : 3800);
  }

  async function api(path, body) {
    const r = await fetch(path, body ? {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-crm-csrf': S?.csrfToken || '' }, body: JSON.stringify(body),
    } : {});
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }


  async function approveAndSend(input, route) {
    const preview=await api('/api/outbound/preview',input);
    const accepted=await new Promise(resolve=>{
      const dialog=el('dialog',{class:'send-confirm'});
      const cancel=el('button',{class:'btn ghost',text:'Tagasi',onclick:()=>dialog.close('cancel')});
      const send=el('button',{class:'btn',text:'Kinnitan saaja ja teksti — saada',onclick:()=>dialog.close('send')});
      dialog.append(el('h2',{text:'Kontrolli saadetavat kirja'}),el('p',{text:'Konto: '+preview.accountId+' · Saaja: '+preview.to}),el('h3',{text:preview.subject}),el('pre',{class:'mailbody',text:preview.text}),el('div',{class:'send-row'},[cancel,send]));
      dialog.addEventListener('close',()=>{const value=dialog.returnValue==='send';dialog.remove();resolve(value);},{once:true});
      document.body.append(dialog);dialog.showModal();
    });
    if(!accepted)return false;
    await api(route,{...input,to:preview.to,subject:preview.subject,body:preview.body,accountId:preview.accountId,approvalId:preview.approvalId});
    return true;
  }

  async function load() {
    S = await api('/api/state');
    if (!mailFilter.account) mailFilter.account = 'all';
    renderStats();
    renderInquiryShortcut();
    renderChips();
    renderList();
    renderDetail();
    renderMailChips();
    renderMailList();
    renderMailDetail();
  }

  function renderInquiryShortcut() {
    let button = $('#inquiryShortcut');
    if (!button) {
      button = el('button', { id:'inquiryShortcut', class:'btn ghost sm', type:'button',
        onclick:()=>{sel=null;picked.clear();setView('pipeline');renderDetail();} });
      $('#q').before(button);
    }
    button.textContent = 'Veebi ja auditi päringud · ' + ((S.webInquiries || []).length + (S.proUXLeads || []).length);
  }

  async function showInquiryMail(sourceId) {
    try {
      const {message:m}=await api('/api/inquiry/message',{source_id:sourceId});
      const dialog=el('dialog',{class:'send-confirm','aria-label':'Päringu algne kiri'});
      dialog.append(el('h2',{text:m.subject || '(pealkirjata)'}),
        el('p',{text:m.account+' · '+m.mailbox+' · '+dt(m.ts)}),
        el('p',{text:m.body_truncated ? 'Sisu on kärbitud; täielik ülevaatus on tegemata.' : 'Kohalik kirja koopia. Postkasti loetuse olekut ei muudeta.'}),
        el('pre',{class:'mailbody',text:m.body_text || 'Kirja sisu puudub kohalikust inventuurist.'}),
        el('button',{class:'btn ghost',type:'button',text:'Sulge',onclick:()=>dialog.close()}));
      dialog.addEventListener('close',()=>dialog.remove(),{once:true});
      document.body.append(dialog);dialog.showModal();
    } catch(e) {toast(e.message,true);}
  }

  function renderInquiryPanel(host) {
    const web=S.webInquiries || [], audits=S.proUXLeads || [];
    const cards=web.map(row=>{
      const matching=S.messages.find(m=>m.source_id===row.first_mail_source_id);
      const service=(S.services || []).find(s=>s.id===row.service_id);
      return el('details',{class:'panel','data-inquiry-source':'web'},[
        el('summary',{text:(row.company || row.name)+' · '+(service?.name.et || row.scope || row.service_id)}),
        el('p',{class:'why',text:row.status==='identity_conflict' ? 'Vastuoluline päringu ID — kontrolli algseid kirju.' : 'Vajab ülevaatust. Vormisisu ei kinnita kontaktisiku identiteeti ega anna saatmisluba.'}),
        el('p',{text:row.email+' · '+dt(row.first_imported_at)}),
        el('pre',{class:'mailbody',text:row.message}),
        el('p',{class:'why',text:'Allikas: '+row.source_id+' · kataloog '+row.catalog_version}),
        row.reply_to_mismatch ? el('p',{class:'why',text:'Reply-To ja vormi aadress erinevad. Kontrolli kontakt enne vastamist.'}) : null,
        el('div',{class:'send-row'},[
          el('button',{class:'btn ghost sm',type:'button',text:'Vaata algset kirja',onclick:()=>showInquiryMail(row.first_mail_source_id)}),
          matching ? el('button',{class:'btn ghost sm',type:'button',text:'Ava postkastis',onclick:()=>{
            selMail=mailKey(matching);picked.clear();mailFilter.account='all';mailFilter.q='';mailFilter.cat=null;mailFilter.unread=false;mailFilter.linked=false;
            setView('inbox');renderMailChips();renderMailList();renderMailDetail();
          }}) : null,
        ].filter(Boolean)),
      ].filter(Boolean));
    });
    for(const row of audits) {
      let report=null;
      try {const u=new URL(row.audit_reference);if(u.protocol==='https:' && ['prouxaudit.com','www.prouxaudit.com'].includes(u.hostname) && !u.search && !u.hash)report=u.href;}catch{}
      const followup=row.intent==='result_followup';
      cards.push(el('details',{class:'panel','data-inquiry-source':'prouxaudit'},[
        el('summary',{text:'PROUXAUDIT · '+(followup ? 'Tulemuse järeltegevus' : 'Teostusabi')+' · '+(row.email || 'Kontakt puudub')}),
        el('p',{class:'why',text:followup ? 'Järelkirja järjekord kuulub PROUXAUDITile. Kontrolli seda enne uut tegevust.' : 'Kontrolli vajadust ja PROUXAUDITi värsket päringu olekut enne pakkumise ettevalmistust.'}),
        el('p',{text:'Kohalik seis: '+row.local_status+' · allika seis: '+row.upstream_status+' · '+dt(row.source_created_at)}),
        el('pre',{class:'mailbody',text:row.message || 'Kirjeldus puudub.'}),
        el('p',{class:'why',text:'Allika ID: '+row.source_id+' · saatmine nõuab täpse saaja ja teksti kinnitust.'}),
        report ? el('a',{class:'btn ghost sm',href:report,target:'_blank',rel:'noopener noreferrer',text:'Ava kaitstud audit'}) : null,
      ].filter(Boolean)));
    }
    host.replaceChildren(el('div',{class:'sheet'},[
      el('h1',{text:'Veebi ja auditi päringud'}),
      el('p',{text:'Kontrolli kontakt, kliendi vajadus ja järgmine samm. Need päringud ei ole veel kvalifitseeritud müük ega laekumine.'}),
      ...cards,
      !cards.length ? el('p',{class:'why',text:'Imporditud päringuid veel pole. Vali vasakult ettevõte või ava postkast.'}) : null,
    ].filter(Boolean)));
  }

  /* ---------- päis ---------- */
  function renderStats() {
    const c = S.counts;
    const sent = c.kiri + c.kohtumine + c.pakkumine + c.voidetud;
    const unread = S.messages.filter((m) => m.unread).length;
    // Külm toru: summa, mille eest on külmkiri välja läinud, aga päris
    // pakkumist ei ole veel koostatud. See on ainus arv, mis ütleb, kui palju
    // raha praegu ainult kirja peal seisab.
    const cold = S.companies
      .filter((x) => x.status === 'kiri')
      .reduce((s, x) => s + (Number(x.price) || 0), 0);
    const items = [
      ['Päringud', S.revenue?.awaitingReply || 0, true],
      ['Vajadus kinnitatud', S.revenue?.qualified || 0, false],
      ['Pakkumised', S.revenue?.openOffers || 0, false],
      ['Laekunud', eur(S.revenue?.received || 0), false],
      ['Teostamisel', S.revenue?.deliveries || 0, false],
      ['Lugemata', unread, unread > 0],
    ];
    $('#stats').replaceChildren(...items.map(([label, val, hot]) =>
      el('div', { class: 'nav-stat' }, [
        el('b', { class: hot ? 'signal' : '', text: String(val) }),
        el('span', { text: label }),
      ])));
    $('#syncNote').textContent = S.lastSync
      ? 'Postkast ' + dt(S.lastSync) + ' · auto ' + S.pollMinutes + ' min'
      : 'Auto iga ' + S.pollMinutes + ' min';
    const b = $('#inboxBadge');
    b.textContent = String(unread);
    b.hidden = unread === 0;
  }

  /* ---------- müügitoru filtrid ---------- */
  function renderChips() {
    const lists = [['parnu', 'Pärnu I'], ['parnu2', 'Pärnu II'], ['plaan', 'Müügiplaan']];
    $('#listChips').replaceChildren(...lists.map(([k, label]) => {
      const n = S.companies.filter((c) => c.listid === k).length;
      if (!n) return null;
      return el('button', {
        class: 'chip', type: 'button', 'aria-pressed': filter.list.has(k) ? 'true' : 'false',
        onclick: () => { filter.list.has(k) ? filter.list.delete(k) : filter.list.add(k); renderChips(); renderList(); },
      }, [el('span', { text: label }), el('i', { text: String(n) })]);
    }).filter(Boolean));

    const prios = [['A', 'A'], ['B', 'B'], ['C', 'C'], ['P', 'Plaan'], ['R', 'Reserv']];
    $('#prioChips').replaceChildren(...prios.map(([k, label]) => {
      const n = S.companies.filter((c) => c.priority === k).length;
      if (!n) return null;
      return el('button', {
        class: 'chip', type: 'button', 'aria-pressed': filter.prio.has(k) ? 'true' : 'false',
        onclick: () => { filter.prio.has(k) ? filter.prio.delete(k) : filter.prio.add(k); renderChips(); renderList(); },
      }, [el('span', { text: label }), el('i', { text: String(n) })]);
    }).filter(Boolean));

    $('#statusChips').replaceChildren(...S.statuses.map((s) => {
      const n = S.counts[s] || 0;
      return el('button', {
        class: 'chip', type: 'button', 'aria-pressed': filter.status.has(s) ? 'true' : 'false',
        onclick: () => { filter.status.has(s) ? filter.status.delete(s) : filter.status.add(s); renderChips(); renderList(); },
      }, [el('span', { class: 'dot ' + s }), el('span', { text: S.statusLabels[s] }), el('i', { text: String(n) })]);
    }));
  }

  $('#q').addEventListener('input', (e) => { filter.q = e.target.value.toLowerCase(); renderList(); });

  function visible() {
    return S.companies.filter((c) => {
      if (filter.list.size && !filter.list.has(c.listid)) return false;
      if (filter.prio.size && !filter.prio.has(c.priority)) return false;
      if (filter.status.size && !filter.status.has(c.status)) return false;
      if (filter.q) {
        const hay = [c.name, c.seg, c.loc, c.offer, c.email].join(' ').toLowerCase();
        if (!hay.includes(filter.q)) return false;
      }
      return true;
    });
  }

  const unreadFor = (id) => S.messages.filter((m) => m.company_id === id && m.unread).length;

  function renderList() {
    $('#list').replaceChildren(...visible().map((c) => {
      const u = unreadFor(c.id);
      return el('li', {}, el('button', {
        class: 'row', type: 'button', 'aria-current': sel === c.id ? 'true' : 'false',
        onclick: () => { sel = c.id; renderList(); renderDetail(); },
      }, [
        el('div', { class: 'row-top' }, [
          el('span', { class: 'row-name', text: c.name }),
          el('span', { class: 'row-price', text: c.price ? eur(c.price) : '—' }),
        ]),
        el('div', { class: 'row-meta' }, [
          el('span', { class: 'dot ' + c.status, title: S.statusLabels[c.status] }),
          el('span', { class: 'prio', text: c.priority }),
          el('span', { text: c.seg || '' }),
          u ? el('span', { class: 'unread', text: String(u) }) : null,
        ]),
      ]));
    }));
  }

  /* ---------- müügitoru detail ---------- */
  function accountSelect(id, current) {
    const s = el('select', { class: 'input', id });
    for (const a of (S.salesAccounts || S.accounts.filter(x => String(x.user).toLowerCase() === 'gert@leisson.eu'))) {
      const o = el('option', { value: a.id, text: a.user });
      if ((current || S.defaultAccount) === a.id) o.selected = true;
      s.append(o);
    }
    return s;
  }

  function docsFor(id) { return (S.docs || []).filter((d) => d.company === (S.companies.find((c) => c.id === id) || {}).name); }

  // Dokumendi kustutamine. Reegel on serveris (lib/salesdb.mjs), mitte siin:
  // pakkumise võib alati ära visata, välja saadetud arvet mitte kunagi.
  // Siin küsitakse ainult kinnitust ja näidatakse serveri põhjendust.
  function btnDeleteDoc(d, after) {
    return el('button', {
      class: 'btn ghost sm danger', type: 'button', text: 'Kustuta',
      title: 'Kustuta ' + d.kind + ' ' + d.number,
      onclick: async (ev) => {
        if (!confirm('Kustutan ' + d.kind + ' ' + d.number + '?\n\nSeda ei saa tagasi võtta.')) return;
        ev.target.disabled = true;
        try {
          await api('/api/doc/delete', { kind: d.kind, id: d.id, confirm: true });
          toast(d.kind + ' ' + d.number + ' kustutatud');
          await load();
          if (after) after();
        } catch (e) { toast(e.message, true); } finally { ev.target.disabled = false; }
      },
    });
  }

  function renderDetail() {
    const host = $('#detail');
    const side = $('#detailSide');
    if (!sel) {
      renderInquiryPanel(host);
      side.replaceChildren();
      return;
    }
    const c = S.companies.find((x) => x.id === sel);
    if (!c) { sel = null; return renderDetail(); }

    const acts = S.activity.filter((a) => a.company_id === c.id);
    const msgs = S.messages.filter((m) => m.company_id === c.id);

    const meta = [
      c.seg, c.loc,
      c.regcode ? 'reg ' + c.regcode : null,
      c.turnover ? 'käive ' + c.turnover + ' €' : null,
      c.meet_day ? 'kohtumine ' + c.meet_day : null,
      c.lang === 'en' ? 'kiri inglise keeles' : null,
    ].filter(Boolean).map((t) => el('span', { text: t }));
    if (c.url) meta.push(el('a', { href: c.url, target: '_blank', rel: 'noopener', text: 'leht ↗' }));

    const statusRow = el('div', { class: 'statusbar' }, S.statuses.map((s) =>
      el('button', {
        class: 'chip', type: 'button', 'aria-pressed': c.status === s ? 'true' : 'false',
        onclick: async () => {
          try { await api('/api/status', { id: c.id, status: s }); await load(); toast(S.statusLabels[s]); }
          catch (e) { toast(e.message, true); }
        },
      }, [el('span', { class: 'dot ' + s }), el('span', { text: S.statusLabels[s] })])));

    const findingPanel = el('section', { class: 'panel split' }, [
      el('h2', { text: 'Mõõdetud leid · ' + (S.measured || '') }),
      el('p', { text: c.finding || '—' }),
      c.why ? el('p', { class: 'why', text: c.why }) : null,
      c.angle ? el('div', { class: 'side' }, el('p', { class: 'angle', text: 'Nurk: ' + c.angle })) : null,
    ]);

    const myDocs = docsFor(c.id);
    const docRows = myDocs.map((d) => el('li', {}, [
      el('span', { class: 'tag', text: d.kind }),
      el('a', { href: '/doc?kind=' + d.kind + '&id=' + d.id, target: '_blank', rel: 'noopener', text: d.number }),
      el('span', { class: 'why', text: eur(d.total) + ' · ' + d.state }),
      btnDeleteDoc(d),
    ]));

    const servicePick=el('select',{class:'input',id:'offer-service'},(S.services||[]).filter(x=>x.group==='primary').map(x=>el('option',{value:x.id,text:x.name.et+' · '+eur(x.price)})));
    const evidence=el('textarea',{class:'input',rows:'3',placeholder:'Kliendi sõnastatud vajadus või põhjendatud kontakti alus'});evidence.value=c.need_evidence||'';
    const qualify=el('button',{class:'btn ghost sm',text:'Salvesta kontakti põhjendus',onclick:async()=>{try{await api('/api/qualification',{id:c.id,sales_state:'research',need_evidence:evidence.value});await load();}catch(e){toast(e.message,true);}}});
    const qualified=el('button',{class:'btn ghost sm',text:'Vajadus on kliendiga kinnitatud',onclick:async()=>{try{await api('/api/qualification',{id:c.id,sales_state:'qualified',need_evidence:evidence.value});await load();}catch(e){toast(e.message,true);}}});
    const offerPanel = el('section', { class: 'panel' }, [
      el('h2', { text: 'Pakkumine ja arve' }),
      el('p',{class:'why',text:'Müügiseis: '+(c.sales_state||'unqualified')}),evidence,el('div',{class:'send-row'},[qualify,qualified]),
      el('label',{text:'Uue pakkumise pakett'}),servicePick,
      el('div', { class: 'offer-row' }, [
        el('span', { class: 'what', text: c.offer || 'määramata' }),
        el('span', { class: 'price', text: c.price ? eur(c.price) : '—' }),
      ]),
      el('div', { class: 'send-row' }, [
        el('button', {
          class: 'btn ghost sm', type: 'button', text: 'Koosta pakkumine',
          onclick: async (ev) => {
            ev.target.disabled = true;
            try { const r = await api('/api/offer', { companyId: c.id,serviceId:servicePick.value }); toast(r.note || ('Pakkumine ' + r.number)); await load(); }
            catch (e) { toast(e.message, true); } finally { ev.target.disabled = false; }
          },
        }),
        el('button', {
          class: 'btn ghost sm', type: 'button', text: 'Koosta arve',
          onclick: async (ev) => {
            if (!confirm('Väljastan arve? Number on järjestikune ja seda ei saa tagasi võtta.')) return;
            ev.target.disabled = true;
            try { const r = await api('/api/invoice', { companyId: c.id,kind:'deposit' }); toast('Arve ' + r.number + ' — tasumisele ' + eur(r.payable)); await load(); }
            catch (e) { toast(e.message, true); } finally { ev.target.disabled = false; }
          },
        }),
      ]),
      docRows.length ? el('ul', { class: 'doclist' }, docRows) : el('p', { class: 'why', text: 'Dokumente ei ole veel.' }),
      el('div', { class: 'field' }, [
        el('label', { for: 'next-' + c.id, text: 'Järgmine samm' }),
        el('input', {
          class: 'input', id: 'next-' + c.id, value: c.next_step || '',
          placeholder: 'nt helista teisipäeval, küsi turundusjuhti',
          onchange: async (e) => {
            try { await api('/api/next-step', { id: c.id, next_step: e.target.value }); await load(); }
            catch (err) { toast(err.message, true); }
          },
        }),
      ]),
    ]);

    const accSel = accountSelect('acc-' + c.id, c.account && S.accounts.find((a) => a.user === c.account)?.id);
    const toInput = el('input', { class: 'input', type: 'email', id: 'to-' + c.id, value: c.email || '', placeholder: c.email_note || 'saaja@ettevote.ee' });
    const subjInput = el('input', { class: 'input', id: 'subj-' + c.id, value: c.subject || '', placeholder: 'Kirja pealkiri' });
    const bodyArea = el('textarea', { id: 'body-' + c.id, rows: '18', placeholder: 'Kirja sisu…' });
    bodyArea.value = c.body || '';

    const btnSend = el('button', { class: 'btn', type: 'button', text: 'Saada kiri' });
    btnSend.addEventListener('click', async () => {
      const to = toInput.value.trim(), subject = subjInput.value.trim(), body = bodyArea.value.trim();
      if (!to || !subject || !body) return toast('Saaja, pealkiri ja sisu peavad olema täidetud', true);

      btnSend.disabled = true; btnSend.textContent = 'Saadan…';
      try {
        if(!await approveAndSend({kind:'sales',id:c.id,to,subject,body,accountId:accSel.value},'/api/send'))return;
        toast('Saadetud: ' + to);
        await load();
      } catch (e) { toast('Saatmine ebaõnnestus: ' + e.message, true); }
      finally { btnSend.disabled = false; btnSend.textContent = 'Saada kiri'; }
    });

    const btnSave = el('button', {
      class: 'btn ghost', type: 'button', text: 'Salvesta mustand',
      onclick: async () => {
        try { await api('/api/letter', { id: c.id, subject: subjInput.value, body: bodyArea.value }); toast('Mustand salvestatud'); await load(); }
        catch (e) { toast(e.message, true); }
      },
    });

    // Kirja kaart on keskmise tulba peremees: ta täidab kogu kõrguse,
    // sisuaken kerib omaette ja nupud on püsiv jalus. Leht ise ei keri kunagi.
    const letterPanel = el('section', { class: 'panel letter' }, [
      el('h2', { text: 'Kiri' }),
      !c.email && c.email_note ? el('p', { class: 'warn', text: 'Tähelepanu: ' + c.email_note }) : null,
      el('div', { class: 'send-row' }, [
        el('div', { class: 'field' }, [el('label', { for: 'acc-' + c.id, text: 'Saatja' }), accSel]),
        el('div', { class: 'field grow' }, [el('label', { for: 'to-' + c.id, text: 'Saaja' }), toInput]),
      ]),
      el('div', { class: 'field' }, [el('label', { for: 'subj-' + c.id, text: 'Pealkiri' }), subjInput]),
      el('div', { class: 'field fill' }, [el('label', { for: 'body-' + c.id, text: 'Sisu (allkiri lisatakse automaatselt)' }), bodyArea]),
      el('div', { class: 'send-row panel-foot' }, [btnSend, btnSave]),
    ]);

    const noteInput = el('input', { class: 'input', id: 'note-' + c.id, placeholder: 'Lisa märkus ja vajuta Enter' });
    noteInput.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || !noteInput.value.trim()) return;
      try { await api('/api/note', { id: c.id, note: noteInput.value }); noteInput.value = ''; await load(); }
      catch (err) { toast(err.message, true); }
    });

    const logItems = [];
    for (const m of msgs) {
      logItems.push(el('li', {}, [
        el('time', { datetime: m.ts || '', text: dt(m.ts) }),
        el('span', { class: 'kind reply', text: m.unread ? 'VASTUS ●' : 'vastus' }),
        el('button', {
          class: 'linkbtn', type: 'button',
          text: (m.addr_name || m.addr || '') + ' — ' + (m.subject || '(pealkirjata)'),
          onclick: () => { selMail = m.account + ':' + m.uid; picked.clear(); setView('inbox'); renderMailList(); renderMailDetail(); },
        }),
      ]));
    }
    for (const a of acts) {
      logItems.push(el('li', {}, [
        el('time', { datetime: a.ts, text: dt(a.ts) }),
        el('span', { class: 'kind ' + a.kind, text: a.kind }),
        el('span', { text: a.note || '' }),
      ]));
    }

    const logPanel = el('section', { class: 'panel' }, [
      el('h2', { text: 'Tegevuslogi ja vastused' }),
      el('div', { class: 'field' }, [el('label', { for: 'note-' + c.id, text: 'Märkus' }), noteInput]),
      logItems.length ? el('ul', { class: 'log' }, logItems) : el('p', { class: 'why', text: 'Veel midagi ei ole juhtunud.' }),
    ]);

    host.replaceChildren(el('div', { class: 'sheet detail-main' }, [
      el('div', { class: 'head' }, [
        el('h1', { text: c.name }),
        el('div', { class: 'head-meta' }, meta),
        statusRow,
      ]),
      letterPanel,
    ]));
    side.replaceChildren(el('div', { class: 'sheet side-stack' }, [findingPanel, offerPanel, logPanel]));
  }

  /* ---------- postkast ---------- */
  $('#qm').addEventListener('input', (e) => { mailFilter.q = e.target.value.toLowerCase(); renderMailList(); });

  function renderMailChips() {
    const chips = [];
    chips.push(el('button', {
      class: 'chip', type: 'button', 'aria-pressed': mailFilter.account === 'all' ? 'true' : 'false',
      onclick: () => { mailFilter.account = 'all'; renderMailChips(); renderMailList(); },
    }, [el('span', { text: 'Kõik kontod' }), el('i', { text: String(S.messages.length) })]));
    for (const a of S.accounts) {
      const n = S.messages.filter((m) => m.account === a.id).length;
      chips.push(el('button', {
        class: 'chip', type: 'button', 'aria-pressed': mailFilter.account === a.id ? 'true' : 'false',
        onclick: () => { mailFilter.account = a.id; renderMailChips(); renderMailList(); },
      }, [el('span', { text: a.user.split('@')[0] }), el('i', { text: String(n) })]));
    }
    chips.push(el('button', {
      class: 'chip', type: 'button', 'aria-pressed': mailFilter.unread ? 'true' : 'false',
      onclick: () => { mailFilter.unread = !mailFilter.unread; renderMailChips(); renderMailList(); },
    }, [el('span', { text: 'Ainult lugemata' }), el('i', { text: String(S.messages.filter((m) => m.unread).length) })]));
    chips.push(el('button', {
      class: 'chip', type: 'button', 'aria-pressed': mailFilter.linked ? 'true' : 'false',
      onclick: () => { mailFilter.linked = !mailFilter.linked; renderMailChips(); renderMailList(); },
    }, [el('span', { text: 'Seotud sihtmärgiga' }), el('i', { text: String(S.messages.filter((m) => m.company_id).length) })]));
    $('#mailChips').replaceChildren(...chips);
    renderCatChips();
  }

  function renderCatChips() {
    const cats = {};
    for (const m of S.messages) { const k = m.category || 'sorteerimata'; cats[k] = (cats[k] || 0) + 1; }
    const order = Object.entries(cats).sort((a, b) => b[1] - a[1]);
    $('#catChips').replaceChildren(...order.map(([k, n]) => el('button', {
      class: 'chip', type: 'button', 'aria-pressed': mailFilter.cat === k ? 'true' : 'false',
      onclick: () => { mailFilter.cat = mailFilter.cat === k ? null : k; renderMailChips(); renderMailList(); },
    }, [el('span', { text: k }), el('i', { text: String(n) })])));
  }

  function visibleMail() {
    return S.messages.filter((m) => {
      if (mailFilter.account && mailFilter.account !== 'all' && m.account !== mailFilter.account) return false;
      if (mailFilter.unread && !m.unread) return false;
      if (mailFilter.linked && !m.company_id) return false;
      if (mailFilter.cat && (m.category || 'sorteerimata') !== mailFilter.cat) return false;
      if (mailFilter.q) {
        const hay = [m.addr, m.addr_name, m.subject].join(' ').toLowerCase();
        if (!hay.includes(mailFilter.q)) return false;
      }
      return true;
    });
  }

  const mailKey = (m) => m.account + ':' + m.uid;
  const msgId = (m) => m.mailbox + ':' + m.uid;
  const companyName = (id) => (S.companies.find((c) => c.id === id) || {}).name;

  function renderMailList() {
    const rows = visibleMail().map((m) => {
      const cname = companyName(m.company_id);
      const key = mailKey(m);
      const cb = el('input', {
        type: 'checkbox', class: 'cb',
        'aria-label': 'Vali kiri: ' + (m.addr_name || m.addr || ''),
        onchange: (e) => { e.target.checked ? picked.add(key) : picked.delete(key); bulkGate = null; afterPick(); },
      });
      cb.checked = picked.has(key);
      return el('li', { class: 'mailrow' + (picked.has(key) ? ' on' : '') }, [cb, el('button', {
        class: 'row mail' + (m.unread ? ' is-unread' : ''), type: 'button',
        'aria-current': selMail === key ? 'true' : 'false',
        onclick: () => { selMail = key; renderMailList(); renderMailDetail(); },
      }, [
        el('div', { class: 'row-top' }, [
          el('span', { class: 'row-name', text: m.addr_name || m.addr || '(tundmatu)' }),
          el('span', { class: 'row-price', text: dt(m.ts) }),
        ]),
        el('div', { class: 'row-subj', text: m.subject || '(pealkirjata)' }),
        el('div', { class: 'row-meta' }, [
          m.unread ? el('span', { class: 'dot kiri', title: 'Lugemata' }) : el('span', { class: 'dot' }),
          m.category ? el('span', { class: 'tag cat', text: m.category }) : null,
          m.urgency === 'korge' ? el('span', { class: 'tag hot', text: 'kõrge' }) : null,
          m.suspicious ? el('span', { class: 'tag bad', text: 'kahtlane' }) : null,
          cname ? el('span', { class: 'tag', text: cname }) : null,
          m.replied ? el('span', { text: 'vastatud' }) : null,
          (() => { const d = draftFor(m); return d ? el('span', { class: 'tag draft ' + d.status, text: d.status === 'ootab_kinnitust' ? 'OOTAB SIND' : 'mustand' }) : null; })(),
        ]),
      ])]);
    });
    $('#mailList').replaceChildren(...(rows.length ? rows : [
      el('li', {}, el('p', { class: 'why pad', text: 'Kirju ei ole. Vajuta päises „Sünkrooni“ või oota automaatkontrolli.' })),
    ]));
    syncBulkBar();
  }

  /* ---------- massivalik ---------- */
  function afterPick() { renderMailList(); renderMailDetail(); }

  function syncBulkBar() {
    const vis = visibleMail().map(mailKey);
    const n = picked.size;
    $('#selCount').textContent = n ? n + ' valitud' : 'ükski pole valitud';
    const all = $('#selAll');
    const onVis = vis.filter((k) => picked.has(k)).length;
    all.checked = vis.length > 0 && onVis === vis.length;
    all.indeterminate = onVis > 0 && onVis < vis.length;
    $('#bulkBar').classList.toggle('on', n > 0);
  }
  $('#selAll').addEventListener('change', (e) => {
    const vis = visibleMail().map(mailKey);
    if (e.target.checked) vis.forEach((k) => picked.add(k)); else vis.forEach((k) => picked.delete(k));
    bulkGate = null;
    afterPick();
  });

  const pickedIds = () => [...picked].map((k) => {
    const m = S.messages.find((x) => mailKey(x) === k);
    return m ? msgId(m) : null;
  }).filter(Boolean);

  const AGENT_TASKS = [
    ['triaaz', 'Klassifitseeri uuesti — keha põhjal', 'Kategooria, kiireloomulisus, kindlus, kokkuvõte. Kirjutab üle päisepõhise tulemuse.'],
    ['kehad', 'Lae kehad alla', 'Üks IMAP-ühendus terve paki kohta. Ilma kehata klassifikatsioon on ülekindel.'],
    ['mustand', 'Kirjuta vastusemustandid', 'Mustand + eesti keele toimetus. Saatmiseks on ikka vaja sinu klikki.'],
    ['grupeeri', 'Grupeeri lõimeks', 'Saatja domeeni järgi. Grupp on silt, mitte kaust — kiri jääb postkasti.'],
  ];
  const DIRECT = [['loetuks', 'Märgi loetuks'], ['arhiveeri', 'Arhiveeri'], ['summuta', 'Summuta saatja'], ['kustuta', 'Kustuta…']];

  async function loadGate() {
    try { bulkGate = await api('/api/bulk/preview', { task: bulkTask, ids: pickedIds() }); }
    catch (e) { bulkGate = { error: e.message, task: bulkTask }; }
    if (picked.size) renderBulkPanel($('#mailDetail'));
  }

  async function runBulk(task, confirmed) {
    try {
      const r = await api('/api/bulk/run', { task, ids: pickedIds(), confirm: confirmed === true });
      toast(r.note || 'Tehtud');
      picked.clear(); bulkGate = null;
      await load();
    } catch (e) { toast(e.message, true); }
  }

  function renderBulkPanel(host) {
    const n = picked.size;
    const g = bulkGate && !bulkGate.error && bulkGate.task === bulkTask ? bulkGate : null;
    if (!g && !(bulkGate && bulkGate.error && bulkGate.task === bulkTask)) loadGate();

    const tasks = el('div', { class: 'tasks' }, AGENT_TASKS.map(([k, label, sub]) => {
      const spec = (S.tasks || {})[k] || {};
      const r = el('input', {
        type: 'radio', name: 'bulktask', value: k,
        onchange: () => { bulkTask = k; bulkGate = null; renderBulkPanel(host); loadGate(); },
      });
      r.checked = bulkTask === k;
      return el('label', { class: 'task' + (bulkTask === k ? ' on' : '') }, [
        r,
        el('span', { class: 't' }, [el('b', { text: label }), el('span', { text: sub })]),
        el('span', { class: 'c', text: spec.agent ? 'ChatGPT tellimus · ' + spec.model : 'Mudelivaba' }),
      ]);
    }));

    const gateBox = el('div', { class: 'gatebox' });
    if (bulkGate && bulkGate.error) gateBox.append(el('p', { class: 'warn', text: bulkGate.error }));
    else if (g) {
      const why = Object.entries(g.why || {}).map(([k, v]) => k + ' ' + v).join(' · ');
      gateBox.append(
        el('div', { class: 'kv2' }, [
          el('span', { class: 'k', text: 'Läbib' }), el('span', { class: 'v', text: g.passN + ' kirja' }),
          el('span', { class: 'k', text: 'Jääb vahele' }), el('span', { class: 'v', text: g.skipN + (why ? ' — ' + why : '') }),
          el('span', { class: 'k', text: 'Mudel' }), el('span', { class: 'v', text: g.model || 'mudelivaba' }),
          el('span', { class: 'k', text: 'Töid järjekorda' }), el('span', { class: 'v', text: String(g.jobs) }),
          el('span', { class: 'k', text: 'Kasutus' }), el('span', { class: 'v', text: g.agent ? 'Olemasolev ChatGPT tellimus; tokenid selguvad pärast tööd' : 'Mudelikutset ei tehta' }),
          el('span', { class: 'k', text: 'Mustandeid veel täna' }), el('span', { class: 'v', text: String(g.limits?.remainingDrafts ?? '—') + ' / ' + String(g.limits?.maxDrafts ?? '—') }),
        ]),
        g.overBudget ? el('p', { class: 'warn', text: 'Tööpiir ei luba seda tööd.' }) : null,
      );
    } else gateBox.append(el('p', { class: 'why', text: 'Arvutan väravat…' }));

    const runBtn = el('button', {
      class: 'btn', type: 'button',
      text: g ? 'Pane järjekorda — ' + g.jobs + ' mudelitööd' : 'Pane järjekorda',
      onclick: () => runBulk(bulkTask),
    });
    if (!g || !g.passN || g.overBudget) runBtn.disabled = true;

    const directRow = el('div', { class: 'send-row' }, DIRECT.map(([k, label]) => el('button', {
      class: 'btn ghost sm' + (k === 'kustuta' ? ' danger' : ''), type: 'button', text: label,
      onclick: () => {
        if (k === 'kustuta') {
          if (!confirm(n + ' kirja kustutamine on pöördumatu tegevus.\n\nKirjad märgitakse kustutatuks ja kaovad postkastist.\nJätkan?')) return;
          return runBulk('kustuta', true);
        }
        if (k === 'summuta' && !confirm('Summutan valitud kirjade saatjad?\nNeile ei lähe enam ükski äriline kiri.')) return;
        runBulk(k);
      },
    })));

    host.replaceChildren(el('div', { class: 'sheet' }, [
      el('div', { class: 'head' }, [
        el('h1', { text: n + ' kirja valitud — massitöö' }),
        el('div', { class: 'head-meta' }, [
          el('span', { text: 'Valik ei saada midagi välja.' }),
          el('span', { text: 'Server jõustab samad viis piirajat, mis konduktoril.' }),
        ]),
        el('div', { class: 'send-row' }, [
          el('button', { class: 'btn ghost sm', type: 'button', text: 'Tühista valik', onclick: () => { picked.clear(); bulkGate = null; afterPick(); } }),
        ]),
      ]),
      el('section', { class: 'panel' }, [el('h2', { text: 'Ülesanne agendile' }), tasks]),
      el('section', { class: 'panel' }, [el('h2', { text: 'Värav enne järjekorda' }), gateBox, el('div', { class: 'send-row' }, runBtn)]),
      el('section', { class: 'panel' }, [
        el('h2', { text: 'Otsetegevused — agenti ei kaasata' }),
        directRow,
        el('p', { class: 'why', text: 'Kustutus on ainus pöördumatu tegevus ja ainus, mis küsib eraldi kinnitust. Kustutatud kiri jääb andmebaasi alles ja on taastatav.' }),
      ]),
    ]));
  }

  function renderMailDetail() {
    const host = $('#mailDetail');
    const side = $('#mailDetailSide');
    if (picked.size) { side.replaceChildren(); return renderBulkPanel(host); }
    const m = S.messages.find((x) => mailKey(x) === selMail);
    if (!m) {
      renderInquiryPanel(host);
      side.replaceChildren();
      return;
    }
    const cname = companyName(m.company_id);

    const meta = [
      el('span', { text: 'konto ' + m.account }),
      el('span', { text: m.addr || '' }),
      el('span', { text: dt(m.ts) }),
      m.replied ? el('span', { text: 'vastatud' }) : null,
    ].filter(Boolean);

    const bodyBox = el('pre', { class: 'mailbody', text: bodies.get(selMail) || '' });
    if (!bodies.has(selMail)) {
      bodyBox.textContent = 'Laen kirja sisu…';
      api('/api/message/body', { account: m.account, uid: m.uid })
        .then((r) => { bodies.set(selMail, r.text || '(tühi kiri)'); if (selMail === mailKey(m)) bodyBox.textContent = bodies.get(selMail); })
        .catch((e) => { bodyBox.textContent = 'Sisu ei õnnestunud laadida: ' + e.message; });
    }

    const cls = m.classified ? el('div', { class: 'clsbar' }, [
      el('span', { class: 'tag cat', text: m.category || '—' }),
      el('span', { class: 'tag' + (m.urgency === 'korge' ? ' hot' : ''), text: 'kiireloomulisus: ' + (m.urgency || '—') }),
      el('span', { class: 'tag', text: 'kindlus ' + Number(m.confidence ?? 0).toFixed(2) }),
      m.has_body ? el('span', { class: 'tag', text: 'keha loetud' }) : el('span', { class: 'tag bad', text: 'keha puudub' }),
      m.suspicious ? el('span', { class: 'tag bad', text: 'kahtlane' }) : null,
      m.reply_intent ? el('span',{class:'tag',text:'Vastuse kavatsus: '+m.reply_intent}) : null,
      m.review ? el('span', { class: 'tag hot', text: 'ülevaatuses' }) : null,
      m.summary ? el('p', { class: 'why', text: m.summary }) : null,
    ].filter(Boolean)) : null;

    const linkSel = el('select', { class: 'input' });
    linkSel.append(el('option', { value: '', text: '— pole seotud —' }));
    for (const c of S.companies) {
      const o = el('option', { value: c.id, text: c.priority + ' · ' + c.name });
      if (c.id === m.company_id) o.selected = true;
      linkSel.append(o);
    }
    linkSel.addEventListener('change', async () => {
      try { await api('/api/message/link', { account: m.account, uid: m.uid, companyId: linkSel.value || null }); toast(linkSel.value ? 'Seotud' : 'Seos eemaldatud'); await load(); }
      catch (e) { toast(e.message, true); }
    });

    const acts = el('div', { class: 'send-row' }, [
      el('button', {
        class: 'btn ghost sm', type: 'button', text: m.unread ? 'Märgi loetuks' : 'Märgi lugemata',
        onclick: async (ev) => {
          ev.target.disabled = true;
          try { await api('/api/message/seen', { account: m.account, uid: m.uid, seen: !!m.unread }); await load(); }
          catch (e) { toast(e.message, true); } finally { ev.target.disabled = false; }
        },
      }),
      el('button', {
        class: 'btn ghost sm', type: 'button', text: 'Arhiveeri',
        onclick: async (ev) => {
          if (!confirm('Arhiveerin selle kirja? Postkastist see kaob.')) return;
          ev.target.disabled = true;
          try {
            const r = await api('/api/message/archive', { account: m.account, uid: m.uid });
            toast(r.moved ? 'Arhiveeritud kausta ' + r.box : 'Märgitud arhiveerituks (Archive-kausta ei leitud)');
            selMail = null; await load();
          } catch (e) { toast(e.message, true); } finally { ev.target.disabled = false; }
        },
      }),
      cname ? el('button', {
        class: 'btn ghost sm', type: 'button', text: 'Ava ' + cname,
        onclick: () => { sel = m.company_id; setView('pipeline'); renderList(); renderDetail(); },
      }) : null,
    ].filter(Boolean));

    const d = draftFor(m);
    const replyBody = el('textarea', { rows: '10', placeholder: 'Vastuse tekst… (allkiri lisatakse automaatselt)' });
    const replySubj = el('input', { class: 'input', value: /^re:/i.test(m.subject || '') ? m.subject : 'Re: ' + (m.subject || '') });
    if (d) {
      if (d.subject) replySubj.value = d.subject;
      if (d.body) replyBody.value = d.body;
    }
    const replyAccount = (S.salesAccounts || S.accounts.filter(x => String(x.user).toLowerCase() === 'gert@leisson.eu'))[0];
    const btnReply = el('button', { class: 'btn', type: 'button', text: replyAccount ? 'Vasta kontolt gert@leisson.eu' : 'Saatjakonto gert@leisson.eu puudub', disabled: !replyAccount });
    btnReply.addEventListener('click', async () => {
      if (!replyBody.value.trim()) return toast('Vastuse tekst on tühi', true);

      btnReply.disabled = true; btnReply.textContent = 'Saadan…';
      try {
        if(!await approveAndSend({kind:'reply',account:m.account,accountId:replyAccount?.id,uid:m.uid,to:m.addr,subject:replySubj.value,body:replyBody.value,companyId:m.company_id},'/api/reply'))return;
        toast('Vastus saadetud: ' + m.addr);
        replyBody.value = '';
        await load();
      } catch (e) { toast('Saatmine ebaõnnestus: ' + e.message, true); }
      finally { btnReply.disabled = !replyAccount; btnReply.textContent = 'Vasta kontolt gert@leisson.eu'; }
    });

    // Sama loogika mis müügitorus: keskmine tulp on kiri ise, kõrvaltöö
    // (klassifikatsioon, seos) läheb paremasse tulpa. Keskmine ei keri.
    host.replaceChildren(el('div', { class: 'sheet detail-main' }, [
      el('div', { class: 'head' }, [
        el('h1', { text: m.subject || '(pealkirjata)' }),
        el('div', { class: 'head-meta' }, meta),
        acts,
      ]),
      el('section', { class: 'panel letter' }, [
        el('h2', { text: 'Kirja sisu' }),
        el('div', { class: 'field fill' }, bodyBox),
      ]),
      el('section', { class: 'panel reply' }, [
        el('h2', { text: d ? 'Vasta · agendi mustand' : 'Vasta' }),
        d ? draftBanner(d, m) : null,
        el('div', { class: 'field' }, [el('label', { text: 'Pealkiri' }), replySubj]),
        el('div', { class: 'field fill' }, [el('label', { text: 'Sisu' }), replyBody]),
        el('div', { class: 'send-row panel-foot' }, [btnReply, d ? btnRejectDraft(m) : null].filter(Boolean)),
      ]),
    ].filter(Boolean)));

    side.replaceChildren(el('div', { class: 'sheet side-stack' }, [
      cls ? el('section', { class: 'panel' }, [el('h2', { text: 'Agendi klassifikatsioon' }), cls]) : null,
      el('section', { class: 'panel' }, [
        el('h2', { text: 'Seo sihtmärgiga' }),
        el('div', { class: 'field' }, [el('label', { text: 'Ettevõte' }), linkSel]),
      ]),
    ].filter(Boolean)));
  }

  /* ---------- agendi mustandid (teine võti) ---------- */
  const DRAFT_LABEL = {
    mustand: 'MUSTAND · keeletoimetus tegemata',
    toimetatud: 'TOIMETATUD · kinnitust pole küsitud',
    ootab_kinnitust: 'OOTAB SINU KINNITUST',
  };

  function draftFor(m) {
    return (S.drafts || []).find((x) => x.account === m.account && Number(x.uid) === Number(m.uid)) || null;
  }

  // Riba hoiab lahti AINULT selle, mis on otsuse tegemiseks vajalik: seis ja see,
  // et kiri ei lahe ise valja. Pohjendus ja keeletoimetus on pikad ja lukkasid
  // kirja teksti ekraanist alla - need kaivad kokkupandava plokina.
  function draftBanner(d) {
    const rows = [el('b', { text: DRAFT_LABEL[d.status] || d.status })];
    const selgitus = [];
    if (d.reason) selgitus.push(el('p', { class: 'why', text: 'Agendi põhjendus: ' + d.reason }));
    if (d.edit_notes) selgitus.push(el('p', { class: 'why', text: 'Keeletoimetus: ' + d.edit_notes }));
    if (selgitus.length) {
      rows.push(el('details', { class: 'draft-why' }, [
        el('summary', { text: 'Miks nii? · keeletoimetus' }),
        ...selgitus,
      ]));
    }
    rows.push(el('p', { class: 'why', text: 'Agendil ei ole saatmistööriista. Kiri läheb välja ainult sinu klikist.' }));
    return el('div', { class: 'draftbar ' + d.status }, rows);
  }

  function btnRejectDraft(m) {
    const b = el('button', { class: 'btn ghost', type: 'button', text: 'Lükka mustand tagasi' });
    b.addEventListener('click', async () => {
      const note = prompt('Miks see mustand ei kõlba? (läheb agendi logisse)');
      if (note === null) return;
      b.disabled = true;
      try { await api('/api/draft/reject', { account: m.account, uid: m.uid, note }); toast('Mustand tagasi lükatud'); await load(); }
      catch (e) { toast(e.message, true); } finally { b.disabled = false; }
    });
    return b;
  }

  /* ---------- sünkroonimine ---------- */
  $('#btnSync').addEventListener('click', async () => {
    const b = $('#btnSync');
    b.disabled = true;
    const old = b.textContent;
    b.textContent = 'Sünkroonin…';
    try {
      const r = await api('/api/sync', {});
      const okr = r.results.filter((x) => !x.error);
      const bad = r.results.filter((x) => x.error);
      if (okr.length) toast(okr.map((x) => x.account + ': ' + x.seen + ' kirja, ' + x.fresh + ' uut').join(' · '));
      if (bad.length) toast(bad.map((x) => x.account + ': ' + x.error).join(' · '), true);
      await load();
    } catch (e) { toast('IMAP: ' + e.message, true); }
    finally { b.disabled = false; b.textContent = old; }
  });

  /* ---------- automaatne värskendus ---------- */
  setInterval(() => {
    if (document.hidden || picked.size) return;
    load().catch(() => {});
  }, 60000);

  /* ---------- jagatud pind views.js jaoks ---------- */
  window.CRM = {
    api, el, toast, eur, dt, usd, setView,
    btnDeleteDoc,
    state: () => S,
    reload: load,
    openCompany: (id) => { sel = id; picked.clear(); setView('pipeline'); renderList(); renderDetail(); },
  };

  load()
    .then(() => { if (window.CRMViews) window.CRMViews.render(view); })
    .catch((e) => toast('Laadimine ebaõnnestus: ' + e.message, true));
})();
