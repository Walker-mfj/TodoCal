const LIMIT = 1024;
const error = (status) => Response.json({status:'unavailable'}, {status,headers:{'Cache-Control':'no-store'}});

async function boundedBody(request) {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const {value,done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > LIMIT) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk,offset); offset += chunk.byteLength; }
  return result;
}

export async function deploymentRequest(request, env) {
  if (request.method !== 'POST' || new URL(request.url).search) return error(405);
  if (env.API_BACKEND !== 'vpc') return error(503);
  if (!/^[a-f0-9]{64}$/.test(env.DEPLOY_TRIGGER_SECRET || '') ||
      typeof env.TODOCAL_DEPLOY?.fetch !== 'function') return error(503);
  const signature = request.headers.get('X-TodoCal-Deploy-Signature') || '';
  if (!/^[a-f0-9]{64}$/.test(signature)) return error(401);
  try {
    const body = await boundedBody(request);
    if (!body) return error(413);
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.DEPLOY_TRIGGER_SECRET),
      {name:'HMAC',hash:'SHA-256'}, false, ['verify']);
    const bytes = Uint8Array.from(signature.match(/../g), v => parseInt(v,16));
    if (!await crypto.subtle.verify('HMAC',key,bytes,body)) return error(401);
    const data = JSON.parse(new TextDecoder().decode(body));
    if (!Number.isInteger(data.ts) || Math.abs(Date.now()/1000-data.ts)>120) return error(401);
    const response = await env.TODOCAL_DEPLOY.fetch(new Request('http://deploy-receiver:8080/deploy',{
      method:'POST',body,redirect:'manual',headers:{'Content-Type':'application/json','X-TodoCal-Deploy-Signature':signature},
    }));
    const result = await response.json();
    const statuses = ['queued','running','succeeded','failed','needs_approval','unknown','unavailable'];
    if (!statuses.includes(result.status)) return error(502);
    return Response.json({status:result.status},{status:response.status,headers:{'Cache-Control':'no-store'}});
  } catch { return error(503); }
}
