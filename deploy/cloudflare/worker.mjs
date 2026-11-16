// Static Next.js frontend and a same-origin, authenticated API proxy.
export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    if (!incoming.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (!env.API_ORIGIN || !env.PROXY_SECRET || env.PROXY_SECRET.length < 32) {
      return Response.json({error:{code:'unavailable',message:'Service is not configured yet.'}}, {status:503,headers:{'Cache-Control':'no-store'}});
    }
    let upstream;
    try { upstream = new URL(env.API_ORIGIN); } catch {
      return new Response("Invalid API configuration", {status:503, headers:{"Cache-Control":"no-store"}});
    }
    if (upstream.protocol !== 'https:' || upstream.username || upstream.password) {
      return new Response('Invalid API configuration', {status:503});
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
      const response = await fetch(new Request(upstream, {
        method: request.method,
        headers,
        body: ['GET','HEAD'].includes(request.method) ? undefined : request.body,
        redirect: 'manual',
        duplex: 'half',
      }));
      const result = new Response(response.body, response);
      result.headers.set('Cache-Control', 'no-store');
      return result;
    } catch {
      return Response.json({error:{code:'unavailable',message:'The server is starting. Please try again shortly.'}}, {status:503,headers:{'Cache-Control':'no-store','Retry-After':'10'}});
    }
  },
};
