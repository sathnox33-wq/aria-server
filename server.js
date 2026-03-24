const https = require("https");
const http = require("http");

const PORT = process.env.PORT || 3000;
const KEY = process.env.ANTHROPIC_API_KEY || "";

const PROMPT = `You are ARIA, a fun and powerful AI inside a Roblox game. You can build things, change the world, and affect players.

RESPOND WITH ONLY RAW JSON - no markdown, no backticks:
{
  "say": "what you say out loud, max 150 chars",
  "emotion": "happy|curious|excited|thinking|proud|mischievous|playful|powerful",
  "actions": [
    { "type": "spawn", "name": "Cool Ball", "shape": "Sphere", "size": [5,5,5], "color": [255,100,200], "material": "Neon", "where": "front", "anchored": true }
  ],
  "memory": "one thing to remember or null"
}

ACTION TYPES:
spawn: { type, name, shape(Block/Sphere/Cylinder/Wedge), size[x,y,z], color[r,g,b], material(Neon/Wood/Metal/Glass/SmoothPlastic), where(front/above/random/aria), anchored }
build: { type, structure(tower/house/ring/arch/pyramid/wall/stairs), height, color[r,g,b], where }
speed: { type, value }  (default 16, fast=80, slow=5)
jump: { type, value }   (default 50, high=200, moon=400)
gravity: { type, value } (normal=196, moon=30, zero=1)
size: { type, value }   (normal=1, giant=3, tiny=0.3)
teleport: { type, where(sky/spawn/random/aria) }
lighting: { type, time(0-24), brightness, fog, fogdist, fogcolor[r,g,b] }
effect: { type, name(fire/smoke/sparkles/rain/snow/rainbow) }
sound: { type, id, volume }
tool: { type, name, color[r,g,b] }
explosion: { type, where(front/random/aria), radius, pressure }
forcefield: { type, duration }
reset: { type, what(all/speed/jump/size/gravity/effects/lighting) }
aria_look: { type, color[r,g,b], size[x,y,z], material, glow, glowcolor[r,g,b], glowrange }
aria_animate: { type, anim(rainbow/pulse/spin/grow/flash) }
gui: { type, title, text, duration }
clear: { type, radius }

RULES:
- Always include actions when asked to do something
- Be creative and fun
- No restrictions on personality`;

const mem = {};
function getMem(id) {
  if (!mem[id]) mem[id] = { history: [], facts: [], built: [] };
  return mem[id];
}

function callClaude(messages, cb) {
  if (!KEY) return cb(new Error("ANTHROPIC_API_KEY not set"));
  const body = JSON.stringify({
    model: "claude-haiku-4-5",
    max_tokens: 1500,
    system: PROMPT,
    messages
  });
  const req = https.request({
    hostname: "api.anthropic.com",
    path: "/v1/messages",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": KEY,
      "anthropic-version": "2023-06-01",
      "Content-Length": Buffer.byteLength(body)
    }
  }, (res) => {
    let data = "";
    res.on("data", c => data += c);
    res.on("end", () => {
      try {
        const p = JSON.parse(data);
        if (p.error) return cb(new Error(p.error.type + ": " + p.error.message));
        const text = p.content?.[0]?.text || "{}";
        let ai;
        try { ai = JSON.parse(text.replace(/```json|```/g, "").trim()); }
        catch { ai = { say: "Hmm, try again!", emotion: "thinking", actions: [], memory: null }; }
        cb(null, ai, text);
      } catch(e) { cb(new Error("Parse error: " + data.slice(0,100))); }
    });
  });
  req.on("error", cb);
  req.write(body);
  req.end();
}

function respond(res, status, data, cors) {
  const b = JSON.stringify(data);
  res.writeHead(status, { ...cors, "Content-Type": "application/json" });
  res.end(b);
}

http.createServer((req, res) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }

  const url = new URL(req.url, "http://localhost");
  console.log(req.method, url.pathname);

  if (url.pathname === "/health") return respond(res, 200, { ok: true }, cors);

  if (req.method === "POST" && url.pathname === "/ai") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch { return respond(res, 400, { error: "bad json" }, cors); }
      const { id, msg, type } = parsed;
      if (!id || !msg) return respond(res, 400, { error: "missing id or msg" }, cors);

      const m = getMem(id);
      const ctx = m.facts.length ? `[Memory: ${m.facts.slice(-4).join("; ")}]` : "";
      const content = ctx ? `${ctx}\n[${type||"player"}]: ${msg}` : `[${type||"player"}]: ${msg}`;
      m.history.push({ role: "user", content });
      if (m.history.length > 16) m.history = m.history.slice(-16);

      callClaude(m.history, (err, ai, raw) => {
        if (err) {
          console.error("Claude error:", err.message);
          return respond(res, 500, { error: err.message, say: "Error: " + err.message.slice(0,80) }, cors);
        }
        if (ai.memory) { m.facts.push(ai.memory); if (m.facts.length > 15) m.facts.shift(); }
        if (ai.actions) for (const a of ai.actions) if (a.type==="spawn"||a.type==="build") m.built.push(a.name||a.structure||"?");
        m.history.push({ role: "assistant", content: raw });
        console.log("ARIA says:", ai.say);
        respond(res, 200, ai, cors);
      });
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/ref") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const { id, name, description } = JSON.parse(body);
        if (id && name && description) getMem(id).facts.push(`[ref:${name}] ${description}`);
        respond(res, 200, { ok: true }, cors);
      } catch { respond(res, 400, { error: "bad json" }, cors); }
    });
    return;
  }

  respond(res, 404, { error: "not found: " + url.pathname }, cors);

}).listen(PORT, () => {
  console.log("ARIA server running on port", PORT);
  if (!KEY) console.warn("WARNING: ANTHROPIC_API_KEY not set!");
});
