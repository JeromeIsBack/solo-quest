/*
 * Solo Quest — DM proxy (Cloudflare Worker)
 * ------------------------------------------
 * Keeps your Anthropic API key server-side and forwards chat requests to the
 * Messages API. The static PWA calls THIS worker; the key never touches the browser.
 *
 * Setup:
 *   npx wrangler secret put ANTHROPIC_API_KEY      # paste your key when prompted
 *   npx wrangler deploy
 * Then set ALLOWED_ORIGIN (in wrangler.toml) to your site's URL and set
 * DM_ENDPOINT in index.html to this worker's URL.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

function corsHeaders(request, env) {
  const allow = (env.ALLOWED_ORIGIN || "*").trim();
  const origin = request.headers.get("Origin") || "";
  let acao = "*";
  if (allow !== "*") {
    const list = allow.split(",").map(s => s.trim());
    acao = list.includes(origin) ? origin : list[0];
  }
  return {
    "Access-Control-Allow-Origin": acao,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function json(body, status, extra) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, extra || {})
  });
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "Use POST." }, 405, cors);
    if (!env.ANTHROPIC_API_KEY) return json({ error: "Server missing ANTHROPIC_API_KEY secret." }, 500, cors);

    let body;
    try { body = await request.json(); }
    catch (e) { return json({ error: "Invalid JSON body." }, 400, cors); }

    if (!Array.isArray(body.messages) || body.messages.length === 0)
      return json({ error: "messages[] is required." }, 400, cors);

    const payload = {
      model: body.model || "claude-sonnet-5",
      max_tokens: Math.min(Math.max(parseInt(body.max_tokens, 10) || 1200, 64), 4096),
      messages: body.messages,
      stream: body.stream !== false
    };
    if (typeof body.system === "string" && body.system) payload.system = body.system;

    let upstream;
    try {
      upstream = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": ANTHROPIC_VERSION
        },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      return json({ error: "Upstream request failed: " + e.message }, 502, cors);
    }

    if (!upstream.ok) {
      const text = await upstream.text();
      let detail = text;
      try { detail = JSON.parse(text).error || JSON.parse(text); } catch (e) {}
      return json({ error: detail }, upstream.status, cors);
    }

    // Stream the SSE (or JSON) body straight back to the browser.
    const headers = Object.assign({}, cors, {
      "Content-Type": upstream.headers.get("Content-Type") || "text/event-stream",
      "Cache-Control": "no-store"
    });
    return new Response(upstream.body, { status: 200, headers });
  }
};
