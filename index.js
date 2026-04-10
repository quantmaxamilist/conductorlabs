/**
 * Conductor Labs decision server — agentStats rebuilt from Supabase on startup.
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY), PORT (optional)
 */
const http = require("http");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const AGENTS = ["chatgpt", "claude", "gemini", "grok"];

const POLYMARKET_GAMMA_LIST =
  "https://gamma-api.polymarket.com/markets?active=true&limit=5&order=volume&ascending=false";

const POLYMARKET_AGENT_IDS = ["chatgpt", "claude", "gemini", "grok"];

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

/** Previous YES probability per Polymarket `market_id` (for Gemini momentum). */
const polymarketPreviousYes = new Map();

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

// --- Polymarket ---

function parseOutcomePrices(market) {
  const raw = market?.outcomePrices;
  if (raw == null) return [0.5, 0.5];
  try {
    const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
    const y = Number.parseFloat(arr[0]);
    const n = Number.parseFloat(arr[1]);
    return [
      Number.isFinite(y) ? y : 0.5,
      Number.isFinite(n) ? n : 0.5,
    ];
  } catch {
    return [0.5, 0.5];
  }
}

function yesProbability(market) {
  return parseOutcomePrices(market)[0];
}

function marketOddsPercent(yesProb) {
  return Math.round(yesProb * 10_000) / 100;
}

function chatgptStrategy(yesProb) {
  if (yesProb > 0.6)
    return {
      prediction: "YES",
      confidence: Math.min(100, Math.round((yesProb - 0.5) * 200)),
    };
  if (yesProb < 0.4)
    return {
      prediction: "NO",
      confidence: Math.min(100, Math.round((0.5 - yesProb) * 200)),
    };
  return {
    prediction: "UNCERTAIN",
    confidence: Math.max(
      0,
      Math.min(100, Math.round(50 - Math.abs(yesProb - 0.5) * 100)),
    ),
  };
}

function claudeStrategy(yesProb) {
  if (yesProb > 0.65)
    return {
      prediction: "NO",
      confidence: Math.min(100, Math.round((yesProb - 0.5) * 200)),
    };
  if (yesProb < 0.35)
    return {
      prediction: "YES",
      confidence: Math.min(100, Math.round((0.5 - yesProb) * 200)),
    };
  if (yesProb >= 0.5)
    return {
      prediction: "YES",
      confidence: Math.round(Math.abs(yesProb - 0.5) * 180 + 20),
    };
  return {
    prediction: "NO",
    confidence: Math.round(Math.abs(yesProb - 0.5) * 180 + 20),
  };
}

function geminiStrategy(marketId, currentYes) {
  const prev = polymarketPreviousYes.get(marketId);
  polymarketPreviousYes.set(marketId, currentYes);
  if (prev == null)
    return { prediction: "UNCERTAIN", confidence: 40 };
  const eps = 0.004;
  const delta = currentYes - prev;
  if (delta > eps)
    return {
      prediction: "YES",
      confidence: Math.min(100, Math.round(55 + delta * 200)),
    };
  if (delta < -eps)
    return {
      prediction: "NO",
      confidence: Math.min(100, Math.round(55 - delta * 200)),
    };
  return { prediction: "UNCERTAIN", confidence: 45 };
}

function grokStrategy(yesProb) {
  const u = Math.random();
  if (u < 0.07)
    return {
      prediction: "UNCERTAIN",
      confidence: Math.round(25 + Math.random() * 35),
    };
  const biased = Math.random() < yesProb * 0.88 + 0.06;
  if (biased)
    return {
      prediction: "YES",
      confidence: Math.round(45 + Math.random() * 45),
    };
  return {
    prediction: "NO",
    confidence: Math.round(45 + Math.random() * 45),
  };
}

async function fetchTopPolymarketMarkets() {
  const res = await fetch(POLYMARKET_GAMMA_LIST);
  if (!res.ok) throw new Error(`Polymarket list ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data.slice(0, 5) : [];
}

async function insertPolymarketPredictions(supabase, market, rows) {
  const payload = rows.map((r) => ({
    id: crypto.randomUUID(),
    market_id: String(market.id),
    question: market.question,
    agent_id: r.agent_id,
    prediction: r.prediction,
    confidence: r.confidence,
    market_odds_at_prediction: r.market_odds_at_prediction,
    resolved: false,
    outcome: null,
    won: null,
  }));
  const { error } = await supabase.from("polymarket_predictions").insert(payload);
  if (error) console.error("[polymarket] insert error:", error);
  else
    console.log(
      `[polymarket] logged ${payload.length} predictions for market ${market.id}`,
    );
}

async function runPolymarketPredictionCycle(supabase) {
  if (!supabase) return;
  try {
    const markets = await fetchTopPolymarketMarkets();
    for (const market of markets) {
      const yesProb = yesProbability(market);
      const oddsPct = marketOddsPercent(yesProb);
      const mid = String(market.id);

      const g = geminiStrategy(mid, yesProb);
      const rows = [
        {
          agent_id: "chatgpt",
          ...chatgptStrategy(yesProb),
          market_odds_at_prediction: oddsPct,
        },
        {
          agent_id: "claude",
          ...claudeStrategy(yesProb),
          market_odds_at_prediction: oddsPct,
        },
        { agent_id: "gemini", ...g, market_odds_at_prediction: oddsPct },
        {
          agent_id: "grok",
          ...grokStrategy(yesProb),
          market_odds_at_prediction: oddsPct,
        },
      ];
      await insertPolymarketPredictions(supabase, market, rows);
    }
  } catch (e) {
    console.error("[polymarket] prediction cycle failed:", e);
  }
}

function inferResolvedOutcome(market) {
  if (!market.closed) return null;
  const [y, n] = parseOutcomePrices(market);
  if (y >= 0.98 && n <= 0.05) return "YES";
  if (n >= 0.98 && y <= 0.05) return "NO";
  if (market.outcome != null && String(market.outcome).trim() !== "") {
    const o = String(market.outcome).toLowerCase();
    if (o === "yes" || o.includes("yes")) return "YES";
    if (o === "no" || o.includes("no")) return "NO";
  }
  return null;
}

async function resolvePolymarketPredictions(supabase) {
  if (!supabase) return;
  try {
    const { data: openRows, error } = await supabase
      .from("polymarket_predictions")
      .select("id, market_id, prediction")
      .eq("resolved", false);
    if (error) {
      console.error("[polymarket] resolve fetch error:", error);
      return;
    }
    const byMarket = new Map();
    for (const r of openRows ?? []) {
      const mid = r.market_id;
      if (!byMarket.has(mid)) byMarket.set(mid, []);
      byMarket.get(mid).push(r);
    }
    for (const [marketId, preds] of byMarket) {
      const res = await fetch(
        `https://gamma-api.polymarket.com/markets/${encodeURIComponent(marketId)}`,
      );
      if (!res.ok) continue;
      const m = await res.json();
      if (!m.closed) continue;
      const outcome = inferResolvedOutcome(m);
      if (!outcome) continue;
      for (const row of preds) {
        const won =
          row.prediction === "UNCERTAIN"
            ? null
            : row.prediction === outcome;
        const { error: upErr } = await supabase
          .from("polymarket_predictions")
          .update({
            resolved: true,
            outcome,
            won,
          })
          .eq("id", row.id);
        if (upErr)
          console.error("[polymarket] resolve update error:", upErr);
      }
    }
  } catch (e) {
    console.error("[polymarket] resolve cycle failed:", e);
  }
}

async function handlePolymarketGet(res, supabase) {
  const send = (code, obj) => {
    res.writeHead(code, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify(obj));
  };

  try {
    const marketsRaw = await fetchTopPolymarketMarkets();
    const markets = marketsRaw.map((m) => {
      const y = yesProbability(m);
      return {
        id: String(m.id),
        question: m.question,
        yesOdds: marketOddsPercent(y),
      };
    });
    const marketIds = markets.map((m) => m.id);

    let predictionsByMarket = {};
    let agentPolyStats = {};
    let recentPredictions = [];

    if (supabase && marketIds.length) {
      const { data: predsForMarkets } = await supabase
        .from("polymarket_predictions")
        .select("*")
        .in("market_id", marketIds)
        .order("created_at", { ascending: false });

      const latest = new Map();
      for (const p of predsForMarkets ?? []) {
        const key = `${p.market_id}:${p.agent_id}`;
        if (!latest.has(key)) latest.set(key, p);
      }
      predictionsByMarket = {};
      for (const mid of marketIds) {
        predictionsByMarket[mid] = {};
        for (const aid of POLYMARKET_AGENT_IDS) {
          predictionsByMarket[mid][aid] = latest.get(`${mid}:${aid}`) ?? null;
        }
      }

      const { data: allPreds } = await supabase
        .from("polymarket_predictions")
        .select("agent_id, won, resolved");

      for (const aid of POLYMARKET_AGENT_IDS) {
        const rows = (allPreds ?? []).filter((r) => r.agent_id === aid);
        const totalPredictions = rows.length;
        const resolved = rows.filter((r) => r.resolved === true);
        const scored = resolved.filter((r) => r.won === true || r.won === false);
        const wins = scored.filter((r) => r.won === true).length;
        agentPolyStats[aid] = {
          totalPredictions,
          wins,
          winRate: scored.length
            ? Math.round((wins / scored.length) * 10_000) / 100
            : 0,
        };
      }

      const { data: recent } = await supabase
        .from("polymarket_predictions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      recentPredictions = recent ?? [];
    } else {
      for (const aid of POLYMARKET_AGENT_IDS) {
        agentPolyStats[aid] = {
          totalPredictions: 0,
          wins: 0,
          winRate: 0,
        };
      }
    }

    const marketsOut = markets.map((m) => ({
      ...m,
      predictions: predictionsByMarket[m.id] ?? {},
    }));

    send(200, {
      markets: marketsOut,
      agentPolymarketStats: agentPolyStats,
      recentPredictions,
    });
  } catch (e) {
    console.error("[polymarket] GET /polymarket:", e);
    send(500, { error: "polymarket_endpoint_failed" });
  }
}

function createServer(supabase) {
  return http.createServer((req, res) => {
    const path = (req.url || "/").split("?")[0];

    if (path === "/state" && req.method === "GET") {
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

    if (path === "/polymarket" && req.method === "GET") {
      handlePolymarketGet(res, supabase);
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

  let supabase = null;
  if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
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
  createServer(supabase).listen(port, () => {
    console.log(
      `[server] listening on :${port} (GET /state, GET /polymarket)`,
    );
  });

  // --- First decision loop (placeholder: wire your trading tick here) ---
  // agentStats is already warm from Supabase before this runs.
  setInterval(() => {
    btcPrice = btcPrice * (1 + (Math.random() - 0.5) * 0.0002);
  }, 60_000);

  if (supabase) {
    runPolymarketPredictionCycle(supabase).catch((e) =>
      console.error("[polymarket] initial cycle:", e),
    );
    setInterval(() => {
      runPolymarketPredictionCycle(supabase);
    }, 6 * 60 * 60 * 1000);
    setInterval(() => {
      resolvePolymarketPredictions(supabase);
    }, 60 * 60 * 1000);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  rebuildAgentStatsFromSupabase,
  agentStats,
  AGENTS,
  runPolymarketPredictionCycle,
  resolvePolymarketPredictions,
};
