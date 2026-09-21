exec(open('analyze.py').read())
import collections, statistics as st, sys
from openpyxl import load_workbook
from openpyxl.styles import Font, PatternFill, Alignment
TODAY=sys.argv[1] if len(sys.argv)>1 else '2026-09-18'
Nd=dedupe(N); Ad=dedupe([a for a in A if a['type'] in('can-standard','can-social')])
PROC={'open':'Avatud','oth-single':'Lihthange/toetuse saaja ost','restricted':'Piiratud','neg-w-call':'Läbirääkimised','neg-wo-call':'Läbirääk. ilma teateta','oth-mult':'Mitmeetapiline','comp-dial':'Võistlev dialoog'}
link=lambda r: f"https://riigihanked.riik.ee/rhr-web/#/procurement/{r['rhr_id']}/general-info" if r['rhr_id'] else ''
def fitscore(r):
    s=0
    if is_fit(r): s+=3
    if 'Veeb/UX/disain' in r['seg']: s+=2
    if r['est_tot'] and r['est_tot']<=140000: s+=1
    if r['est_tot'] and r['est_tot']>1000000: s-=2
    return s
op=[r for r in Nd if r['deadline'] and r['deadline']>=TODAY and r['nature']=='services' and (is_fit(r) or r['seg'])]
df1=pd.DataFrame([{'Sobivus (0-6)':fitscore(r),'Tähtaeg':r['deadline'],'Viitenr':(r['ref'] or '')[:6],'Hankija':r['buyer'],'Nimetus':r['title'],'Eeldatav maksumus €':r['est_tot'],'Menetlus':PROC.get(r['procedure'],r['procedure']),'Hindamine':'+'.join(sorted(set(c for L in r['lots'] for c in L['crit']))),'Segment':', '.join(r['seg']),'CPV':', '.join(r['allcpv'][:4]),'Link':link(r)} for r in op]).sort_values(['Sobivus (0-6)','Tähtaeg'],ascending=[False,True])
fitN=sorted([r for r in Nd if is_fit(r)],key=lambda r:r['date'],reverse=True)
df2=pd.DataFrame([{'Avaldatud':r['date'],'Tähtaeg':r['deadline'],'Viitenr':(r['ref'] or '')[:6],'Hankija':r['buyer'],'Nimetus':r['title'],'Eeldatav €':r['est_tot'],'Menetlus':PROC.get(r['procedure'],r['procedure']),'Raamleping':(r['lots'][0]['framework'] if r['lots'] else ''),'Hindamine':'+'.join(sorted(set(c for L in r['lots'] for c in L['crit']))),'CPV':', '.join(r['allcpv'][:4]),'Link':link(r)} for r in fitN])
rows=[]
for a in Ad:
    if not is_fit(a): continue
    for R in a['results']:
        if R['status']!='selec-w': continue
        s=[x for x in R['stats'] if x]
        for w in R['winners']:
            rows.append({'Lepinguteade':a['date'],'Viitenr':(a['ref'] or '')[:6],'Hankija':a['buyer'],'Nimetus':a['title'],'Võitja':w['name'],'Võitja reg':w['reg'],'Suurus':w['size'],'Summa €':w['amt'],'Pakkumusi':max(s) if s else None,'Menetlus':PROC.get(a['procedure'],a['procedure'])})
df3=pd.DataFrame(rows).sort_values('Lepinguteade',ascending=False)
df4=df3.groupby(['Võitja','Võitja reg'],dropna=False).agg(Võite=('Summa €','size'),Summa_kokku=('Summa €','sum'),Mediaan=('Summa €','median'),Suurus=('Suurus','first')).sort_values('Võite',ascending=False).reset_index()
df5=df2.groupby('Hankija').agg(Hankeid=('Nimetus','size'),Viimane=('Avaldatud','max'),Eeldatav_kokku=('Eeldatav €','sum')).sort_values('Hankeid',ascending=False).reset_index()
plan=pd.read_pickle('plan_rel.pkl')[['ExpectedContractSigningDate','ProcurerName','TargetProcurerName','ProcurementName','ProcurementDescription','cost','ResponsiblePersonEmail']]
plan.columns=['Oodatav lepingu kp','Hankija','Sihthankija','Nimetus','Kirjeldus','Maksumus €','Kontakt']
meta=pd.DataFrame({'Väli':['Allikas','Periood','Filtrid','Sobivus-skoor','Märkus','Uuendamine'],'Väärtus':[
 'RHR avaandmed: opendata/notice + notice_award (eForms XML), hankeplaan 2026 XML, RSS',
 f'2025-01 … 2026-09 (seis {TODAY})',
 'Teenused; märksõnad veeb/portaal/UX/UI/teenusedisain/disainisüsteem/ligipääsetavus/tehisaru/CVI/bränd/e-teenus/digilahendus; CPV 72413, 7242x, 79822; välja arvatud planeering/ehitus/arhitektuur',
 '+3 märksõna sobib, +2 veebi/UX CPV, +1 maksumus ≤140k, −2 maksumus >1 M€',
 'Hankeplaani avaandmetes on 2026 kohta ainult RTK plaanid (419 rida) — teised hankijad avaldavad plaani oma veebis. Summa € = võitja pakkumuse/lepingu summa; raamlepingutes sageli ülempiir, ühikhinna-hangetes (nt 30–55) tunnihind.',
 'rhr_watch.py (RSS, iga päev) · fetch.sh + rhr_parse.py + build_xlsx.py (kuuandmed)']})
out='/mnt/user-data/outputs/LEISSON_riigihanked_2026-09.xlsx'
with pd.ExcelWriter(out,engine='openpyxl') as w:
    for name,d in [('Avatud praegu',df1),('Sobivad hanked 2025-26',df2),('Sobivad lepingud',df3),('Konkurendid',df4),('Hankijad',df5),('Hankeplaan RTK',plan),('Metoodika',meta)]:
        d.to_excel(w,sheet_name=name,index=False)
wb=load_workbook(out)
for ws in wb:
    for c in ws[1]: c.font=Font(name='Arial',bold=True,color='FFFFFF'); c.fill=PatternFill('solid',fgColor='1F2937'); c.alignment=Alignment(wrap_text=True,vertical='top')
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.font=Font(name='Arial',size=10)
            if isinstance(c.value,float) and c.value>100: c.number_format='#,##0'
    for col in ws.columns:
        h=str(col[0].value); L=max(len(str(c.value or '')) for c in col[:200])
        ws.column_dimensions[col[0].column_letter].width=min(max(10,L*0.9),70 if h in('Nimetus','Kirjeldus','Väärtus') else 40)
    ws.freeze_panes='A2'; ws.auto_filter.ref=ws.dimensions
wb.save(out)
print('sheets',len(df1),len(df2),len(df3),len(df4),len(df5),len(plan))
print(df1.head(12)[['Sobivus (0-6)','Tähtaeg','Hankija','Nimetus','Eeldatav maksumus €']].to_string())
# headline stats
ests=[r['est_tot'] for r in fitN if r['est_tot']]
print('fit notices',len(fitN),'per month',round(len(fitN)/21,1),'est median',st.median(ests),'<=50k',sum(e<=50000 for e in ests),'/',len(ests))
print('proc',collections.Counter(r['procedure'] for r in fitN))
q=collections.Counter(('quality' in set(c for L in r['lots'] for c in L['crit'])) for r in fitN); print('has quality',q)
print('awards rows',len(df3),'median',df3['Summa €'][df3['Summa €']>1000].median(),'bids median',df3.Pakkumusi.median(),'single',round((df3.Pakkumusi==1).mean(),2))
print('size',df3.Suurus.value_counts(dropna=False).to_dict())
