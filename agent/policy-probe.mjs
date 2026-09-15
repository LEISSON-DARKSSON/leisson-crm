// Captures real CLI wire tools against loopback with fake ChatGPT auth. Never contacts a paid model.
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
export async function verifyLocalPolicy({bin,catalog,model,args,environment,execute}) {
 const base=mkdtempSync(join(tmpdir(),'leisson-policy-')),home=join(base,'home'),work=join(base,'work');
 mkdirSync(home);mkdirSync(work);
 const jwt='e30.'+Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'fixture',chatgpt_plan_type:'plus'},exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture';
 writeFileSync(join(home,'auth.json'),JSON.stringify({auth_mode:'chatgpt',tokens:{id_token:jwt,access_token:jwt,refresh_token:'fixture',account_id:'fixture'},last_refresh:new Date().toISOString()}));
 const catalogPath=join(base,'catalog.json');writeFileSync(catalogPath,JSON.stringify(catalog));
 const captures=[],sockets=new Set();
 function capture(raw) {const request=JSON.parse(raw);captures.push(request.tools??request.response?.tools??[]);}
 const server=createServer((req,res)=>{
  const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{
   if(req.url.includes('/responses')) {
    try{capture(Buffer.concat(chunks).toString());}catch{}
    res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'local_probe_complete'}}));return;
   }
   res.writeHead(200,{'content-type':'application/json'});res.end(req.url.includes('models')?JSON.stringify(catalog):'{}');
  });
 });
 server.on('connection',socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));});
 server.on('upgrade',(req,socket)=>{
  const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  let buf=Buffer.alloc(0),handled=false;
  socket.on('data',c=>{
   if(handled)return;buf=Buffer.concat([buf,c]);if(buf.length<2)return;
   let len=buf[1]&127,o=2;
   if(len===126){if(buf.length<4)return;len=buf.readUInt16BE(2);o=4;}
   else if(len===127){if(buf.length<10)return;len=Number(buf.readBigUInt64BE(2));o=10;}
   const masked=Boolean(buf[1]&128);if(buf.length<o+(masked?4:0)+len)return;
   const mask=masked?buf.subarray(o,o+4):null;o+=masked?4:0;
   const data=Buffer.from(buf.subarray(o,o+len));if(mask)for(let i=0;i<data.length;i++)data[i]^=mask[i%4];
   try{capture(data.toString());}catch{return;}handled=true;socket.destroy();return;

  });
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+server.address().port;
 try{
  const result=await execute(bin.command,[...bin.prefix,'exec',...args,'-C',work,'-m',model,
   '-c','model_catalog_json='+JSON.stringify(catalogPath),'-c','chatgpt_base_url="'+url+'"',
   '-c','openai_base_url="'+url+'"','-'],{cwd:work,env:environment(home),input:'Return exactly {"ok":true}.',timeoutMs:20000});
  if(!captures.length)throw new Error('policy_unverified:no_request_captured');
  for(const tools of captures)for(const tool of tools) {
    if(tool.type!=='function'||tool.name!=='request_user_input')throw new Error('policy_unverified:action_tool:'+String(tool.name||tool.type));
  }
  if(!result.out.includes('local_probe_complete'))throw new Error('policy_unverified:probe_runtime_failed');
  return {model,tool_names:[...new Set(captures.flatMap(t=>t.map(x=>x.name)))],action_tools:0};
 }finally{
  for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));
  if(!resolve(base).startsWith(resolve(tmpdir())+sep+'leisson-policy-'))throw new Error('unsafe_cleanup');
  try{rmSync(base,{recursive:true,force:true,maxRetries:5,retryDelay:200});}catch{}
 }
}
