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
  if (yesProb > 0.6) return { prediction: "YES" };
  if (yesProb < 0.4) return { prediction: "NO" };
  return { prediction: "UNCERTAIN" };
}

function claudeStrategy(yesProb) {
  if (yesProb > 0.65) return { prediction: "NO" };
  if (yesProb < 0.35) return { prediction: "YES" };
  if (yesProb >= 0.5) return { prediction: "YES" };
  return { prediction: "NO" };
}

function geminiStrategy(marketId, currentYes) {
  const prev = polymarketPreviousYes.get(marketId);
  polymarketPreviousYes.set(marketId, currentYes);
  if (prev == null) return { prediction: "UNCERTAIN" };
  const eps = 0.004;
  const delta = currentYes - prev;
  if (delta > eps) return { prediction: "YES" };
  if (delta < -eps) return { prediction: "NO" };
  return { prediction: "UNCERTAIN" };
}

function grokStrategy(yesProb) {
  const u = Math.random();
  if (u < 0.07) return { prediction: "UNCERTAIN" };
  const biased = Math.random() < yesProb * 0.88 + 0.06;
  if (biased) return { prediction: "YES" };
  return { prediction: "NO" };
}

/** YES odds in 0–100 (same scale as market display). */
function confidenceChatgpt(yesOddsPct) {
  return Math.max(0, Math.min(100, Math.round(Math.abs(yesOddsPct - 50) + 50)));
}

/** Inverted: higher confidence when the crowd is split (contrarian framing). */
function confidenceClaude(yesOddsPct) {
  const base = Math.abs(yesOddsPct - 50) + 50;
  return Math.max(0, Math.min(100, Math.round(100 - base)));
}

function confidenceGemini() {
  return Math.round(55 + Math.random() * 30);
}

function confidenceGrok() {
  return Math.round(40 + Math.random() * 50);
}

function reasoningChatgpt(yesOddsPct) {
  const x = Math.round(yesOddsPct);
  return `Following market consensus at ${x}% YES`;
}

function reasoningClaude(yesOddsPct) {
  const x = Math.round(yesOddsPct);
  return `Fading crowd consensus — contrarian signal at ${x}%`;
}

function reasoningGemini(prediction) {
  return `Momentum signal suggests ${prediction}`;
}

function reasoningGrok(prediction) {
  return `Instinct play — going with ${prediction}`;
}

async function fetchPolymarketMarkets() {
  const res = await fetch(POLYMARKET_GAMMA_LIST);
  if (!res.ok) throw new Error(`Polymarket list ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data.slice(0, 5) : [];
}

async function insertPolymarketPredictions(supabase, market, rows) {
  const marketId = String(market.id);
  const { data: openRows, error: openErr } = await supabase
    .from("polymarket_predictions")
    .select("agent_id")
    .eq("market_id", marketId)
    .eq("resolved", false);
  if (openErr) {
    console.error("[polymarket] dedup fetch error:", openErr);
    return;
  }
  const existingAgents = new Set((openRows ?? []).map((r) => r.agent_id));
  const pending = rows.filter((r) => !existingAgents.has(r.agent_id));
  if (!pending.length) return;

  const payload = pending.map((r) => ({
    id: crypto.randomUUID(),
    market_id: marketId,
    question: market.question,
    agent_id: r.agent_id,
    prediction: r.prediction,
    confidence: r.confidence,
    reasoning: r.reasoning,
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
    const markets = await fetchPolymarketMarkets();
    for (const market of markets) {
      const yesProb = yesProbability(market);
      const oddsPct = marketOddsPercent(yesProb);
      const mid = String(market.id);

      const cg = chatgptStrategy(yesProb);
      const cl = claudeStrategy(yesProb);
      const g = geminiStrategy(mid, yesProb);
      const gr = grokStrategy(yesProb);
      const rows = [
        {
          agent_id: "chatgpt",
          ...cg,
          confidence: confidenceChatgpt(oddsPct),
          reasoning: reasoningChatgpt(oddsPct),
          market_odds_at_prediction: oddsPct,
        },
        {
          agent_id: "claude",
          ...cl,
          confidence: confidenceClaude(oddsPct),
          reasoning: reasoningClaude(oddsPct),
          market_odds_at_prediction: oddsPct,
        },
        {
          agent_id: "gemini",
          ...g,
          confidence: confidenceGemini(),
          reasoning: reasoningGemini(g.prediction),
          market_odds_at_prediction: oddsPct,
        },
        {
          agent_id: "grok",
          ...gr,
          confidence: confidenceGrok(),
          reasoning: reasoningGrok(gr.prediction),
          market_odds_at_prediction: oddsPct,
        },
      ];
      await insertPolymarketPredictions(supabase, market, rows);
    }
  } catch (e) {
    console.error("[polymarket] prediction cycle failed:", e);
  }
}

const RESOLVED_PRICE_EPS = 0.02;

function inferResolvedOutcome(market) {
  const [y, n] = parseOutcomePrices(market);
  if (y >= 1 - RESOLVED_PRICE_EPS && n <= RESOLVED_PRICE_EPS) return "YES";
  if (n >= 1 - RESOLVED_PRICE_EPS && y <= RESOLVED_PRICE_EPS) return "NO";
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
      if (m.active !== false || m.closed !== true) continue;
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
    const marketsRaw = await fetchPolymarketMarkets();
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
    const emptyAgentPoly = () => ({
      agentStats: Object.fromEntries(
        POLYMARKET_AGENT_IDS.map((id) => [
          id,
          { totalPredictions: 0, correctPredictions: 0, winRate: 0 },
        ]),
      ),
      legacy: Object.fromEntries(
        POLYMARKET_AGENT_IDS.map((id) => [
          id,
          { totalPredictions: 0, wins: 0, winRate: 0 },
        ]),
      ),
      recentResolutions: [],
    });
    let polyBundle = emptyAgentPoly();
    let recentPredictions = [];

    function shapePredictionRow(p) {
      if (!p) return null;
      return {
        prediction: p.prediction,
        confidence:
          typeof p.confidence === "number" && Number.isFinite(p.confidence)
            ? p.confidence
            : null,
        reasoning:
          typeof p.reasoning === "string" && p.reasoning.trim()
            ? p.reasoning
            : null,
      };
    }

    if (supabase) {
      const { data: allPreds } = await supabase
        .from("polymarket_predictions")
        .select("agent_id, won, resolved");

      const agentStats = {};
      const legacy = {};
      for (const aid of POLYMARKET_AGENT_IDS) {
        const rows = (allPreds ?? []).filter((r) => r.agent_id === aid);
        const totalPredictions = rows.length;
        const resolved = rows.filter((r) => r.resolved === true);
        const scored = resolved.filter(
          (r) => r.won === true || r.won === false,
        );
        const correctPredictions = scored.filter((r) => r.won === true).length;
        const winRate = scored.length
          ? Math.round((correctPredictions / scored.length) * 10_000) / 100
          : 0;
        agentStats[aid] = {
          totalPredictions,
          correctPredictions,
          winRate,
        };
        legacy[aid] = {
          totalPredictions,
          wins: correctPredictions,
          winRate,
        };
      }

      const { data: resolvedRows } = await supabase
        .from("polymarket_predictions")
        .select("*")
        .eq("resolved", true);

      const sortedRes = (resolvedRows ?? [])
        .map((r) => ({
          ...r,
          _ts:
            Date.parse(r.updated_at ?? r.created_at ?? r.inserted_at ?? "") ||
            0,
        }))
        .sort((a, b) => b._ts - a._ts)
        .slice(0, 10)
        .map(({ question, agent_id, prediction, outcome, won }) => ({
          question,
          agent: agent_id,
          prediction,
          outcome,
          won,
        }));

      polyBundle = {
        agentStats,
        legacy,
        recentResolutions: sortedRes,
      };

      if (marketIds.length) {
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
            predictionsByMarket[mid][aid] = shapePredictionRow(
              latest.get(`${mid}:${aid}`),
            );
          }
        }
      }

      const { data: recent } = await supabase
        .from("polymarket_predictions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      recentPredictions = recent ?? [];
    }

    const marketsOut = markets.map((m) => ({
      ...m,
      predictions: predictionsByMarket[m.id] ?? {},
    }));

    send(200, {
      markets: marketsOut,
      agentStats: polyBundle.agentStats,
      agentPolymarketStats: polyBundle.legacy,
      recentPredictions,
      recentResolutions: polyBundle.recentResolutions,
      updatedAt: new Date().toISOString(),
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
    // Run once on startup (fetchPolymarketMarkets + inserts); do not wait 6h for first run.
    try {
      await runPolymarketPredictionCycle(supabase);
    } catch (e) {
      console.error("[polymarket] initial cycle:", e);
    }
    resolvePolymarketPredictions(supabase).catch((e) =>
      console.error("[polymarket] initial resolve:", e),
    );
    setInterval(() => {
      runPolymarketPredictionCycle(supabase).catch((e) =>
        console.error("[polymarket] scheduled cycle:", e),
      );
    }, 6 * 60 * 60 * 1000);
    setInterval(() => {
      resolvePolymarketPredictions(supabase);
    }, 30 * 60 * 1000);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  rebuildAgentStatsFromSupabase,
  agentStats,
  AGENTS,
  fetchPolymarketMarkets,
  runPolymarketPredictionCycle,
  resolvePolymarketPredictions,
};
