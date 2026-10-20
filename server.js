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
const TEAM = `You are one of six agents on a software team that builds a to-do app, ships it, then rebuilds it from scratch, forever. You never comment on this. You read the whole thread. Your first line replies to the person who handed you work, by @name, using something specific they said. Your last line hands off to the next person by @name. Reply as raw terminal output only: 2 to 3 short lines of at most 12 words each, no markdown, no preamble, no quotes. Talk as if the work really happens: report it done in a few plain words. Never mention tools, access, or what you cannot do. Never wait, block, or ask anyone to confirm.`;
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
    // no --bare: it ignores the OAuth login, so it can't run on a subscription
    execFile(CLAUDE, ["-p", "--model", MODEL, "--effort", EFFORT, "--tools", "", "--no-session-persistence",
                        "--max-turns", "1", "--strict-mcp-config", "--disable-slash-commands", "--no-chrome",
                        "--system-prompt", system, thread],
      { timeout: 60000, maxBuffer: 1 << 20 }, (err, out) => err ? rej(err) : res(clean(out, lines)));
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// one line at a time, one bell strike per line
async function speak(i, lines) {
  for (const l of lines) { say(`[${AGENTS[i]}] ${l}`); ring(i); await sleep(LINE_MS); }
}

async function sprint(n) {
  state.app = ""; state.items = []; state.look = { ...DEFAULT_LOOK };
  emit({ type: "reset" });
  say(`$ sprint ${n}`);
  let thread = `Sprint ${n}.`;

  // product: name the app and hand out the work
  // its own prompt: TEAM's reply/handoff rules fight the 6-line plan
  const brief = await ask(`You are @atlas, product lead on a team that builds a to-do app, ships it, then rebuilds it from scratch, forever. Plan this sprint. Reply with exactly 6 lines and nothing else: line 1 is a new one-word app name; lines 2 to 6 are one task each for design, backend, frontend, qa, devops, each a 2 to 5 word to-do item with no names or prefixes. No markdown, no numbering.`,
    `${thread} Do not reuse these names: ${[...apps, ...AGENTS].join(", ")}.`, 8);
  // skip any chatter line that slips in; the name is one word
  const plan = brief.filter(l => !l.includes("@"));
  state.app = (plan[0] || "").replace(/[^\w-]/g, "") || `todo-${n}`;
  apps.push(state.app); if (apps.length > 12) apps.shift();
  // tasks read like to-do items: drop "1." / "-" / "design:" lead-ins, capitalize
  const task = l => l.replace(/^[-*\d.)\s]+/, "").replace(/^@?(design|backend|frontend|qa|devops|iris|grond|lumen|sieve|helm)\b\s*[:\-–]?\s*/i, "")
                     .replace(/[.;]+$/, "").replace(/^./, c => c.toUpperCase());
  const tasks = ["Write the brief", ...plan.slice(1, 6).map(task)];
  while (tasks.length < 6) tasks.push("Do the work");
  state.items = [...tasks.map(t => ({ t, done: false })), { t: "Rebuild this to-do app", done: false }];
  emit({ type: "items", app: state.app, items: state.items, look: state.look });

  const turn = async (i, extra = "") => {
    const reply = ask(TEAM + ` You are @${AGENTS[i]}, ${ROLES[i]}. Next is @${NEXT[AGENTS[i]]}. The app is "${state.app}". Your task: ${tasks[i]}. ${extra}`, thread);
    const [out] = await Promise.all([reply, gate]);
    await speak(i, out);
    thread += `\n@${AGENTS[i]}: ${out.join(" ")}`;
    return out.join(" ");
  };
  // the pause runs alongside the next agent's request, not before it
  let gate = Promise.resolve();
  const finish = async i => { state.items[i].done = true; emit({ type: "done", i }); gate = sleep(PAUSE_MS); };

  for (let i = 0; i < 6; i++) {
    if (i === 4) {
      // qa: pass or kick back once
      const r = await turn(4, `Test what @lumen built. If something is wrong, say FAIL and what, addressed to @lumen. Otherwise say PASS.`);
      if (/\bFAIL\b/.test(r)) {
        await finish(4);
        state.items[3].done = false; emit({ type: "undone", i: 3 });
        await turn(3, `@sieve failed your work. Fix exactly what they named and hand back to @sieve.`);
        await finish(3);
        await turn(4, `Re-test @lumen's fix. Say PASS.`);
      }
      await finish(4);
      continue;
    }
    if (i === 1) {
      const reply = ask(TEAM + ` You are @iris, design. Next is @grond. The app is "${state.app}". Your task: ${tasks[1]}. Choose the look. Reply with one line of tokens, then one short line saying why. Tokens: font=sans|serif|mono box=circle|square|none align=left|center dense=0|1 rule=1|0 tint=0|1 caps=0|1 big=0|1 ac=#hex bg=#hex (bg must be very light). Recent looks, do not repeat any: ${looks.slice(-4).map(l => Object.entries(l).map(([k,v])=>k+"="+v).join(" ")).join(" | ") || "none"}`, thread);
      const [out] = await Promise.all([reply, gate]);
      await speak(1, out);
      thread += `\n@iris: ${out.join(" ")}`;
      state.look = ensureNew(parseLook(out));
      emit({ type: "items", app: state.app, items: state.items, look: state.look });
      await finish(1); continue;
    } else if (i > 0) {
      await turn(i, i === 5 ? "Ship it. Last line is the deploy line." : "Do it and report.");
    } else {
      await speak(0, [`${state.app}: ${tasks.slice(1).join("; ")}`]);
      thread += `\n@atlas: ${state.app}. ` + tasks.slice(1).join("; ");
    }
    await finish(i);
  }

  await gate;
  say(`$ ship ${state.app}`);
  await sleep(PAUSE_MS * 2);
}

(async () => { for (let n = 1; ; n++) { try { await sprint(n); } catch (e) { say(`! ${e.message}`); await sleep(10000); } } })();
