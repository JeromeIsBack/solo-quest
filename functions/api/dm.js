/*
 * Solo Quest — DM proxy (Cloudflare Pages Function at /api/dm)
 * Keeps your Anthropic API key server-side and forwards chat requests to Claude.
 *
 * Diagnostic: open https://YOUR-SITE.pages.dev/api/dm in a browser (a GET) and it
 * tells you, in plain JSON, whether the function can see your API key.
 */
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export async function onRequestGet(context) {
  const { env } = context;
  const key = env.ANTHROPIC_API_KEY || "";
  return json({
    ok: true,
    route: "/api/dm is live (this is the health check)",
    keyPresent: !!key,
    keyLooksValid: key.startsWith("sk-ant-"),
    model: "claude-sonnet-5",
    verdict: key
      ? "KEY IS VISIBLE. If the game still fails, the problem is the key VALUE or billing — load the game and the error now shows the real reason."
      : "NO KEY VISIBLE TO THIS FUNCTION. Add ANTHROPIC_API_KEY in this Pages project > Settings > Variables and Secrets (PRODUCTION), then Deployments > Retry deployment."
  }, 200);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.ANTHROPIC_API_KEY)
    return json({ error: "Server can't see ANTHROPIC_API_KEY. Add it to THIS Pages project (Production env) and redeploy." }, 500);

  let body;
  try { body = await request.json(); }
  catch (e) { return json({ error: "Invalid JSON body." }, 400); }
  if (!Array.isArray(body.messages) || !body.messages.length)
    return json({ error: "messages[] is required." }, 400);

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
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    return json({ error: "Could not reach Anthropic: " + e.message }, 502);
  }

  if (!upstream.ok) {
    const t = await upstream.text();
    let detail = t;
    try { const p = JSON.parse(t); detail = (p.error && (p.error.message || p.error)) || t; } catch (e) {}
    return json({ error: detail }, upstream.status);  // passes the REAL reason back (bad key, billing, bad model…)
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") || "text/event-stream",
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}

function json(o, s) {
  return new Response(JSON.stringify(o, null, 2), { status: s || 200, headers: { "Content-Type": "application/json" } });
}
