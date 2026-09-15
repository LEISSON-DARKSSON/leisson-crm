// Evidence-only draft helper. Observations do not qualify a buyer or authorize contact.
import {leiud} from './kaart.mjs';
import {teenus,KAIBEMAKS,CATALOG_VERSION} from './hinnakiri.mjs';
export function kolbab(m){return !!(m?.ok===true&&leiud(m).length>=2);}
export function onAvalik(name){return /vald|vallavalitsus|linnavalitsus|sihtasutus|\bSA\b|haigla|amet|ministeerium|muuseum|teater|raamatukogu|kool|gümnaasium/i.test(String(name||''));}
export function teemarida(domain,m,L=leiud(m)){return L.length?String(domain)+': '+L[0].leid:String(domain)+': veebilehe tähelepanek';}
export function kylmkiri({nimi,domeen,m,lisa=null}){
 if(!kolbab(m))return null;
 const findings=leiud(m),first=findings[0],service=teenus('inquiry-repair');
 if(!service?.aktiivne)return null;
 return {
  subject:teemarida(domeen,m,findings),
  body:'Tere!\n\n'+
   'Vaatasin '+domeen+' avalehe HTML-i. '+first.leid+'. '+first.mis+'\n\n'+
   'See vaatlus üksi ei näita teie ärilist vajadust, otsingupositsiooni ega päringute arvu. Brauseris ja mobiilis tuleb asjakohane teekond eraldi kontrollida.\n\n'+
   'Kui teie praegune eesmärk on muuta teenuse tutvustus ja päringu saatmine selgemaks, sobib kaalumiseks „'+service.nimi+'”. '+service.mark+'\n\n'+
   'Hind '+service.hind+' €, tarne '+service.tarne+' pärast sisendi ja ligipääsu saamist. '+KAIBEMAKS.lause+'\n\n'+
   'Kas see on teie jaoks praegu lahendamist vajav teema?',
  fakt:first.moot,serviceId:service.id,catalogVersion:CATALOG_VERSION,
  from:'gert@leisson.eu',needsApproval:true,readyToSend:false,additionalEvidenceRequiresReview:!!lisa
 };
}
