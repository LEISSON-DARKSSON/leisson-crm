import json,glob,re,pandas as pd
def load(pat):
    rows=[]
    for f in sorted(glob.glob(pat)):
        for l in open(f):
            if l.strip(): rows.append(json.loads(l))
    return rows
N=load('data/notice_2*.jsonl'); A=load('data/notice_award_*.jsonl')
SEG={
 'Veeb/UX/disain':['72413','72420','72421','72422','79822'],
 'Tarkvaraarendus':['7221','7222','7223','72240','72250','72260','72262','72263','72268','72500','72000000','72200000','72600','72590'],
 'Digiturundus/kommunikatsioon':['7934','79341','79342','79413','79416','79310','79320','79330','79950','92111'],
 'IT-nõustamine/analüüs':['72221','72222','72224','72226','72227','72228','72246','72100','72110','72120','72130','72140','72150','72300','72310','72316','72319','72320','79411','79400000','73220','73300','73000000','73200'],
 'Koolitus':['80500','80510','80511','80521','80522','80530','80533','80420'],
}
KW=re.compile(r'veebi|koduleh|kodulehe|portaal|kasutajaliides|kasutajakogemus|\bux\b|\bui\b|disain|kujundus|visuaal|bränd|tehisaru|tehisintellekt|\bai\b|masinõpe|rakendus|tarkvara|infosüsteem|digilahendus|ligipääsetav|e-teenus|iseteenindus|analüüs.*(süsteem|it)|prototüüp|turundus|sotsiaalmeedia|kampaania|video',re.I)
def seg_of(cpvs):
    out=set()
    for c in cpvs:
        for s,pre in SEG.items():
            if any(c.startswith(p) for p in pre): out.add(s)
    return sorted(out)
def allcpv(r): 
    c=list(r['cpv'])
    for L in r['lots']: c+=L['cpv']
    return list(dict.fromkeys(c))
for r in N+A:
    r['allcpv']=allcpv(r); r['seg']=seg_of(r['allcpv']); r['kw']=bool(KW.search((r['title'] or '')+' '+(r['desc'] or '')))
    r['est_tot']=r['est'] if r['est'] else (sum(L['est'] or 0 for L in r['lots']) or None)
    r['rhr_id']=None
    for L in r['lots']:
        m=re.search(r'procurement/(\d+)',L.get('uri') or '')
        if m: r['rhr_id']=m.group(1);break
    r['deadline']=min([L['deadline'][:10] for L in r['lots'] if L['deadline']] or [None]) if any(L['deadline'] for L in r['lots']) else None
FIT=re.compile(r'veebi(leh|keskkon|portaal|sait|lahend|arendus)|koduleh|\bportaal|kasutajakogemus|kasutajaliides|\bux\b|\bui\b|teenusedisain|disainisüsteem|kasutajauuring|kasutatavus|prototüüp|ligipääsetavus.*(veeb|digi|e-|audit)|wcag|tehisaru|tehisintellekt|\bai\b|keelemudel|vestlusrobot|juturobot|chatbot|visuaalne identiteet|\bcvi\b|brändi|kujundustöö|graafiline disain|digiturundus|sotsiaalmeedia|e-teenus|iseteenindus|rakenduse arendus|mobiilirakendus|digilahendus|digitaalse eneseabi|e-kursus|veebikoolitus',re.I)
def dedupe(rows):
    d={}
    for r in sorted(rows,key=lambda r:r['date']): d[r['folder']]=r
    return list(d.values())
def is_fit(r):
    txt=(r['title'] or '')
    if r['nature'] in ('works','supplies'): return False
    if re.search(r'ehitus|projekteeri|planeering|kinnisvara|keskkonnamõju|arhitekt|ühistransport|bussipeat|puude|jõuluvalg|sisekujundus|trükis|meene',txt,re.I): return False
    return bool(FIT.search(txt)) or 'Veeb/UX/disain' in r['seg']
