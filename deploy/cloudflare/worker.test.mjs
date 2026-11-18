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

test('deployment removes scheduled triggers and handler', async () => {
  const {readFile} = await import('node:fs/promises');
  const config = JSON.parse(await readFile(new URL('./wrangler.jsonc', import.meta.url), 'utf8'));
  assert.deepEqual(config.triggers.crons, []);
  assert.equal(worker.scheduled, undefined);
});

test('VPC routes only to the registered private service and preserves the proxy contract', async () => {
  const original = globalThis.fetch;
  let sent;
  globalThis.fetch = async () => { assert.fail('public fallback must not run'); };
  try {
    const response = await worker.fetch(new Request('https://todocal.digitalhome.workers.dev/api/v1/tasks?q=hello', {
      method:'PATCH', body:'{"title":"hello"}',
      headers:{
        Origin:'https://todocal.digitalhome.workers.dev', Cookie:'focus_session=abc',
        'Content-Type':'application/json', 'X-CSRF-Token':'csrf', 'Idempotency-Key':'request-12345678',
        'CF-Connecting-IP':'203.0.113.9', 'X-TodoCal-Client-IP':'spoof',
        'X-TodoCal-Proxy-Secret':'spoof', 'X-Forwarded-For':'spoof', Forwarded:'spoof', Host:'spoof',
      },
    }), {...env, API_BACKEND:'vpc', API_ORIGIN:undefined, TODOCAL_API:{fetch:async request => {
      sent = request;
      const h = new Headers({Location:'/next','Cache-Control':'public, max-age=100'});
      h.append('Set-Cookie','focus_session=abc; Secure; HttpOnly');
      h.append('Set-Cookie','focus_refresh=def; Secure; HttpOnly');
      return new Response(null,{status:307,headers:h});
    }}});
    assert.equal(sent.url,'http://api:10000/api/v1/tasks?q=hello');
    assert.equal(sent.method,'PATCH');
    assert.equal(sent.redirect,'manual');
    assert.equal(sent.headers.get('Origin'),'https://todocal.digitalhome.workers.dev');
    assert.equal(sent.headers.get('Cookie'),'focus_session=abc');
    assert.equal(sent.headers.get('X-CSRF-Token'),'csrf');
    assert.equal(sent.headers.get('Idempotency-Key'),'request-12345678');
    assert.equal(sent.headers.get('X-TodoCal-Client-IP'),'203.0.113.9');
    assert.equal(sent.headers.get('X-TodoCal-Proxy-Secret'),env.PROXY_SECRET);
    for (const name of ['Host','Forwarded','X-Forwarded-For']) assert.equal(sent.headers.get(name),null);
    assert.equal(await sent.text(),'{"title":"hello"}');
    assert.equal(response.status,307);
    assert.equal(response.headers.get('Location'),'/next');
    assert.deepEqual(response.headers.getSetCookie(),['focus_session=abc; Secure; HttpOnly','focus_refresh=def; Secure; HttpOnly']);
    assert.equal(response.headers.get('Cache-Control'),'no-store');
  } finally { globalThis.fetch = original; }
});

test('maintenance blocks every API method without invoking either origin; assets stay available', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('unexpected'); };
  const maintenance = {...env, API_BACKEND:'maintenance', TODOCAL_API:{fetch:globalThis.fetch}};
  try {
    for (const method of ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']) {
      const res = await worker.fetch(new Request('https://app.example.com/api/v1/tasks',{method}),maintenance);
      assert.equal(res.status,503);
      assert.equal(res.headers.get('Cache-Control'),'no-store');
      assert.equal(res.headers.get('Retry-After'),'60');
    }
    assert.equal(await (await worker.fetch(new Request('https://app.example.com/'),maintenance)).text(),'asset');
    assert.equal(calls,0);
  } finally { globalThis.fetch = original; }
});

test('VPC failure never falls back to Render; missing binding and invalid mode fail closed', async () => {
  const original = globalThis.fetch;
  let publicCalls = 0;
  globalThis.fetch = async () => { publicCalls++; throw new Error('unexpected'); };
  const request = () => new Request('https://app.example.com/api/v1/auth/me');
  try {
    for (const variant of [
      {...env,API_BACKEND:'vpc'},
      {...env,API_BACKEND:'vpc',TODOCAL_API:{fetch:async () => {throw new Error('tunnel down');}}},
      {...env,API_BACKEND:'vpc',TODOCAL_API:{fetch:async () => new Response('upstream unavailable',{status:503})}},
      {...env,API_BACKEND:'typo'},
      {...env,API_BACKEND:'render',API_ORIGIN:'http://api:10000'},
      {...env,API_BACKEND:'vpc',PROXY_SECRET:'short'},
    ]) {
      const res = await worker.fetch(request(),variant);
      assert.equal(res.status,503);
      assert.equal(res.headers.get('Cache-Control'),'no-store');
    }
    assert.equal(publicCalls,0);
  } finally { globalThis.fetch = original; }
});

test('explicit Render mode ignores the VPC binding', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async req => { calls++; assert.equal(req.url,'https://api.example.com/api/v1/auth/me'); return new Response('{}'); };
  try {
    const res = await worker.fetch(new Request('https://app.example.com/api/v1/auth/me'),{...env,API_BACKEND:'render',TODOCAL_API:{fetch:async () => {throw new Error('unexpected VPC call');}}});
    assert.equal(res.status,200);
    assert.equal(calls,1);
  } finally { globalThis.fetch = original; }
});

test('deployment binds only the designated private VPC service and does not pin a live backend mode', async () => {
  const {readFile} = await import('node:fs/promises');
  const config = JSON.parse(await readFile(new URL('./wrangler.jsonc', import.meta.url), 'utf8'));
  assert.deepEqual(config.vpc_services,[{binding:'TODOCAL_API',service_id:'01a1eed9-dd8d-75e2-b7b3-617e4480ac78',remote:true}]);
  assert.equal(config.vars?.API_BACKEND,undefined);
});
