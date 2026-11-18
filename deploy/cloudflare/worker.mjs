// Static Next.js frontend and a same-origin, authenticated API proxy.
const VPC_ORIGIN = 'http://api:10000';

function unavailable(message, retryAfter) {
  const headers = {'Cache-Control':'no-store'};
  if (retryAfter) headers['Retry-After'] = retryAfter;
  return Response.json({error:{code:'unavailable',message}}, {status:503,headers});
}

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    if (!incoming.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    // An absent setting preserves Render. Never fall back to another database
    // after a VPC error, and never forward requests during the write freeze.
    const backend = env.API_BACKEND ?? 'render';
    if (backend === 'maintenance') return unavailable('Service is temporarily unavailable for maintenance.', '60');
    if (backend !== 'render' && backend !== 'vpc') return unavailable('Invalid API configuration.');
    if (!env.PROXY_SECRET || env.PROXY_SECRET.length < 32) return unavailable('Service is not configured yet.');

    const useVpc = backend === 'vpc';
    if (useVpc && typeof env.TODOCAL_API?.fetch !== 'function') return unavailable('Service is not configured yet.');
    let upstream;
    try {
      if (!useVpc && !env.API_ORIGIN) return unavailable('Service is not configured yet.');
      upstream = new URL(useVpc ? VPC_ORIGIN : env.API_ORIGIN);
    } catch {
      return unavailable('Invalid API configuration.');
    }
    if ((!useVpc && upstream.protocol !== 'https:') || upstream.username || upstream.password) {
      return unavailable('Invalid API configuration.');
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
      const response = useVpc ? await env.TODOCAL_API.fetch(forwarded) : await fetch(forwarded);
      const result = new Response(response.body, response);
      result.headers.set('Cache-Control', 'no-store');
      return result;
    } catch {
      return unavailable(useVpc ? 'Service is temporarily unavailable. Please try again shortly.' : 'The server is starting. Please try again shortly.', '10');
    }
  },
};
