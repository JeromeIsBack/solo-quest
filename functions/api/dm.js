/*
 * Optional: Cloudflare Pages Function version of the DM proxy.
 * Use this instead of the standalone Worker if you host the static site AND the
 * proxy together on Cloudflare Pages. Then set DM_ENDPOINT = "/api/dm" in
 * index.html (same origin, so no CORS needed).
 *
 * Set the key in your Pages project: Settings → Environment variables →
 * add ANTHROPIC_API_KEY (encrypted).
 */
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.ANTHROPIC_API_KEY)
    return json({ error: "Server missing ANTHROPIC_API_KEY." }, 500);

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

  const upstream = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(payload)
  });

  if (!upstream.ok) {
    const t = await upstream.text();
    let detail = t; try { detail = JSON.parse(t).error || JSON.parse(t); } catch (e) {}
    return json({ error: detail }, upstream.status);
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
  return new Response(JSON.stringify(o), { status: s || 200, headers: { "Content-Type": "application/json" } });
}
