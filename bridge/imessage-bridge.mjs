// Tab iMessage bridge.
// Photon sidecar (its own project + line) -> Tab /imessage -> reply back on the same thread.
// Secrets come from env only. Nothing here talks to Arc Studio.
//
// Env: SIDECAR_URL, PHOTON_SIDECAR_TOKEN, TAB_API (http://127.0.0.1:3001), IMESSAGE_RELAY_SECRET

const SIDECAR = process.env.SIDECAR_URL ?? "http://127.0.0.1:8661";
const TOKEN = process.env.PHOTON_SIDECAR_TOKEN ?? "";
const TAB_API = process.env.TAB_API ?? "http://127.0.0.1:3001";
const RELAY = process.env.IMESSAGE_RELAY_SECRET ?? "";
if (!TOKEN || !RELAY) {
  console.error("bridge: PHOTON_SIDECAR_TOKEN and IMESSAGE_RELAY_SECRET are required");
  process.exit(1);
}

const sc = (path, body) =>
  fetch(SIDECAR + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hermes-sidecar-token": TOKEN },
    body: JSON.stringify(body),
  });

const handled = new Set();
const mask = (id) => (id ? String(id).replace(/\d(?=\d{4})/g, "*") : "?");

async function onEvent(ev) {
  if (ev?.content?.type !== "text" || !ev.content.text?.trim()) return;
  if (ev.space?.type === "group") return; // money moves only in 1:1 threads
  const spaceId = ev.space?.id;
  const from = ev.sender?.id || ev.space?.phone;
  if (!spaceId || !from) return;
  if (ev.messageId) {
    if (handled.has(ev.messageId)) return;
    handled.add(ev.messageId);
    if (handled.size > 2000) handled.delete(handled.values().next().value);
  }

  console.log(`in  ${mask(from)} "${ev.content.text.slice(0, 60)}"`);
  void sc("/typing", { spaceId, state: "start" }).catch(() => {});
  let reply = "Tab hit a snag. Try again in a minute.";
  try {
    const r = await fetch(TAB_API + "/imessage", {
      method: "POST",
      headers: { "content-type": "application/json", "x-tab-relay-secret": RELAY },
      body: JSON.stringify({ from, text: ev.content.text, messageId: ev.messageId ?? undefined }),
      signal: AbortSignal.timeout(90_000),
    });
    const d = await r.json().catch(() => ({}));
    if (d.reply) reply = d.reply;
  } catch (e) {
    console.error("tab_error", String(e).slice(0, 200));
  }
  void sc("/typing", { spaceId, state: "stop" }).catch(() => {});
  const s = await sc("/send", { spaceId, text: reply, format: "text" });
  console.log(`out ${mask(from)} ${s.status} "${reply.slice(0, 60)}"`);
}

async function run() {
  for (;;) {
    try {
      const r = await fetch(SIDECAR + "/inbound", { headers: { "x-hermes-sidecar-token": TOKEN } });
      if (!r.ok || !r.body) throw new Error(`inbound ${r.status}`);
      console.log("bridge: listening");
      const dec = new TextDecoder();
      let buf = "";
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          try {
            void onEvent(JSON.parse(line)).catch((e) => console.error("event_error", String(e)));
          } catch {}
        }
      }
      console.error("bridge: inbound closed, reconnecting");
    } catch (e) {
      console.error("bridge:", String(e).slice(0, 160));
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}
run();
