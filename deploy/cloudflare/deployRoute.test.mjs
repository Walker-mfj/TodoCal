import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
import {createHmac} from 'node:crypto';

const key='a'.repeat(64);
const body=JSON.stringify({action:'deploy',id:'b'.repeat(32),tag:'api-'+'c'.repeat(40),ts:Math.floor(Date.now()/1000)});
const sign = value => createHmac('sha256',key).update(value).digest('hex');
const request = (value,signature) => new Request('https://example.com/api/internal/deploy',{
  method:'POST',body:value,headers:{'X-TodoCal-Deploy-Signature':signature,Cookie:'secret'}
});

test('signed event goes only to dedicated deployment binding',async()=>{
  let calls=0;
  const env={API_BACKEND:'vpc',DEPLOY_TRIGGER_SECRET:key,TODOCAL_DEPLOY:{fetch:async req=>{
    calls++;
    assert.equal(req.url,'http://deploy-receiver:8080/deploy');
    assert.equal(req.headers.get('Cookie'),null);
    assert.equal(await req.text(),body);
    return Response.json({status:'queued'});
  }}};
  assert.equal((await worker.fetch(request(body,sign(body)),env)).status,200);
  assert.equal((await worker.fetch(request(body,'0'.repeat(64)),env)).status,401);
  const stale=JSON.stringify({...JSON.parse(body),ts:0});
  assert.equal((await worker.fetch(request(stale,sign(stale)),env)).status,401);
  assert.equal((await worker.fetch(request(body,sign(body)),{...env,API_BACKEND:'maintenance'})).status,503);
  assert.equal(calls,1);
});
