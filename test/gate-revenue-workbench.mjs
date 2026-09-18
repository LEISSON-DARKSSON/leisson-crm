import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRevenueWorkbench } from '../lib/revenue-workbench.mjs';

const dir=mkdtempSync(join(tmpdir(),'leisson-revenue-workbench-'));
try {
  const path=join(dir,'workbench.json');
  const fixture={
    schemaVersion:'leisson-business-prospect-web-evidence-v1',completedAt:'2026-09-15T12:00:00Z',
    controls:{mailbox:'gert@leisson.eu',gmailUsed:false,emailsSent:0,approved:false,sendable:false},
    recommendationOrder:['one'],limits:['HTML inspection is not a browser test.'],
    businessFindings:[{
      companyId:'one',company:'One OÜ',crmStatus:'ootel',currentNeedConfirmed:false,receivedInterest:false,
      priority:'Research only',officialUrl:'http://unsafe.example.test/',contact:{publicEmail:'owner@example.test',verification:'public address',outreachPermission:'unverified'},
      observations:[{id:'O-1',statement:'Observed text.',notProven:'Need is not confirmed.'}],
      improvementQuestions:[{question:'Is this useful?',nextVerification:'Ask only after owner review.'}],nextAction:'Review the question.',
      reviewOnlyDraft:{from:'gert@leisson.eu',to:'owner@example.test',subject:'Question',body:'Review body',approved:false,scheduled:false,sendable:false},
    }],
  };
  writeFileSync(path,JSON.stringify(fixture));
  const board=loadRevenueWorkbench(path);
  assert.equal(board.available,true);
  assert.equal(board.mailbox,'gert@leisson.eu');
  assert.equal(board.summary.businesses,1);
  assert.equal(board.summary.confirmedBuyers,0);
  assert.equal(board.summary.reviewOnlyDrafts,1);
  assert.equal(board.prospects[0].officialUrl,null,'only HTTPS links reach the UI');
  assert.deepEqual(board.prospects[0].draft,{from:'gert@leisson.eu',to:'owner@example.test',subject:'Question',body:'Review body',approved:false,scheduled:false,sendable:false});

  fixture.businessFindings[0].reviewOnlyDraft.from='other@example.test';
  writeFileSync(path,JSON.stringify(fixture));
  assert.equal(loadRevenueWorkbench(path).prospects[0].draft,null,'wrong sender cannot become a visible review draft');

  fixture.controls.emailsSent=1;
  writeFileSync(path,JSON.stringify(fixture));
  assert.equal(loadRevenueWorkbench(path).available,false,'sent evidence cannot masquerade as an unsent workbench');
  assert.equal(loadRevenueWorkbench(join(dir,'missing.json')).available,false,'missing private data fails closed');
  console.log('Revenue workbench: private source, gert-only drafts and fail-closed controls passed.');
} finally {
  rmSync(dir,{recursive:true,force:true});
}
