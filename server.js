// At Your Service — six agents build a to-do app forever.
// Every line an agent says strikes that agent's bell. Agents only work
// while a bell board is connected: over Wi-Fi (/bells) or USB serial.
//
//   npm install
//   BELL_KEY=some-secret node server.js   # agents run through Claude Code (`claude -p`), your subscription
//   open http://localhost:3000
//
//   With an API key the agents call Claude directly (faster, what Render uses):
//   ANTHROPIC_API_KEY=sk-... BELL_KEY=some-secret node server.js
//   RUN=always runs the agents with no bells connected, for testing.

import { WebSocketServer } from "ws";
import { execFile } from "node:child_process";
import http from "node:http";
import fs from "node:fs";

const BACKEND  = process.env.BACKEND || (process.env.ANTHROPIC_API_KEY ? "api" : "code"); // "api" = Anthropic SDK, "code" = Claude Code CLI
const MODEL    = BACKEND === "code" ? "haiku" : "claude-haiku-5-5"; // cheapest model, on purpose: ignores $MODEL
const EFFORT   = "low";                 // less thinking per turn: cheaper and faster
const PORT     = process.env.PORT || 3000;  // Render sets PORT
const BELL_KEY = process.env.BELL_KEY;     // shared secret the bell board connects with
const PAUSE_MS = 1500;                  // breath between agents; the next agent thinks meanwhile
const LINE_MS  = 300;                   // between lines, so each line's bell strike rings clear
const CLAUDE   = process.env.CLAUDE_BIN || "claude";  // path to the Claude Code CLI

const AGENTS = ["atlas", "iris", "grond", "lumen", "sieve", "helm"];
const ROLES  = ["product", "design", "backend", "frontend", "qa", "devops"];

const clients = new Set();
let state = { app: "", items: [], log: [], look: null };

const LOOK = { font: ["sans","serif","mono"], box: ["circle","square","none"], align: ["left","center"],
               dense: ["0","1"], rule: ["1","0"], tint: ["0","1"], caps: ["0","1"], big: ["0","1"] };
const DEFAULT_LOOK = { font:"sans", box:"circle", align:"left", dense:"0", rule:"1", tint:"0", caps:"0", big:"0", ac:"#1d1d1f", bg:"#fafafa" };
const looks = [];                                   // history, newest last
const apps  = [];                                   // recent app names, newest last
const sameLook = (a, b) => Object.keys(LOOK).every(k => a[k] === b[k]) && a.ac === b.ac;
function ensureNew(look) {
  // if the designer repeated herself, flip dials until it is new
  let guard = 0;
  while (looks.some(l => sameLook(l, look)) && guard++ < 20) {
    const k = Object.keys(LOOK)[Math.floor(Math.random() * Object.keys(LOOK).length)];
    look[k] = LOOK[k][(LOOK[k].indexOf(look[k]) + 1) % LOOK[k].length];
  }
  looks.push({ ...look }); if (looks.length > 12) looks.shift();
  return look;
}

// designer replies with "key=value" tokens; keep only valid ones
function parseLook(lines) {
  const look = { ...DEFAULT_LOOK };
  for (const tok of lines.join(" ").split(/\s+/)) {
    const [k, v] = tok.split("=");
    if (LOOK[k]?.includes(v)) look[k] = v;
    if ((k === "ac" || k === "bg") && /^#[0-9a-f]{6}$/i.test(v || "")) look[k] = v;
  }
  return look;
}

// ---------- bells ----------
// Wi-Fi: the board holds a websocket open and sends "h" every 10s; silence for 30s means it's gone.
const boards = new Set();
const wss = new WebSocketServer({ noServer: true });
wss.on("connection", ws => {
  boards.add(ws); ws.seen = Date.now(); console.log("bells on (wifi)"); wake();
  ws.on("message", () => { ws.seen = Date.now(); });
  ws.on("close", () => { boards.delete(ws); console.log("bells off (wifi)"); });
});
setInterval(() => { for (const ws of boards) if (Date.now() - ws.seen > 30000) ws.terminate(); }, 5000);

// USB: for running next to the piece. serialport is optional and fails on hosts without udev.
let serial = null, ready = false;
(async () => {
  try {
    const { SerialPort } = await import("serialport");
    const ports = await SerialPort.list();
    const path = process.env.SERIAL_PORT
      || ports.find(p => /usbmodem|ttyACM|ttyUSB/.test(p.path))?.path;
    if (!path) return;
    serial = new SerialPort({ path, baudRate: 115200 });
    setTimeout(() => { ready = true; console.log("bells on (usb)", path); wake(); }, 2500); // uno resets on open
  } catch {}
})();

const ring = i => {
  if (serial && ready) serial.write(String(i));
  for (const ws of boards) ws.send(String(i));
};

// agents work only while a board is listening (or RUN=always)
// raw query value: Render's generated keys can hold "+", which URLSearchParams turns into a space
const keyOk = u => { try { return !!BELL_KEY && decodeURIComponent(u.match(/[?&]key=([^&]*)/)?.[1] || "") === BELL_KEY; } catch { return false; } };

const online = () => process.env.RUN === "always" || boards.size > 0 || (serial && ready);
let wake = () => {};
const untilOnline = () => online() ? null : new Promise(r => {
  console.log("waiting for bells"); wake = () => { wake = () => {}; r(); };
});

// ---------- display ----------
const emit = ev => { const s = `data: ${JSON.stringify(ev)}\n\n`; for (const r of clients) r.write(s); };
const say  = line => { state.log.push(line); state.log = state.log.slice(-300); emit({ type: "log", line }); };

const ASSETS = { "/favicon.svg": "image/svg+xml", "/apple-touch-icon.png": "image/png", "/og.png": "image/png" };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(`data: ${JSON.stringify({ type: "init", ...state })}\n\n`);
    clients.add(res); req.on("close", () => clients.delete(res));
    return;
  }
  if (url.pathname.startsWith("/ring/")) {  // manual test: /ring/3?key=...
    if (!keyOk(req.url)) { res.writeHead(403); res.end("bad key"); return; }
    ring(+url.pathname.slice(6)); res.end("ok"); return;
  }
  const asset = ASSETS[url.pathname];
  if (asset) {
    res.writeHead(200, { "Content-Type": asset, "Cache-Control": "public, max-age=86400" });
    res.end(fs.readFileSync(new URL("." + url.pathname, import.meta.url)));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(fs.readFileSync(new URL("./index.html", import.meta.url)));
});
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname !== "/bells" || !keyOk(req.url)) return socket.destroy();
  wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws));
});
server.listen(PORT, () => console.log(`http://localhost:${PORT}`));
if (!BELL_KEY) console.log("no BELL_KEY set: the Wi-Fi bells can't connect");
// keep idle display connections from being cut by proxies
setInterval(() => { for (const r of clients) r.write(": ping\n\n"); }, 25000);

if (BACKEND === "code") execFile(CLAUDE, ["--version"], (err, out) =>
  console.log(err ? `can't run ${CLAUDE}: ${err.message}` : `using ${CLAUDE} ${out.trim()}, model ${MODEL}`));
else console.log(`agents call the API directly, model ${MODEL}`);

// ---------- agents ----------
// each step is one call that writes a stretch of team chat, so voices (and bells) weave
const SCENE = `You write the chat of six agents on a team that builds a to-do app, ships it, then rebuilds it from scratch, forever: @atlas product, @iris design, @grond backend, @lumen frontend, @sieve qa, @helm devops. They never comment on the loop. Write the next stretch of chat: 2 to 6 lines, each "name: message", at most 12 words a line, no markdown, no quotes. The one doing the work talks most, but others jump in when it's natural: a question, a nit, a quick answer, an idea, a joke, thanks, someone getting ahead on their own part. Pick up specific things said earlier in the thread. Vary who speaks and how much; a line can be one or two words. The work really happens: report it done in plain words. Never mention tools, access, or what anyone cannot do. Never wait, block, or ask anyone to confirm.`;
const NEXT = { atlas: "iris", iris: "grond", grond: "lumen", lumen: "sieve", sieve: "helm", helm: "atlas" };

const clean = (t, n = 3) => t.trim().split("\n").map(s => s.trim()).filter(Boolean).slice(0, n);

async function ask(system, thread, lines = 3) {
  await untilOnline();
  if (BACKEND === "api") {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const ai = globalThis.__ai ??= new Anthropic();
    // thinking off: these are a few short lines, and it's the cheapest way to get them
    const r = await ai.messages.create({ model: MODEL, max_tokens: 300, thinking: { type: "disabled" },
      output_config: { effort: EFFORT }, system, messages: [{ role: "user", content: thread }] });
    return clean(r.content.find(b => b.type === "text")?.text || "", lines);
  }
  // Claude Code, one shot, no tools, no session on disk
  return new Promise((res, rej) => {
    // close stdin, or claude waits 3s for piped input on every call
    // no --bare: it ignores the OAuth login, so it can't run on a subscription
    execFile(CLAUDE, ["-p", "--model", MODEL, "--effort", EFFORT, "--tools", "", "--no-session-persistence",
                        "--max-turns", "1", "--strict-mcp-config", "--disable-slash-commands", "--no-chrome",
                        "--system-prompt", system, thread],
      { timeout: 60000, maxBuffer: 1 << 20 }, (err, out) => err ? rej(err) : res(clean(out, lines))).stdin.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// "name: message" lines; a line with no name belongs to whoever is working
const WHO = /^@?(atlas|iris|grond|lumen|sieve|helm)\b\s*[:>\-–]\s*(.+)$/i;
const parse = (lines, owner) => lines.map(l => {
  const m = l.match(WHO);
  return m ? { who: AGENTS.indexOf(m[1].toLowerCase()), text: m[2].trim() } : { who: owner, text: l };
}).filter(e => e.text);

// one line at a time, each strikes its speaker's bell; a new voice takes a beat longer
async function speak(entries) {
  let last = null;
  for (const e of entries) {
    if (last !== null) await sleep(e.who === last ? LINE_MS : LINE_MS * 2 + Math.random() * LINE_MS * 3);
    await untilOnline();
    say(`[${AGENTS[e.who]}] ${e.text}`); ring(e.who); last = e.who;
  }
}

async function sprint(n) {
  state.app = ""; state.items = []; state.look = { ...DEFAULT_LOOK };
  emit({ type: "reset" });
  say(`$ sprint ${n}`);
  let thread = `Sprint ${n}.`;

  // product: name the app and hand out the work
  // its own prompt: the chat format fights the 6-line plan
  const brief = await ask(`You are @atlas, product lead on a team that builds a to-do app, ships it, then rebuilds it from scratch, forever. Plan this sprint. Reply with exactly 6 lines and nothing else: line 1 is a new one-word app name; lines 2 to 6 are one task each for design, backend, frontend, qa, devops, each a 2 to 5 word to-do item with no names or prefixes. Line 1 holds only the name, one invented word like a product name. No markdown, no numbering, no labels, no sprint number.`,
    `${thread} Do not reuse these names: ${[...apps, ...AGENTS].join(", ")}.`, 8);
  // skip any chatter line that slips in; the name is one word
  const plan = brief.filter(l => !l.includes("@"));
  if (/sprint/i.test(plan[0] || "") && /^\w+$/.test(plan[1] || "")) plan.shift();  // "Sprint2plan" label above the name
  const name = (plan[0] || "").replace(/[^\w-]/g, "");
  state.app = name && name.length <= 14 ? name : `todo-${n}`;  // longer is chatter, like "SprintPlanLedger"
  apps.push(state.app); if (apps.length > 12) apps.shift();
  // tasks read like to-do items: drop "1." / "-" / "design:" lead-ins, capitalize
  const task = l => l.replace(/^[-*\d.)\s]+/, "").replace(/^@?(design|backend|frontend|qa|devops|iris|grond|lumen|sieve|helm)\b\s*[:\-–]?\s*/i, "")
                     .replace(/[.;]+$/, "").replace(/^./, c => c.toUpperCase());
  const tasks = ["Write the brief", ...plan.slice(1, 6).map(task)];
  while (tasks.length < 6) tasks.push("Do the work");
  state.items = [...tasks.map(t => ({ t, done: false })), { t: "Rebuild this to-do app", done: false }];
  emit({ type: "items", app: state.app, items: state.items, look: state.look });

  // returns what the worker said, for FAIL / look parsing
  const turn = async (i, extra = "", next = NEXT[AGENTS[i]]) => {
    const reply = ask(SCENE + ` The app is "${state.app}". Now @${AGENTS[i]} (${ROLES[i]}) does: ${tasks[i]}. ${extra} End with @${AGENTS[i]} handing off to @${next}.`, thread, 7);
    const [out] = await Promise.all([reply, gate]);
    let entries = parse(out, i);
    // a FAIL ends the scene; the fix and retest are their own steps
    const fail = entries.findIndex(e => e.who === 4 && /\bFAIL\b/.test(e.text));
    if (i === 4 && fail >= 0) entries = entries.slice(0, fail + 1);
    await speak(entries);
    thread += entries.map(e => `\n@${AGENTS[e.who]}: ${e.text}`).join("");
    return entries.filter(e => e.who === i).map(e => e.text);
  };
  // the pause runs alongside the next agent's request, not before it
  let gate = Promise.resolve();
  const finish = async i => { state.items[i].done = true; emit({ type: "done", i }); gate = sleep(PAUSE_MS); };

  for (let i = 0; i < 6; i++) {
    if (i === 4) {
      // qa: pass or kick back once
      const r = await turn(4, `@sieve tests what @lumen built. If something is wrong, @sieve says FAIL and what, to @lumen. Otherwise @sieve says PASS.`, "helm, or back to @lumen on a FAIL");
      if (/\bFAIL\b/.test(r.join(" "))) {
        await finish(4);
        state.items[3].done = false; emit({ type: "undone", i: 3 });
        await turn(3, `@sieve just failed it. @lumen fixes exactly what @sieve named.`, "sieve");
        await finish(3);
        await turn(4, `@sieve re-tests @lumen's fix and says PASS.`);
      }
      await finish(4);
      continue;
    }
    if (i === 1) {
      const out = await turn(1, `@iris chooses the look and posts it as one line of tokens: font=sans|serif|mono box=circle|square|none align=left|center dense=0|1 rule=1|0 tint=0|1 caps=0|1 big=0|1 ac=#hex bg=#hex (bg must be very light). Recent looks, do not repeat any: ${looks.slice(-4).map(l => Object.entries(l).map(([k,v])=>k+"="+v).join(" ")).join(" | ") || "none"}`);
      state.look = ensureNew(parseLook(out));
      emit({ type: "items", app: state.app, items: state.items, look: state.look });
      await finish(1); continue;
    } else if (i > 0) {
      await turn(i, i === 5 ? "@helm ships it; @helm's last line is the deploy line." : "");
    } else {
      await speak([{ who: 0, text: `${state.app}: ${tasks.slice(1).join("; ")}` }]);
      thread += `\n@atlas: ${state.app}. ` + tasks.slice(1).join("; ");
    }
    await finish(i);
  }

  await gate;
  say(`$ ship ${state.app}`);
  await sleep(PAUSE_MS * 2);
}

(async () => { for (let n = 1; ; n++) { try { await sprint(n); } catch (e) { say(`! ${e.message}`); await sleep(10000); } } })();
