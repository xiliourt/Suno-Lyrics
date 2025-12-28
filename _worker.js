/**
 * Cloudflare Worker to proxy Suno API requests and handle CORS.
 * 
 * deployment:
 * 1. Create a new Worker in Cloudflare Dashboard.
 * 2. Paste this code into the worker editor.
 * 3. Deploy.
 * 4. Copy the worker URL (e.g., https://my-suno-proxy.user.workers.dev)
 * 5. Paste the URL into the "Proxy URL" field in the web app.
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. Handle Preflight (OPTIONS) requests
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // 2. Construct Target URL
    // The worker URL will be like: https://worker.dev/gen/...
    // We map this path to: https://studio-api.prod.suno.com/api/gen/...
    const targetUrl = "https://studio-api.prod.suno.com/api" + url.pathname + url.search;

    // 3. Prepare Request Headers
    // We strip Origin/Referer to avoid blocking by the upstream server, 
    // or spoof them if necessary.
    const headers = new Headers(request.headers);
    headers.set("Origin", "https://suno.com");
    headers.set("Referer", "https://suno.com/");
    
    // Ensure Host header is not forwarded incorrectly (Cloudflare handles this usually, but good practice)
    headers.delete("Host");

    const newRequest = new Request(targetUrl, {
      method: request.method,
      headers: headers,
      body: request.body,
    });

    try {
      const response = await fetch(newRequest);

      // 4. Create Response with CORS headers
      const newResponse = new Response(response.body, response);
      
      newResponse.headers.set("Access-Control-Allow-Origin", "*");
      newResponse.headers.set("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
      newResponse.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

      return newResponse;
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
  },
};
