/**
 * Conductor Labs decision server — agentStats rebuilt from Supabase on startup.
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY), PORT (optional)
 */
const http = require("http");
const { createClient } = require("@supabase/supabase-js");

const AGENTS = ["chatgpt", "claude", "gemini", "grok"];

function emptyAgent() {
  return {
    pnl: 0,
    wins: 0,
    total: 0,
    streak: 0,
    streakDir: "W",
    lastAction: "HOLD",
  };
}

const agentStats = Object.fromEntries(AGENTS.map((id) => [id, emptyAgent()]));

let btcPrice = 70_000;
let recentDecisions = [];

function normalizeAgent(raw) {
  if (raw == null) return null;
  const k = String(raw).toLowerCase().trim();
  return AGENTS.includes(k) ? k : null;
}

function isWin(row) {
  const w = row.won;
  if (w === true || w === 1) return true;
  if (w === false || w === 0) return false;
  if (typeof w === "string") {
    const s = w.toLowerCase();
    if (s === "true" || s === "1") return true;
    if (s === "false" || s === "0") return false;
  }
  return false;
}

function rowTime(row) {
  const t =
    row.created_at ??
    row.createdAt ??
    row.time ??
    row.inserted_at ??
    row.updated_at;
  if (t == null) return 0;
  const ms = typeof t === "number" ? t : Date.parse(String(t));
  return Number.isFinite(ms) ? ms : 0;
}

function rowPnl(row) {
  const v = row.pnl;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function rowAction(row) {
  const a = row.action ?? row.lastAction ?? row.side;
  if (typeof a === "string" && a.trim()) return a.toUpperCase();
  return "HOLD";
}

/**
 * Walk newest → oldest; count consecutive results matching the latest `won`.
 */
function streakFromChronological(oldestFirst) {
  if (!oldestFirst.length) return { streak: 0, streakDir: "W" };
  const newest = oldestFirst[oldestFirst.length - 1];
  const target = isWin(newest);
  let streak = 0;
  for (let i = oldestFirst.length - 1; i >= 0; i--) {
    if (isWin(oldestFirst[i]) === target) streak++;
    else break;
  }
  return { streak, streakDir: target ? "W" : "L" };
}

async function fetchAllDecisions(supabase) {
  const pageSize = 1000;
  const all = [];
  let from = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("decisions")
      .select("*")
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw error;
    const chunk = data ?? [];
    all.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

/**
 * Rebuilds in-memory agentStats from the `decisions` table before the decision loop runs.
 */
async function rebuildAgentStatsFromSupabase(supabase) {
  const rows = await fetchAllDecisions(supabase);

  const byAgent = Object.fromEntries(AGENTS.map((id) => [id, []]));
  for (const row of rows) {
    const id = normalizeAgent(row.agent);
    if (id) byAgent[id].push(row);
  }

  for (const id of AGENTS) {
    const list = byAgent[id];
    list.sort((a, b) => rowTime(a) - rowTime(b));

    let wins = 0;
    let pnl = 0;
    for (const r of list) {
      if (isWin(r)) wins++;
      pnl += rowPnl(r);
    }
    const total = list.length;
    const { streak, streakDir } = streakFromChronological(list);
    const lastAction = list.length ? rowAction(list[list.length - 1]) : "HOLD";

    agentStats[id] = {
      pnl,
      wins,
      total,
      streak,
      streakDir,
      lastAction,
    };
  }

  console.log(
    "[startup] agentStats rebuilt from Supabase:",
    JSON.stringify(agentStats),
  );
}

function createServer() {
  return http.createServer((req, res) => {
    if (req.url?.startsWith("/state") && req.method === "GET") {
      const body = JSON.stringify({
        price: btcPrice,
        agents: agentStats,
        recentDecisions,
        updatedAt: new Date().toISOString(),
      });
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end();
  });
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;

  if (supabaseUrl && supabaseKey) {
    const supabase = createClient(supabaseUrl, supabaseKey);
    try {
      await rebuildAgentStatsFromSupabase(supabase);
    } catch (err) {
      console.error("[startup] Failed to rebuild from Supabase:", err);
    }
  } else {
    console.warn(
      "[startup] SUPABASE_URL / key missing — agentStats use defaults until decisions run.",
    );
  }

  const port = Number(process.env.PORT) || 8787;
  createServer().listen(port, () => {
    console.log(`[server] listening on :${port} (GET /state)`);
  });

  // --- First decision loop (placeholder: wire your trading tick here) ---
  // agentStats is already warm from Supabase before this runs.
  setInterval(() => {
    btcPrice = btcPrice * (1 + (Math.random() - 0.5) * 0.0002);
  }, 60_000);
}

if (require.main === module) {
  main();
}

module.exports = {
  rebuildAgentStatsFromSupabase,
  agentStats,
  AGENTS,
};
