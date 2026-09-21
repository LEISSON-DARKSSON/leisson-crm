#!/usr/bin/env python3
"""LEISSON OÜ riigihangete valvur. Loeb RHR RSS-i, filtreerib LEISSONi nišid, näitab ainult UUED.
Kasutus:  python3 rhr_watch.py [--all] [--state seen.json] [--csv leiud.csv]
Ainult standardteek. Lihthangete tähtaeg on mediaanis 12 päeva (min 6) -> jooksuta iga päev."""
import re, json, csv, sys, os, urllib.request, argparse, datetime as dt
import xml.etree.ElementTree as ET
RSS='https://riigihanked.riik.ee/rhr/api/public/v1/rss'
FIT=re.compile(r'veebi(leh|keskkon|portaal|sait|lahend|arendus)|koduleh|\bportaal|kasutajakogemus|kasutajaliides|\bux\b|\bui\b|teenusedisain|disainisüsteem|kasutajauuring|kasutatavus|prototüüp|ligipääsetavus|wcag|tehisaru|tehisintellekt|\bai\b|keelemudel|vestlusrobot|juturobot|chatbot|visuaalne identiteet|\bcvi\b|brändi|kujundustöö|graafiline disain|digiturundus|sotsiaalmeedia|e-teenus|iseteenindus|rakenduse arendus|mobiilirakendus|digilahendus|digitaalse eneseabi|e-kursus|veebikoolitus|\bweb\b|user experience|design system|accessibility',re.I)
EXCL=re.compile(r'ehitus|projekteeri|planeering|kinnisvara|keskkonnamõju|arhitekt|ühistransport|bussipeat|puude|jõuluvalg|sisekujundus|trükis|meene|litsents|videovalve',re.I)
SMALLWEB=re.compile(r'veebileh|koduleh|veebilahendus|veebisait|veebikeskkon|veebilehtede|kodulehe',re.I)
DC='{http://purl.org/dc/elements/1.1/}'
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--all',action='store_true'); ap.add_argument('--state',default='rhr_seen.json'); ap.add_argument('--csv',default='rhr_leiud.csv'); ap.add_argument('--since-hours',type=float,default=0,help='olekuta režiim: ainult viimase N tunni jooksul avaldatud'); a=ap.parse_args()
    seen=set(json.load(open(a.state))) if os.path.exists(a.state) and not a.all and not a.since_hours else set()
    import email.utils
    now=dt.datetime.now(dt.timezone.utc)
    root=ET.fromstring(urllib.request.urlopen(RSS,timeout=60).read())
    hits=[]; today=dt.date.today()
    for it in root.iter('item'):
        title=it.findtext('title') or ''; desc=it.findtext('description') or ''; link=it.findtext('link') or ''
        parts=[p.strip() for p in desc.split(';')]
        kind=parts[0] if parts else ''; proc=parts[1] if len(parts)>1 else ''
        if kind in ('Ehitustööd','Asjad'): continue
        if not FIT.search(title+' '+desc) or EXCL.search(title): continue
        if a.since_hours:
            pd_=email.utils.parsedate_to_datetime(it.findtext('pubDate'))
            if (now-pd_).total_seconds()>a.since_hours*3600: continue
        m=re.search(r'Tähtaeg: (\d\d)\.(\d\d)\.(\d{4})',desc)
        dl=dt.date(int(m[3]),int(m[2]),int(m[1])) if m else None
        if dl and dl<today: continue
        key=title.split(' - ')[0]+'|'+(dl.isoformat() if dl else '')
        if key in seen: continue
        seen.add(key)
        seg='VÄIKE VEEBILEHT' if SMALLWEB.search(title) else 'nišš'
        hits.append({'segment':seg,'tahtaeg':dl.isoformat() if dl else '','paevi':(dl-today).days if dl else '','menetlus':proc,'hankija':it.findtext(DC+'creator') or '','nimetus':title,'link':link})
    hits.sort(key=lambda h:h['tahtaeg'] or '9999')
    if hits:
        new=not os.path.exists(a.csv)
        with open(a.csv,'a',newline='',encoding='utf-8') as f:
            w=csv.DictWriter(f,fieldnames=list(hits[0])); 
            if new: w.writeheader()
            w.writerows(hits)
    if not a.since_hours: json.dump(sorted(seen),open(a.state,'w'),ensure_ascii=False)
    print(f'# RHR valvur {today} — {len(hits)} uut sobivat hanget')
    for h in hits: print(f"- [{h['segment']}] **{h['tahtaeg']}** ({h['paevi']} p) · {h['menetlus']} · {h['hankija']} — [{h['nimetus']}]({h['link']})")
    return 0
if __name__=='__main__': sys.exit(main())
