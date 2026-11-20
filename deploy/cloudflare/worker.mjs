// Static Next.js frontend and a same-origin, authenticated API proxy.
import { deploymentRequest } from './deployRoute.mjs';

const VPC_ORIGIN = 'http://api:10000';

function unavailable(message, retryAfter) {
  const headers = {'Cache-Control':'no-store'};
  if (retryAfter) headers['Retry-After'] = retryAfter;
  return Response.json({error:{code:'unavailable',message}}, {status:503,headers});
}

// Public, minimal readiness contract. Do not expose upstream headers or errors.
function readiness(ready, method, retryAfter) {
  const headers = {'Cache-Control':'no-store','Content-Type':'application/json'};
  if (retryAfter) headers['Retry-After'] = retryAfter;
  return new Response(method === 'HEAD' ? null : JSON.stringify({status:ready ? 'ready' : 'unavailable'}), {
    status:ready ? 200 : 503, headers,
  });
}

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    if (!incoming.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    if (incoming.pathname === '/api/internal/deploy') return deploymentRequest(request, env);
    const isReadiness = incoming.pathname === '/api/readyz';
    const probe = (ready, retryAfter) => readiness(ready, request.method, retryAfter);

    // Only the designated private origin is supported. Missing/invalid mode
    // fails closed; maintenance blocks requests before they reach the API.
    const backend = env.API_BACKEND;
    if (backend === 'maintenance') return isReadiness ? probe(false, '60') : unavailable('Service is temporarily unavailable for maintenance.', '60');
    if (isReadiness && !['GET','HEAD'].includes(request.method)) {
      return new Response(null, {status:405,headers:{Allow:'GET, HEAD','Cache-Control':'no-store'}});
    }
    if (backend !== 'vpc') return isReadiness ? probe(false) : unavailable('Invalid API configuration.');
    if (!env.PROXY_SECRET || env.PROXY_SECRET.length < 32) return isReadiness ? probe(false) : unavailable('Service is not configured yet.');

    if (typeof env.TODOCAL_API?.fetch !== 'function') return isReadiness ? probe(false) : unavailable('Service is not configured yet.');
    const upstream = new URL(VPC_ORIGIN);

    if (isReadiness) {
      // Always perform the real GET/Ping, including for a client HEAD. Never
      // forward viewer cookies, credentials, query parameters or proxy secret.
      upstream.pathname = '/readyz';
      upstream.search = '';
      upstream.hash = '';
      try {
        const forwarded = new Request(upstream, {method:'GET', redirect:'manual', headers:{Accept:'application/json','Cache-Control':'no-cache'}});
        // Bypass public-fetch edge caching; this probe must reach the origin.
        const response = await env.TODOCAL_API.fetch(forwarded);
        if (response.status !== 200) {
          await response.body?.cancel();
          return probe(false);
        }
        const data = await response.json();
        return probe(data?.status === 'ready');
      } catch {
        return probe(false, '10');
      }
    }

    upstream.pathname = incoming.pathname;
    upstream.search = incoming.search;
    const headers = new Headers(request.headers);
    headers.delete('Host');
    headers.delete('Forwarded');
    headers.delete('X-Forwarded-For');
    headers.set('X-TodoCal-Proxy-Secret', env.PROXY_SECRET);
    headers.set('X-TodoCal-Client-IP', request.headers.get('CF-Connecting-IP') || '');
    try {
      const forwarded = new Request(upstream, {
        method: request.method,
        headers,
        body: ['GET','HEAD'].includes(request.method) ? undefined : request.body,
        redirect: 'manual',
        duplex: 'half',
      });
      const response = await env.TODOCAL_API.fetch(forwarded);
      const result = new Response(response.body, response);
      result.headers.set('Cache-Control', 'no-store');
      return result;
    } catch {
      return unavailable('Service is temporarily unavailable. Please try again shortly.', '10');
    }
  },
};
