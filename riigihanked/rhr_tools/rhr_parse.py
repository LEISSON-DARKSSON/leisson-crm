#!/usr/bin/env python3
"""RHR avaandmete (eForms UBL) parser -> JSONL. Kasutus: rhr_parse.py fail.xml kind > out.jsonl
kind = notice | award"""
import sys, json
from lxml import etree
NS={'cbc':'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
    'cac':'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
    'efac':'http://data.europa.eu/p27/eforms-ubl-extension-aggregate-components/1',
    'efbc':'http://data.europa.eu/p27/eforms-ubl-extension-basic-components/1',
    'efext':'http://data.europa.eu/p27/eforms-ubl-extensions/1',
    'ext':'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2'}
def t(el,xp):
    r=el.xpath(xp,namespaces=NS); 
    if not r: return None
    v=r[0]; return (v if isinstance(v,str) else (v.text or '')).strip()
def ts(el,xp): return [ (x if isinstance(x,str) else (x.text or '')).strip() for x in el.xpath(xp,namespaces=NS)]
def fnum(x):
    try: return float(x)
    except: return None
def parse(el,kind):
    orgs={}
    for o in el.xpath('.//efac:Organizations/efac:Organization',namespaces=NS):
        oid=t(o,'efac:Company/cac:PartyIdentification/cbc:ID')
        orgs[oid]={'name':t(o,'efac:Company/cac:PartyName/cbc:Name'),'reg':t(o,'efac:Company/cac:PartyLegalEntity/cbc:CompanyID') or t(o,'.//cbc:CompanyID'),
                   'size':t(o,'efac:Company/efbc:CompanySizeCode'),'country':t(o,'.//cac:Country/cbc:IdentificationCode')}
    buyer_ref=t(el,'cac:ContractingParty/cac:Party/cac:PartyIdentification/cbc:ID')
    b=orgs.get(buyer_ref,{})
    pp='cac:ProcurementProject'
    cpv=ts(el,pp+'/cac:MainCommodityClassification/cbc:ItemClassificationCode')+ts(el,pp+'/cac:AdditionalCommodityClassification/cbc:ItemClassificationCode')
    lots=[]
    for L in el.xpath('cac:ProcurementProjectLot',namespaces=NS):
        lots.append({'lot':t(L,'cbc:ID'),'name':t(L,'cac:ProcurementProject/cbc:Name'),
          'cpv':ts(L,'cac:ProcurementProject/cac:MainCommodityClassification/cbc:ItemClassificationCode')+ts(L,'cac:ProcurementProject/cac:AdditionalCommodityClassification/cbc:ItemClassificationCode'),
          'est':fnum(t(L,'cac:ProcurementProject/cac:RequestedTenderTotal/cbc:EstimatedOverallContractAmount')),
          'deadline':t(L,'cac:TenderingProcess/cac:TenderSubmissionDeadlinePeriod/cbc:EndDate'),
          'framework':t(L,"cac:TenderingProcess/cac:ContractingSystem/cbc:ContractingSystemTypeCode[@listName='framework-agreement']"),
          'crit':sorted(set(ts(L,'.//cbc:AwardingCriterionTypeCode'))),
          'uri':t(L,'.//cac:CallForTendersDocumentReference//cbc:URI'),
          'dur':t(L,'cac:ProcurementProject/cac:PlannedPeriod/cbc:DurationMeasure')})
    rec={'kind':kind,'notice_id':t(el,'cbc:ID'),'folder':t(el,'cbc:ContractFolderID'),'date':(t(el,'cbc:IssueDate') or '')[:10],
      'type':t(el,'cbc:NoticeTypeCode'),'subtype':t(el,'.//efac:NoticeSubType/cbc:SubTypeCode'),
      'buyer':b.get('name'),'buyer_reg':b.get('reg'),'procedure':t(el,'cac:TenderingProcess/cbc:ProcedureCode'),
      'ref':t(el,pp+'/cbc:ID'),'title':t(el,pp+'/cbc:Name'),'desc':(t(el,pp+'/cbc:Description') or '')[:600],
      'nature':t(el,pp+"/cbc:ProcurementTypeCode[@listName='contract-nature']"),
      'est':fnum(t(el,pp+'/cac:RequestedTenderTotal/cbc:EstimatedOverallContractAmount')),'cpv':cpv,'lots':lots}
    if kind=='award':
        tenders={}
        for T in el.xpath('.//efac:NoticeResult/efac:LotTender',namespaces=NS):
            tenders[t(T,'cbc:ID')]={'amt':fnum(t(T,'cac:LegalMonetaryTotal/cbc:PayableAmount')),'tp':t(T,'efac:TenderingParty/cbc:ID'),'lot':t(T,'efac:TenderLot/cbc:ID')}
        tp={}
        for P in el.xpath('.//efac:NoticeResult/efac:TenderingParty',namespaces=NS):
            tp[t(P,'cbc:ID')]=ts(P,'efac:Tenderer/cbc:ID')
        results=[]
        for R in el.xpath('.//efac:NoticeResult/efac:LotResult',namespaces=NS):
            stats=[fnum(t(S,'efbc:StatisticsNumeric')) for S in R.xpath('efac:ReceivedSubmissionsStatistics',namespaces=NS)]
            wins=[]
            for tid in ts(R,'efac:LotTender/cbc:ID'):
                T=tenders.get(tid,{})
                for oref in tp.get(T.get('tp'),[]):
                    o=orgs.get(oref,{}); wins.append({'name':o.get('name'),'reg':o.get('reg'),'size':o.get('size'),'country':o.get('country'),'amt':T.get('amt')})
            results.append({'lot':t(R,'efac:TenderLot/cbc:ID'),'status':t(R,'cbc:TenderResultCode'),'stats':stats,'winners':wins,
                            'max':fnum(t(R,'cbc:HigherTenderAmount')),'min':fnum(t(R,'cbc:LowerTenderAmount'))})
        rec['total']=fnum(t(el,'.//efac:NoticeResult/cbc:TotalAmount'))
        rec['results']=results
    return rec
def main(path,kind):
    for ev,el in etree.iterparse(path,events=('end',),huge_tree=True):
        tag=etree.QName(el).localname
        if tag in('ContractNotice','ContractAwardNotice','PriorInformationNotice') and el.getparent() is not None and etree.QName(el.getparent()).localname=='OPEN-DATA':
            try: print(json.dumps(parse(el,kind),ensure_ascii=False))
            except Exception as e: print(json.dumps({'error':str(e)}),file=sys.stderr)
            el.clear()
            while el.getprevious() is not None: del el.getparent()[0]
if __name__=='__main__': main(sys.argv[1],sys.argv[2])
