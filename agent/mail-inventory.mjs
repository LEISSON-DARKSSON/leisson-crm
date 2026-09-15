import {open} from '../lib/db.mjs';
import {inventoryMail} from '../lib/mail.mjs';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {ROOT} from '../lib/env.mjs';
const db=open();
try {const result=await inventoryMail(db,{onProgress:r=>console.log(JSON.stringify(r))}); writeFileSync(join(ROOT,'data','mail-inventory.json'),JSON.stringify({checkedAt:new Date().toISOString(),results:result},null,2));console.log(JSON.stringify({complete:result.every(r=>r.complete&&!r.error),folders:result.length}));}finally{db.close();}
