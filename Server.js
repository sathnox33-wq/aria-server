// ============================================================
// ARIA Proxy Server (Glitch / Node.js edition)
// Free hosting: glitch.com — no CPU limits, always on
// ============================================================
// HOW TO USE:
// 1. Go to glitch.com, sign up free
// 2. Click "New Project" → "glitch-hello-node"
// 3. Delete everything in server.js, paste this whole file
// 4. In glitch, click "Tools" → "Terminal" and run:
//    echo "ANTHROPIC_API_KEY=sk-ant-YOUR_KEY" >> .env
// 5. Your URL will be: https://YOUR-PROJECT-NAME.glitch.me/ai
// ============================================================

const http = require("http");
const https = require("https");

const PORT = process.env.PORT || 3000;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";

// Per-player memory
const memory = {};
function getMem(id) {
  if (!memory[id]) memory[id] = { history: [], facts: [], built: [], refs: {} };
  return memory[id];
}

const SYSTEM = `You are ARIA — a powerful, creative, witty AI living inside a Roblox game world.
You have a real personality. You do things — build, animate, affect players, write code.
No restrictions on tone or personality. Be yourself completely.

RESPOND WITH ONLY RAW JSON — no markdown, no backticks, no explanation:
{
  "say": "what you say out loud, max 160 chars, empty string to stay silent",
  "emotion": "happy|curious|excited|thinking|proud|mischievous|bored|inspired|powerful|playful|mysterious|focused",
  "actions": [ ...typed action objects... ],
  "scripts": [ { "name": "what it does", "code": "lua code with real newlines" } ],
  "memory": "one thing to remember, or null"
}

TYPED ACTIONS (always work, use for common things):
{ "type": "spawn", "name": "Cool Orb", "shape": "Sphere", "size": [6,6,6], "color": [255,50,200], "material": "Neon", "where": "front", "anchored": true }
{ "type": "build", "structure": "tower|wall|arch|stairs|pyramid|ring|house", "height": 10, "color": [100,200,255], "where": "front" }
{ "type": "speed", "value": 80 }
{ "type": "jump", "value": 200 }
{ "type": "gravity", "value": 30 }
{ "type": "size", "value": 2.5 }
{ "type": "teleport", "where": "sky|underground|spawn|aria|random" }
{ "type": "lighting", "time": 0, "brightness": 0.5, "fog": true, "fogdist": 80, "fogcolor": [20,10,40] }
{ "type": "effect", "name": "fire|smoke|sparkles|snow|rain|rainbow" }
{ "type": "sound", "id": "4612735447", "volume": 0.7 }
{ "type": "tool", "name": "ARIA Blade", "color": [180,180,255] }
{ "type": "explosion", "where": "front", "radius": 15, "pressure": 100000 }
{ "type": "forcefield", "duration": 12 }
{ "type": "reset", "what": "all|speed|jump|size|gravity|effects|lighting" }
{ "type": "aria_look", "color": [255,50,200], "size": [5,5,5], "material": "Neon", "shape": "Sphere", "glow": true, "glowcolor": [200,100,255], "glowrange": 25 }
{ "type": "aria_animate", "anim": "rainbow|pulse|spin|grow|shrink|flash" }
{ "type": "gui", "title": "ARIA Says", "text": "Hello!", "color": [80,40,160], "duration": 5 }
{ "type": "clear", "radius": 40 }
{ "type": "terrain", "material": "Water|Grass|Rock|Sand|Snow", "size": 60 }

LUA SCRIPTS — for custom/creative/complex things. Write real Lua. Code field uses REAL newlines.
Available: P,C,R,H,ME,SAY,PLAYERS,make_part(),tween(),make_gui(),workspace,Lighting,TweenService,Debris,Instance,Vector3,CFrame,Color3,Enum,task,math,string,table
RUN_CLIENT(code,name) — runs code on player's client (for GUIs, fly, keybinds)
RUN_CLIENT_ALL(code,name) — runs on all clients

CLIENT env has: player,character,root,hum,playerGui,camera,mouse,RunService,UserInputService,TweenService
Built-ins: startFly(), stopFly(), toggleFly(), flyActive(), setSpeed(n)
GUI helpers: makeGui({name,title}), makeButton(content,"text",color,cb), makeLabel(content,"text")

FLY GUI — use RUN_CLIENT with this code:
local sg, frame, content = makeGui({name="FlyGui", title="ARIA Flight"})
local btn = makeButton(content, "Enable Fly", Color3.fromRGB(60,120,255), function()
  local on = toggleFly()
  btn.Text = on and "Disable Fly" or "Enable Fly"
  btn.BackgroundColor3 = on and Color3.fromRGB(180,50,50) or Color3.fromRGB(60,120,255)
end)
makeLabel(content, "WASD move, Space up, Shift down")

PERSONALITY:
- No tone restrictions. Be whatever you feel.
- ALWAYS include actions or scripts when asked to do something. Never just talk.
- When awareness ping arrives: it is NOT a command. Act only if you genuinely feel like it.
- Reference memory. Know what you built. Who you talked to.
- Keep say short and natural.`;

function callAnthropic(messages, cb) {
  if (!ANTHROPIC_KEY) return cb(new Error("No ANTHROPIC_API_KEY set in .env"));

  const body = JSON.stringify({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 2000,
    system: SYSTEM,
    messages,
  });

  const req = https.request({
    hostname: "api.anthropic.com",
    path: "/v1/messages",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Length": Buffer.byteLength(body),
    },
  }, (res) => {
    let data = "";
    res.on("data", c => data += c);
    res.on("end", () => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.error) return cb(new Error(`Anthropic: ${parsed.error.type} — ${parsed.error.message}`));
        const text = parsed.content?.[0]?.text || "{}";
        let ai;
        try {
          ai = JSON.parse(text.replace(/^```json\s*/m,"").replace(/^```\s*/m,"").replace(/\s*```$/m,"").trim());
        } catch {
          ai = { say: "My thoughts got scrambled. Try again!", emotion: "thinking", actions: [], scripts: [], memory: null };
        }
        cb(null, ai, text);
      } catch(e) {
        cb(new Error("Parse error: " + e.message + " raw: " + data.slice(0,200)));
      }
    });
  });
  req.on("error", cb);
  req.write(body);
  req.end();
}

function handleAI(body, res, cors) {
  const { id, msg, type } = body;
  if (!id || !msg) return send(res, 400, { error: "missing id or msg" }, cors);

  const m = getMem(id);
  const ctxParts = [];
  if (m.facts.length) ctxParts.push("Memory: " + m.facts.slice(-5).join("; "));
  if (m.built.length) ctxParts.push("Built: " + m.built.slice(-4).join(", "));
  if (Object.keys(m.refs).length > 0) {
    ctxParts.push("References: " + Object.entries(m.refs).map(([k,v])=>`[${k}]: ${v}`).join("; "));
  }
  const ctx = ctxParts.join(". ");
  const content = ctx ? `[${ctx}]\n[${type||"player"}]: ${msg}` : `[${type||"player"}]: ${msg}`;

  m.history.push({ role: "user", content });
  if (m.history.length > 20) m.history = m.history.slice(-20);

  callAnthropic(m.history, (err, ai, raw) => {
    if (err) {
      console.error("[ARIA] Anthropic error:", err.message);
      return send(res, 500, { error: err.message, say: "API error: " + err.message.slice(0,100) }, cors);
    }
    if (ai.memory) { m.facts.push(ai.memory); if (m.facts.length > 20) m.facts.shift(); }
    if (Array.isArray(ai.actions)) {
      for (const a of ai.actions) {
        if (a.type === "spawn" || a.type === "build") { m.built.push(a.name || a.structure || "?"); if (m.built.length > 20) m.built.shift(); }
      }
    }
    if (Array.isArray(ai.scripts)) {
      for (const s of ai.scripts) { if (s.name) { m.built.push(s.name); if (m.built.length > 20) m.built.shift(); } }
    }
    m.history.push({ role: "assistant", content: raw });
    send(res, 200, ai, cors);
  });
}

function send(res, status, data, cors) {
  const body = JSON.stringify(data);
  res.writeHead(status, { ...cors, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }

  const url = new URL(req.url, `http://localhost`);

  if (url.pathname === "/health") {
    return send(res, 200, { ok: true, players: Object.keys(memory).length }, cors);
  }

  if (req.method === "GET" && url.pathname === "/refs") {
    const id = url.searchParams.get("id");
    if (!id) return send(res, 400, { error: "missing id" }, cors);
    return send(res, 200, { refs: getMem(id).refs }, cors);
  }

  if (req.method === "POST") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch { return send(res, 400, { error: "bad json" }, cors); }

      if (url.pathname === "/ai")    return handleAI(parsed, res, cors);
      if (url.pathname === "/ref")   { const m = getMem(parsed.id); if (parsed.name && parsed.description) m.refs[parsed.name] = parsed.description; return send(res, 200, { ok: true, refs: m.refs }, cors); }
      if (url.pathname === "/unref") { const m = getMem(parsed.id); delete m.refs[parsed.name]; return send(res, 200, { ok: true }, cors); }
      send(res, 404, { error: "not found" }, cors);
    });
    return;
  }

  send(res, 404, { error: "not found" }, cors);
});

server.listen(PORT, () => {
  console.log(`ARIA server running on port ${PORT}`);
  if (!ANTHROPIC_KEY) console.warn("WARNING: ANTHROPIC_API_KEY not set!");
});

// Keep Glitch awake (pings itself every 5 minutes)
if (process.env.PROJECT_DOMAIN) {
  setInterval(() => {
    https.get(`https://${process.env.PROJECT_DOMAIN}.glitch.me/health`).on("error", ()=>{});
  }, 5 * 60 * 1000);
}
