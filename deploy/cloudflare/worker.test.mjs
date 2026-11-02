import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
const env = { API_ORIGIN: 'https://api.example.com', PROXY_SECRET: 'a'.repeat(64), ASSETS: { fetch: async () => new Response('asset') } };
test('serves static assets without an API call', async () => {
  assert.equal(await (await worker.fetch(new Request('https://app.example.com/'), env)).text(), 'asset');
});
test('forwards authentication safely and never follows redirects', async () => {
  const original = globalThis.fetch;
  let sent;
  globalThis.fetch = async request => { sent = request; return new Response('{}', {status:201, headers:{'Set-Cookie':'focus_session=abc; Secure; HttpOnly', 'X-CSRF-Token':'csrf'}}); };
  try {
    const response = await worker.fetch(new Request('https://app.example.com/api/v1/tasks?q=hello', {method:'POST', headers:{Origin:'https://app.example.com','Content-Type':'application/json',Cookie:'focus_session=abc','X-CSRF-Token':'csrf','Idempotency-Key':'request-12345678','CF-Connecting-IP':'203.0.113.9','X-TodoCal-Client-IP':'spoof','X-TodoCal-Proxy-Secret':'spoof'},body:'{"title":"hello"}'}), env);
    assert.equal(sent.url,'https://api.example.com/api/v1/tasks?q=hello');
    assert.equal(sent.headers.get('Origin'),'https://app.example.com');
    assert.equal(sent.headers.get('Cookie'),'focus_session=abc');
    assert.equal(sent.headers.get('X-CSRF-Token'),'csrf');
    assert.equal(sent.headers.get('X-TodoCal-Client-IP'),'203.0.113.9');
    assert.equal(sent.headers.get('X-TodoCal-Proxy-Secret'),env.PROXY_SECRET);
    assert.equal(sent.redirect,'manual');
    assert.equal(await sent.text(),'{"title":"hello"}');
    assert.equal(response.status,201);
    assert.match(response.headers.get('Set-Cookie'),/focus_session=abc/);
    assert.equal(response.headers.get('Cache-Control'),'no-store');
  } finally { globalThis.fetch = original; }
});
test('fails closed when backend settings are missing', async () => {
  assert.equal((await worker.fetch(new Request('https://app.example.com/api/v1/auth/me'), {ASSETS:env.ASSETS})).status,503);
});
test('invalid backend URL returns controlled unavailability', async () => {
  assert.equal((await worker.fetch(new Request('https://app.example.com/api/v1/auth/me'), {...env, API_ORIGIN:'not a url'})).status,503);
});

test('cron uses a dedicated credential and fails on a failed sweep', async () => {
 const original=globalThis.fetch;let sent;
 globalThis.fetch=async request=>{sent=request;return Response.json({accountsProcessed:2})};
 const scheduledEnv={...env,APP_ORIGIN:'https://app.example.com',JOBS_SECRET:'j'.repeat(32)};
 try{
  await worker.scheduled({},scheduledEnv,{});
  assert.equal(sent.url,'https://api.example.com/internal/jobs');
  assert.equal(sent.method,'POST');assert.equal(sent.redirect,'manual');
  assert.equal(sent.headers.get('Authorization'),'Bearer '+scheduledEnv.JOBS_SECRET);
  assert.equal(sent.headers.get('Origin'),scheduledEnv.APP_ORIGIN);
  assert.equal(sent.headers.get('Cookie'),null);
  globalThis.fetch=async()=>new Response('private error',{status:503});
  await assert.rejects(worker.scheduled({},scheduledEnv,{}),/Scheduled job failed: 503/);
  await assert.rejects(worker.scheduled({}, {...scheduledEnv,JOBS_SECRET:''},{}),/not configured/);
 }finally{globalThis.fetch=original}
});
