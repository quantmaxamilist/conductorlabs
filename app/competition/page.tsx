"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { AuthButton, HeaderPointsPill } from "@/components/AuthButton";
import { AuthModal } from "@/components/AuthModal";
import { useAuth } from "@/components/auth-provider";
import { supabase } from "@/lib/supabase";
import {
  type AgentKey,
  type AgentApiState,
  type CompetitionApiResponse,
  useCompetitionState,
} from "./competition-provider";

const AGENTS: {
  id: AgentKey;
  name: string;
  color: string;
}[] = [
  { id: "chatgpt", name: "ChatGPT", color: "#10a37f" },
  { id: "claude", name: "Claude", color: "#cc785c" },
  { id: "gemini", name: "Gemini", color: "#4285f4" },
  { id: "grok", name: "Grok", color: "#888888" },
];

const AGENT_STRATEGY_BLURB: Record<AgentKey, string> = {
  chatgpt:
    "Momentum: buying when price rises above 5-min average",
  claude:
    "Mean reversion: fading sharp moves after RSI extremes",
  gemini:
    "Breakout scout: scales in on volume-confirmed thrusts",
  grok:
    "Volatility sleeve: rotates on ATR spikes and stall patterns",
};

type GuideStrategy = "long" | "wait" | "short" | "hold";

const GUIDE_STRATEGY_ORDER: GuideStrategy[] = ["long", "wait", "short", "hold"];

const GUIDE_STRATEGY_META: Record<
  GuideStrategy,
  { label: string; bar: string }
> = {
  long: { label: "Enter long", bar: "Long" },
  wait: { label: "Stay out", bar: "Wait" },
  short: { label: "Go short", bar: "Short" },
  hold: { label: "Hold position", bar: "Hold" },
};

/** Base book shown on cards; API `pnl` is added on top. */
const STARTING_POOL_GBP: Record<AgentKey, number> = {
  chatgpt: 122_000,
  claude: 118_500,
  gemini: 120_800,
  grok: 116_900,
};

/** Round / decision countdown length (5 minutes). */
const TOTAL_SECONDS = 300;

function formatCountdownMSS(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type TabId = "vote" | "outcomes" | "feed" | "leaderboard";

type RankToast = { id: string; name: string; from: number; to: number };

function formatGbp(n: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatBtc(price: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(price);
}

function totalBookGbp(id: AgentKey, apiPnl: number) {
  return STARTING_POOL_GBP[id] + apiPnl;
}

function formatUsdInt(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function pickStr(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return undefined;
}

function pickNum(o: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const p = Number.parseFloat(v);
      if (Number.isFinite(p)) return p;
    }
  }
  return undefined;
}

function parseDecisionTimeMs(o: Record<string, unknown>): number | null {
  const keys = ["timestamp", "ts", "createdAt", "updatedAt", "time"];
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      if (v > 1e12) return v;
      if (v > 1e9) return v * 1000;
      return v;
    }
    if (typeof v === "string") {
      const t = Date.parse(v);
      if (!Number.isNaN(t)) return t;
    }
  }
  return null;
}

function agentNameFromDecision(o: Record<string, unknown>): string {
  const raw =
    pickStr(o, ["agent", "agentId", "model", "name", "who", "agentName"]) ??
    "";
  const v = raw.toLowerCase();
  const idMap: Record<string, string> = {
    chatgpt: "ChatGPT",
    claude: "Claude",
    gemini: "Gemini",
    grok: "Grok",
  };
  if (idMap[v]) return idMap[v];
  const byId = AGENTS.find((a) => a.id === v);
  if (byId) return byId.name;
  if (raw.length) return raw.charAt(0).toUpperCase() + raw.slice(1);
  return "Agent";
}

function actionFromDecision(o: Record<string, unknown>): string {
  const a =
    pickStr(o, ["action", "lastAction", "decision", "side", "type"]) ?? "HOLD";
  return a.toUpperCase();
}

function formatMinutesAgo(tsMs: number | null): string {
  if (tsMs == null) return "just now";
  const sec = Math.max(0, Math.floor((Date.now() - tsMs) / 1000));
  if (sec < 45) return "just now";
  const mins = Math.floor(sec / 60);
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
}

function formatDecisionFeedLine(
  row: unknown,
  fallbackPrice: number,
): string | null {
  if (row == null) return null;
  if (typeof row === "string") {
    try {
      return formatDecisionFeedLine(JSON.parse(row) as unknown, fallbackPrice);
    } catch {
      return row.length > 0 ? row : null;
    }
  }
  if (typeof row !== "object") return String(row);
  const o = row as Record<string, unknown>;
  const agent = agentNameFromDecision(o);
  const action = actionFromDecision(o);
  const price =
    pickNum(o, ["price", "btcPrice", "priceUsd", "btc", "spot"]) ??
    fallbackPrice;
  const when = parseDecisionTimeMs(o);
  const rel = formatMinutesAgo(when);
  return `${agent} → ${action} @ ${formatUsdInt(price)} · ${rel}`;
}

/** Demo feed lines when /state has no recentDecisions yet. */
function buildSimulatedFeedRows(fallbackPrice: number) {
  const now = Date.now();
  const steps: { agent: AgentKey; action: string; msAgo: number; skew: number }[] =
    [
      { agent: "grok", action: "SELL", msAgo: 58_000, skew: -0.00008 },
      { agent: "gemini", action: "HOLD", msAgo: 57_000, skew: 0 },
      { agent: "claude", action: "HOLD", msAgo: 56_000, skew: 0 },
      { agent: "chatgpt", action: "BUY", msAgo: 55_000, skew: 0.00006 },
      { agent: "chatgpt", action: "BUY", msAgo: 118_000, skew: 0.00012 },
      { agent: "claude", action: "HOLD", msAgo: 119_000, skew: 0.00012 },
      { agent: "gemini", action: "HOLD", msAgo: 180_000, skew: -0.00004 },
      { agent: "grok", action: "BUY", msAgo: 245_000, skew: 0.0001 },
    ];
  return steps.map((s, i) => {
    const p = Math.round(fallbackPrice * (1 + s.skew) * 100) / 100;
    const row = {
      agent: s.agent,
      action: s.action,
      price: String(p),
      time: new Date(now - s.msAgo).toISOString(),
    };
    const text =
      formatDecisionFeedLine(row, fallbackPrice) ??
      `${agentNameFromDecision(row as Record<string, unknown>)} → ${s.action} @ ${formatUsdInt(p)} · demo`;
    return { key: `sim-${i}`, text };
  });
}

function formatStreakLabel(api: AgentApiState): string {
  if (api.streak <= 0) return "—";
  const d = String(api.streakDir).toUpperCase();
  return d === "L" ? `${api.streak}L` : `${api.streak}W`;
}

function lastMoveOutcomePhrase(api: AgentApiState): string {
  if (api.total === 0) return "evaluating";
  const d = String(api.streakDir).toUpperCase();
  if (d === "W" && api.streak >= 2) return "in the green";
  if (d === "L" && api.streak >= 2) return "under pressure";
  return "evaluating";
}

function formatLastMoveLine(api: AgentApiState, priceUsd: number): string {
  const act = String(api.lastAction || "HOLD").toUpperCase();
  const px = formatUsdInt(priceUsd);
  const tail = lastMoveOutcomePhrase(api);
  if (act === "BUY") return `BUY @ ${px} — ${tail}`;
  if (act === "SELL") return `SELL @ ${px} — ${tail}`;
  return `HOLD @ ${px} — ${tail}`;
}

function formatBtc5mConditionLine(pct: number): string {
  const dir = pct >= 0 ? "up" : "down";
  const abs = Math.abs(pct).toFixed(1);
  let tail = "two-way flow";
  if (pct > 0.8) tail = "momentum building";
  else if (pct > 0.2) tail = "bias higher";
  else if (pct < -0.8) tail = "selling pressure";
  else if (pct < -0.2) tail = "fade in play";
  return `BTC ${dir} ${abs}% in last 5 mins — ${tail}`;
}

function leaderNextThought(
  leaderName: string,
  pct5m: number,
  priceUsd: number,
): string {
  const px = formatUsdInt(priceUsd);
  const s = pct5m >= 0 ? "+" : "";
  if (pct5m > 0.35) {
    return `${leaderName} is weighing a momentum long — BTC ${s}${pct5m.toFixed(1)}% over 5m near ${px}.`;
  }
  if (pct5m < -0.35) {
    return `${leaderName} is watching for a counter-trend — BTC ${pct5m.toFixed(1)}% over 5m at ${px}.`;
  }
  return `${leaderName} is balancing chop — flat 5m drift (${s}${pct5m.toFixed(1)}%) around ${px}.`;
}

function initialGuideCrowdForAgent(id: AgentKey): Record<GuideStrategy, number> {
  const seed =
    id.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 17;
  return {
    long: 22 + (seed % 14),
    wait: 18 + ((seed * 3) % 12),
    short: 16 + ((seed * 5) % 10),
    hold: 12 + ((seed * 7) % 9),
  };
}

function guideCrowdPercents(
  t: Record<GuideStrategy, number>,
): Record<GuideStrategy, number> {
  const tot = t.long + t.wait + t.short + t.hold;
  if (tot <= 0) return { long: 25, wait: 25, short: 25, hold: 25 };
  const p = {
    long: Math.round((t.long / tot) * 100),
    wait: Math.round((t.wait / tot) * 100),
    short: Math.round((t.short / tot) * 100),
    hold: Math.round((t.hold / tot) * 100),
  };
  const diff = 100 - (p.long + p.wait + p.short + p.hold);
  if (diff !== 0) {
    const maxK = GUIDE_STRATEGY_ORDER.reduce((a, b) => (p[a] >= p[b] ? a : b));
    p[maxK] += diff;
  }
  return p;
}

export default function CompetitionPage() {
  const router = useRouter();
  const { data } = useCompetitionState();
  const { awardVotePoints } = useAuth();
  const [watchers, setWatchers] = useState(18420);
  const [secondsLeft, setSecondsLeft] = useState(TOTAL_SECONDS);
  const [roundPulse, setRoundPulse] = useState(false);
  const [guideSignalFlash, setGuideSignalFlash] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("vote");
  const [backedId, setBackedId] = useState<AgentKey | null>(null);
  const [toasts, setToasts] = useState<RankToast[]>([]);
  const [priceTrail, setPriceTrail] = useState<{ t: number; p: number }[]>([]);
  const [guideCrowdByAgent, setGuideCrowdByAgent] = useState<
    Record<AgentKey, Record<GuideStrategy, number>>
  >(() => {
    const init = {} as Record<AgentKey, Record<GuideStrategy, number>>;
    for (const a of AGENTS) init[a.id] = initialGuideCrowdForAgent(a.id);
    return init;
  });
  const [guidePickByAgent, setGuidePickByAgent] = useState<
    Record<AgentKey, GuideStrategy | null>
  >({
    chatgpt: null,
    claude: null,
    gemini: null,
    grok: null,
  });
  const [guideDraftByAgent, setGuideDraftByAgent] = useState<
    Record<AgentKey, string>
  >({
    chatgpt: "",
    claude: "",
    gemini: "",
    grok: "",
  });
  const startPnlRef = useRef<Record<AgentKey, number> | null>(null);
  const prevRanksRef = useRef<Record<AgentKey, number> | null>(null);
  const lastRankToastAt = useRef<Partial<Record<AgentKey, number>>>({});
  const prevSecondsRef = useRef(secondsLeft);

  useEffect(() => {
    const now = Date.now();
    setPriceTrail((prev) => {
      const kept = prev.filter((x) => now - x.t <= 5 * 60 * 1000);
      const last = kept[kept.length - 1];
      if (last && last.p === data.price && now - last.t < 1500) return kept;
      return [...kept, { t: now, p: data.price }];
    });
  }, [data.price]);

  useEffect(() => {
    const prev = prevSecondsRef.current;
    if (prev === 1 && secondsLeft === TOTAL_SECONDS) {
      setGuideSignalFlash(true);
      window.setTimeout(() => setGuideSignalFlash(false), 2500);
    }
    prevSecondsRef.current = secondsLeft;
  }, [secondsLeft]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setWatchers((w) => w + Math.floor(Math.random() * 3) + 1);
    }, 2000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          setRoundPulse(true);
          window.setTimeout(() => setRoundPulse(false), 600);
          return TOTAL_SECONDS;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const sortedAgents = useMemo(() => {
    return AGENTS.map((meta) => {
      const a = data.agents[meta.id];
      return { meta, api: a };
    }).sort((x, y) => y.api.pnl - x.api.pnl);
  }, [data.agents]);

  const rankById = useMemo(() => {
    const m = {} as Record<AgentKey, number>;
    sortedAgents.forEach((row, i) => {
      m[row.meta.id] = i + 1;
    });
    return m;
  }, [sortedAgents]);

  useEffect(() => {
    if (!startPnlRef.current) {
      const init: Record<AgentKey, number> = {} as Record<AgentKey, number>;
      AGENTS.forEach(({ id }) => {
        init[id] = data.agents[id].pnl;
      });
      startPnlRef.current = init;
    }
  }, [data.agents]);

  useEffect(() => {
    const ranks: Record<AgentKey, number> = {} as Record<AgentKey, number>;
    sortedAgents.forEach((row, idx) => {
      ranks[row.meta.id] = idx + 1;
    });
    const prev = prevRanksRef.current;
    prevRanksRef.current = ranks;
    if (!prev) return;

    const now = Date.now();
    sortedAgents.forEach((row) => {
      const id = row.meta.id;
      const oldR = prev[id];
      const newR = ranks[id];
      if (oldR !== undefined && newR < oldR) {
        const last = lastRankToastAt.current[id] ?? 0;
        if (now - last < 10_000) return;
        lastRankToastAt.current[id] = now;
        const toast: RankToast = {
          id: `${id}-${now}`,
          name: row.meta.name,
          from: oldR,
          to: newR,
        };
        setToasts((t) => [...t.slice(-4), toast]);
        window.setTimeout(() => {
          setToasts((t) => t.filter((x) => x.id !== toast.id));
        }, 3200);
      }
    });
  }, [sortedAgents]);

  const progress = (secondsLeft / TOTAL_SECONDS) * 100;
  const urgent = secondsLeft <= 10;

  const btc5mPct = useMemo(() => {
    if (priceTrail.length < 2) return 0;
    const first = priceTrail[0];
    const last = priceTrail[priceTrail.length - 1];
    if (first.p <= 0) return 0;
    return ((last.p - first.p) / first.p) * 100;
  }, [priceTrail]);

  const marketConditionLine = useMemo(
    () => formatBtc5mConditionLine(btc5mPct),
    [btc5mPct],
  );

  const totalDecisions = useMemo(() => {
    const fromApi = Array.isArray(data.recentDecisions)
      ? data.recentDecisions.length
      : 0;
    const fromAgents = AGENTS.reduce(
      (acc, { id }) => acc + data.agents[id].total,
      0,
    );
    return Math.max(fromApi, fromAgents, 1204);
  }, [data.recentDecisions, data.agents]);

  const crowdAccuracy = useMemo(() => {
    const wins = AGENTS.reduce((acc, { id }) => acc + data.agents[id].wins, 0);
    const total = AGENTS.reduce((acc, { id }) => acc + data.agents[id].total, 0);
    if (total <= 0) return 62;
    return Math.min(99, Math.round((wins / total) * 100));
  }, [data.agents]);

  const dismissToast = useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const backedMeta = useMemo(
    () => (backedId ? AGENTS.find((a) => a.id === backedId) : null),
    [backedId],
  );

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col px-3 pb-28 pt-3 sm:px-4">
      {/* Top bar */}
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-red-400 ring-1 ring-red-500/40">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>
            Live
          </span>
          <span className="rounded-md bg-zinc-800/80 px-2 py-1 text-xs text-zinc-300">
            Day 3 of 7
          </span>
          <span className="rounded-md bg-zinc-800/80 px-2 py-1 text-xs tabular-nums text-zinc-300">
            {watchers.toLocaleString()} watching
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-300 ring-1 ring-amber-500/25">
            BTC {formatBtc(data.price)}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <AuthButton variant="compact" />
          <HeaderPointsPill />
        </div>
      </header>

      {/* Round timer */}
      <section
        className={`mb-5 rounded-xl border border-zinc-800 bg-[#111] p-3 transition-shadow ${roundPulse ? "shadow-[0_0_0_2px_rgba(250,204,21,0.35)]" : ""}`}
      >
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium text-zinc-200">Round timer</span>
          <span
            className={`tabular-nums font-mono text-lg font-semibold ${urgent ? "text-red-400" : "text-zinc-100"}`}
          >
            {formatCountdownMSS(secondsLeft)}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
          <div
            className={`h-full rounded-full transition-all duration-1000 ease-linear ${urgent ? "animate-pulse bg-red-500" : "bg-emerald-500"}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Positions settle every 5 mins. Rankings reshuffle on live P&amp;L.
        </p>
      </section>

      {backedId === null ? (
        <section className="w-full">
          <h2 className="mb-4 text-center text-lg font-bold tracking-tight text-white sm:text-xl">
            Pick your agent to get started
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {sortedAgents.map(({ meta, api }) => {
              const rank = rankById[meta.id];
              const bookTotal = totalBookGbp(meta.id, api.pnl);
              return (
                <button
                  key={meta.id}
                  type="button"
                  onClick={() => setBackedId(meta.id)}
                  className="flex flex-col gap-2 rounded-xl border border-zinc-800/90 bg-[#111] p-3 text-left shadow-sm transition-all hover:border-zinc-700 sm:p-4"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-zinc-800 text-xs font-bold text-zinc-100">
                      #{rank}
                    </span>
                  </div>
                  <h3
                    className="text-sm font-bold leading-tight sm:text-base"
                    style={{ color: meta.color }}
                  >
                    {meta.name}
                  </h3>
                  <p className="line-clamp-3 text-[10px] leading-snug text-zinc-500 sm:text-[11px]">
                    {AGENT_STRATEGY_BLURB[meta.id]}
                  </p>
                  <p
                    className={`text-xs font-bold tabular-nums sm:text-sm ${api.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}
                  >
                    {formatGbp(bookTotal)} book
                  </p>
                </button>
              );
            })}
          </div>
        </section>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <span
              className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold text-white sm:text-sm"
              style={{
                borderColor: `${backedMeta?.color ?? "#fff"}66`,
                backgroundColor: `${backedMeta?.color ?? "#333"}18`,
              }}
            >
              Your agent:{" "}
              <span style={{ color: backedMeta?.color }}>{backedMeta?.name}</span>
            </span>
            <button
              type="button"
              onClick={() => setBackedId(null)}
              className="text-xs font-medium text-zinc-400 underline decoration-zinc-600 underline-offset-2 hover:text-zinc-200"
            >
              Change
            </button>
          </div>

          {(() => {
            const row = sortedAgents.find((r) => r.meta.id === backedId);
            if (!row) return null;
            const { meta, api } = row;
            const rank = rankById[meta.id];
            const start = startPnlRef.current?.[meta.id] ?? api.pnl;
            const delta = api.pnl - start;
            const bookTotal = totalBookGbp(meta.id, api.pnl);
            const streakShow =
              api.streak >= 3 && api.streakDir === "W"
                ? `${api.streak}W+`
                : api.streak >= 3 && api.streakDir === "L"
                  ? `${api.streak}L+`
                  : null;
            return (
              <>
                <article
                  className="relative mb-5 flex flex-col gap-4 rounded-2xl border border-zinc-800/90 bg-[#111] p-4 shadow-md sm:p-6"
                  style={{
                    boxShadow: `0 0 0 2px ${meta.color}55, 0 8px 40px -12px rgba(0,0,0,0.6)`,
                  }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-zinc-800 text-base font-bold text-zinc-100 sm:h-12 sm:w-12 sm:text-lg">
                        #{rank}
                      </span>
                      <div className="min-w-0">
                        <h2
                          className="truncate text-xl font-bold sm:text-2xl"
                          style={{ color: meta.color }}
                        >
                          {meta.name}
                        </h2>
                        <p className="text-xs text-zinc-500 sm:text-sm">
                          Your battle position
                        </p>
                      </div>
                    </div>
                    {streakShow && (
                      <span
                        className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white"
                        style={{ backgroundColor: meta.color }}
                      >
                        {streakShow}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-end gap-3">
                    <p
                      className={`text-3xl font-bold tabular-nums sm:text-4xl ${api.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}
                    >
                      {formatGbp(bookTotal)}
                    </p>
                    <span
                      className={`text-sm font-semibold tabular-nums ${delta >= 0 ? "text-emerald-400/85" : "text-red-400/85"}`}
                    >
                      {delta >= 0 ? "+" : ""}
                      {formatGbp(delta)} vs start
                    </span>
                  </div>
                  <p
                    className={`text-sm font-bold tabular-nums ${api.pnl >= 0 ? "text-emerald-400/95" : "text-red-400/95"}`}
                  >
                    Live P&amp;L {formatGbp(api.pnl)}
                  </p>

                  <div className="space-y-3 border-t border-zinc-800/80 pt-4 text-sm leading-relaxed text-zinc-400">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                        Strategy
                      </p>
                      <p className="mt-1 text-zinc-200">
                        {AGENT_STRATEGY_BLURB[meta.id]}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                        Last move
                      </p>
                      <p className="mt-1 text-base text-zinc-100">
                        {formatLastMoveLine(api, data.price)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                        Market watch
                      </p>
                      <p className="mt-1 text-zinc-300">{marketConditionLine}</p>
                    </div>
                  </div>
                </article>

                <GuideYourAgentPanel
                  backedId={backedId}
                  secondsLeft={secondsLeft}
                  urgent={urgent}
                  btc5mPct={btc5mPct}
                  btcPrice={data.price}
                  guideFlash={guideSignalFlash}
                  guideCrowdByAgent={guideCrowdByAgent}
                  setGuideCrowdByAgent={setGuideCrowdByAgent}
                  guidePickByAgent={guidePickByAgent}
                  setGuidePickByAgent={setGuidePickByAgent}
                  guideDraftByAgent={guideDraftByAgent}
                  setGuideDraftByAgent={setGuideDraftByAgent}
                  onStrategyVote={awardVotePoints}
                />

                <section className="mt-5">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Competition
                  </h3>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {sortedAgents
                      .filter((r) => r.meta.id !== backedId)
                      .map(({ meta, api }) => (
                        <article
                          key={meta.id}
                          className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-3 py-2.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-bold text-zinc-500">
                              #{rankById[meta.id]}
                            </span>
                            <span
                              className="truncate text-xs font-bold"
                              style={{ color: meta.color }}
                            >
                              {meta.name}
                            </span>
                          </div>
                          <p
                            className={`mt-1 text-sm font-bold tabular-nums ${api.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}
                          >
                            {formatGbp(api.pnl)}
                          </p>
                          <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-zinc-500">
                            {formatLastMoveLine(api, data.price)}
                          </p>
                        </article>
                      ))}
                  </div>
                </section>
              </>
            );
          })()}
        </>
      )}

      {/* Rank toasts */}
      <div className="pointer-events-none fixed bottom-24 left-3 z-50 flex max-w-[min(100%,20rem)] flex-col gap-2 sm:left-6">
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => dismissToast(t.id)}
            className="pointer-events-auto rounded-lg border border-emerald-500/30 bg-[#111]/95 px-3 py-2 text-left text-xs text-zinc-200 shadow-lg ring-1 ring-emerald-500/20 backdrop-blur-sm transition-opacity duration-300"
          >
            <p className="font-semibold text-emerald-400">
              {t.name} climbed to #{t.to}
            </p>
            <p className="text-zinc-500">
              Was #{t.from} · tap to dismiss
            </p>
          </button>
        ))}
      </div>

      {/* Bottom tabs + panels */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-zinc-800 bg-[#0d0d0d]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-lg justify-between gap-1 px-2 py-2">
          {(
            [
              ["vote", "Vote"],
              ["outcomes", "Outcomes"],
              ["feed", "Feed"],
              ["predictionWars", "Prediction Wars"],
              ["leaderboard", "Leaderboard"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                if (id === "predictionWars") {
                  router.push("/predictions");
                  return;
                }
                setActiveTab(id);
              }}
              className={`flex-1 rounded-lg py-2 text-center font-medium transition-colors ${
                id === "predictionWars"
                  ? "px-0.5 text-[10px] leading-tight sm:text-xs"
                  : "text-xs"
              } ${
                id !== "predictionWars" && activeTab === id
                  ? "bg-zinc-800 text-white"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mx-auto max-w-lg border-t border-zinc-800/80 px-3 pb-3 pt-2 text-[11px] text-zinc-500">
          <div className="flex flex-wrap justify-between gap-2">
            <span>{totalDecisions.toLocaleString()} decisions logged</span>
            <span>Crowd {crowdAccuracy}% accurate</span>
            <span className="tabular-nums">
              {Math.min(watchers, 9999)} active voters
            </span>
          </div>
        </div>
      </nav>

      {/* Tab content (scrolls above fixed nav) */}
      <section className="mt-6 flex-1 space-y-4 rounded-xl border border-zinc-800 bg-[#111] p-4">
        {activeTab === "vote" && <VotePanel btc5mPct={btc5mPct} />}
        {activeTab === "outcomes" && <OutcomesPanel data={data} />}
        {activeTab === "feed" && <FeedPanel data={data} />}
        {activeTab === "leaderboard" && (
          <LeaderboardPanel sortedAgents={sortedAgents} />
        )}
      </section>
    </div>
  );
}

const MAX_GUIDE_REASON = 140;

function GuideYourAgentPanel({
  backedId,
  secondsLeft,
  urgent,
  btc5mPct,
  btcPrice,
  guideFlash,
  guideCrowdByAgent,
  setGuideCrowdByAgent,
  guidePickByAgent,
  setGuidePickByAgent,
  guideDraftByAgent,
  setGuideDraftByAgent,
  onStrategyVote,
}: {
  backedId: AgentKey;
  secondsLeft: number;
  urgent: boolean;
  btc5mPct: number;
  btcPrice: number;
  guideFlash: boolean;
  guideCrowdByAgent: Record<AgentKey, Record<GuideStrategy, number>>;
  setGuideCrowdByAgent: Dispatch<
    SetStateAction<Record<AgentKey, Record<GuideStrategy, number>>>
  >;
  guidePickByAgent: Record<AgentKey, GuideStrategy | null>;
  setGuidePickByAgent: Dispatch<
    SetStateAction<Record<AgentKey, GuideStrategy | null>>
  >;
  guideDraftByAgent: Record<AgentKey, string>;
  setGuideDraftByAgent: Dispatch<SetStateAction<Record<AgentKey, string>>>;
  onStrategyVote?: () => void | Promise<void>;
}) {
  const { user, refreshProfile } = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [submitFlash, setSubmitFlash] = useState(false);
  const meta = AGENTS.find((a) => a.id === backedId)!;
  const guideCrowd = guideCrowdByAgent[backedId];
  const guidePick = guidePickByAgent[backedId];
  const guideDraft = guideDraftByAgent[backedId] ?? "";
  const pct = guideCrowdPercents(guideCrowd);
  const thought = leaderNextThought(meta.name, btc5mPct, btcPrice);

  const pickStrategy = (s: GuideStrategy) => {
    setGuidePickByAgent((p) => ({ ...p, [backedId]: s }));
  };

  const handleSubmitSignal = () => {
    const pending = guidePickByAgent[backedId];
    if (pending == null) return;
    if (!user) {
      setAuthModalOpen(true);
      return;
    }
    setGuideCrowdByAgent((prev) => {
      const cur = { ...prev[backedId] };
      cur[pending] = cur[pending] + 1;
      return { ...prev, [backedId]: cur };
    });
    void onStrategyVote?.();
    setSubmitFlash(true);
    window.setTimeout(() => {
      setSubmitFlash(false);
      setGuidePickByAgent((p) => ({ ...p, [backedId]: null }));
      setGuideDraftByAgent((p) => ({ ...p, [backedId]: "" }));
    }, 3000);
  };

  return (
    <section className="rounded-xl border border-zinc-800/90 bg-[#111] p-4 shadow-sm sm:p-5">
      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={() => void refreshProfile()}
      />
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-800/80 pb-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold uppercase tracking-wide text-zinc-200 sm:text-base">
            Guide your agent&apos;s next move
          </h3>
          <p className="mt-2 text-xs leading-relaxed text-zinc-400 sm:text-sm">
            {thought}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            Next decision
          </p>
          <p
            className={`mt-0.5 font-mono text-xl font-bold tabular-nums sm:text-2xl ${urgent ? "text-red-400" : "text-zinc-100"}`}
          >
            {formatCountdownMSS(secondsLeft)}
          </p>
        </div>
      </div>

      {guideFlash && (
        <div className="mt-4 animate-pulse rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-center text-xs font-semibold text-emerald-300 sm:text-sm">
          Signal sent. Agent is executing.
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => pickStrategy("long")}
          className={`rounded-xl border py-3 text-left text-xs font-bold leading-snug transition-colors sm:text-sm ${
            guidePick === "long"
              ? "border-emerald-400/70 bg-emerald-500/25 text-emerald-100 ring-2 ring-emerald-400/40"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
          } px-4`}
        >
          {GUIDE_STRATEGY_META.long.label}
        </button>
        <button
          type="button"
          onClick={() => pickStrategy("wait")}
          className={`rounded-xl border py-3 text-left text-xs font-bold leading-snug transition-colors sm:text-sm ${
            guidePick === "wait"
              ? "border-amber-400/70 bg-amber-500/25 text-amber-100 ring-2 ring-amber-400/40"
              : "border-amber-500/45 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
          } px-4`}
        >
          {GUIDE_STRATEGY_META.wait.label}
        </button>
        <button
          type="button"
          onClick={() => pickStrategy("short")}
          className={`rounded-xl border py-3 text-left text-xs font-bold leading-snug transition-colors sm:text-sm ${
            guidePick === "short"
              ? "border-red-400/70 bg-red-500/25 text-red-100 ring-2 ring-red-400/40"
              : "border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20"
          } px-4`}
        >
          {GUIDE_STRATEGY_META.short.label}
        </button>
        <button
          type="button"
          onClick={() => pickStrategy("hold")}
          className={`rounded-xl border py-3 text-left text-xs font-bold leading-snug transition-colors sm:text-sm ${
            guidePick === "hold"
              ? "border-zinc-400/50 bg-zinc-600/35 text-zinc-100 ring-2 ring-zinc-500/40"
              : "border-zinc-600/60 bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700/80"
          } px-4`}
        >
          {GUIDE_STRATEGY_META.hold.label}
        </button>
      </div>

      <div className="mt-4">
        <label htmlFor={`guide-reason-${backedId}`} className="sr-only">
          Tell your agent why
        </label>
        <textarea
          id={`guide-reason-${backedId}`}
          rows={2}
          maxLength={MAX_GUIDE_REASON}
          placeholder="Tell your agent why..."
          value={guideDraft}
          onChange={(e) =>
            setGuideDraftByAgent((prev) => ({
              ...prev,
              [backedId]: e.target.value.slice(0, MAX_GUIDE_REASON),
            }))
          }
          className="w-full resize-none rounded-xl border border-zinc-700/80 bg-zinc-950/80 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500/40"
        />
        <div className="mt-1 flex justify-end text-[11px] tabular-nums text-zinc-500">
          {guideDraft.length} / {MAX_GUIDE_REASON}
        </div>
      </div>

      {guidePick != null && (
        <div className="mt-4">
          <button
            type="button"
            disabled={submitFlash}
            onClick={() => void handleSubmitSignal()}
            className="w-full rounded-xl bg-white py-3 text-center text-sm font-semibold text-[#0a0a0a] transition-opacity hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {user ? "Submit signal →" : "Login to submit signal"}
          </button>
        </div>
      )}

      {submitFlash && (
        <div className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-center text-xs font-semibold text-emerald-300 sm:text-sm">
          Signal sent. Agent is executing.
        </div>
      )}

      <div className="mt-5">
        <p className="mb-2 text-center text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          Backers of {meta.name}
        </p>
        <div className="mb-1.5 grid grid-cols-4 gap-0.5 text-[8px] font-semibold tabular-nums leading-tight sm:gap-1 sm:text-[10px]">
          <span className="text-center text-emerald-400/90">
            {GUIDE_STRATEGY_META.long.bar} {pct.long}%
          </span>
          <span className="text-center text-amber-400/90">
            {GUIDE_STRATEGY_META.wait.bar} {pct.wait}%
          </span>
          <span className="text-center text-red-400/90">
            {GUIDE_STRATEGY_META.short.bar} {pct.short}%
          </span>
          <span className="text-center text-zinc-400">
            {GUIDE_STRATEGY_META.hold.bar} {pct.hold}%
          </span>
        </div>
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className="bg-emerald-500 transition-all duration-300"
            style={{ width: `${pct.long}%` }}
          />
          <div
            className="bg-amber-500 transition-all duration-300"
            style={{ width: `${pct.wait}%` }}
          />
          <div
            className="bg-red-500 transition-all duration-300"
            style={{ width: `${pct.short}%` }}
          />
          <div
            className="min-w-0 bg-zinc-500 transition-all duration-300"
            style={{ width: `${pct.hold}%` }}
          />
        </div>
      </div>
    </section>
  );
}

function VotePanel({ btc5mPct }: { btc5mPct: number }) {
  const pctStr = `${btc5mPct >= 0 ? "+" : ""}${btc5mPct.toFixed(1)}`;
  const questions = [
    {
      q: `BTC moved ${pctStr}% in the last 5 mins — breakout or fakeout?`,
      options: ["Real breakout", "Fakeout", "Too early to tell"],
    },
    {
      q: "Should your agent increase exposure this round?",
      options: ["Yes go bigger", "Stay the same", "Reduce risk"],
    },
    {
      q: "What's your read on the next 5 minutes?",
      options: ["Bullish", "Neutral", "Bearish"],
    },
  ];

  const [picks, setPicks] = useState<(number | null)[]>([
    null,
    null,
    null,
  ]);

  return (
    <div className="space-y-5">
      <h3 className="text-sm font-semibold text-zinc-200">Crowd pulse</h3>
      {questions.map((item, qi) => (
        <div key={item.q} className="space-y-2">
          <p className="text-xs font-medium leading-relaxed text-zinc-400">
            {item.q}
          </p>
          <div className="flex flex-col gap-2">
            {item.options.map((opt, oi) => {
              const selected = picks[qi] === oi;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() =>
                    setPicks((p) => {
                      const n = [...p];
                      n[qi] = oi;
                      return n;
                    })
                  }
                  className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                    selected
                      ? "border-violet-500/60 bg-violet-500/10 text-violet-200"
                      : "border-zinc-800 bg-zinc-900/50 text-zinc-300 hover:border-zinc-700"
                  }`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function OutcomesPanel({ data }: { data: CompetitionApiResponse }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-zinc-200">Round outcomes</h3>
      <ul className="space-y-3 text-xs text-zinc-400">
        {AGENTS.map(({ id, name, color }) => {
          const a = data.agents[id];
          const awaitingEval = a.wins === 0 && a.total === 0;
          const wr =
            a.total > 0 ? Math.round((a.wins / a.total) * 100) : 0;
          const last = String(a.lastAction || "HOLD").toUpperCase();
          return (
            <li
              key={id}
              className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-3"
            >
              <div className="flex items-center gap-2">
                <span
                  className="text-sm font-semibold text-zinc-100"
                  style={{ color }}
                >
                  {name}
                </span>
              </div>
              {awaitingEval ? (
                <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                  Awaiting first evaluated trade
                </p>
              ) : (
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] sm:grid-cols-4">
                  <div>
                    <p className="text-zinc-600">Total trades</p>
                    <p className="font-medium tabular-nums text-zinc-200">
                      {a.total}
                    </p>
                  </div>
                  <div>
                    <p className="text-zinc-600">Win rate</p>
                    <p className="font-medium tabular-nums text-zinc-200">
                      {wr}%
                    </p>
                  </div>
                  <div>
                    <p className="text-zinc-600">Streak</p>
                    <p className="font-medium tabular-nums text-zinc-200">
                      {formatStreakLabel(a)}
                    </p>
                  </div>
                  <div>
                    <p className="text-zinc-600">Last action</p>
                    <p className="font-medium text-zinc-200">{last}</p>
                  </div>
                </div>
              )}
              {awaitingEval && (
                <p className="mt-2 text-[11px] text-zinc-600">
                  Last signal:{" "}
                  <span className="font-medium text-zinc-400">{last}</span>
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FeedPanel({ data }: { data: CompetitionApiResponse }) {
  const apiItems = Array.isArray(data.recentDecisions)
    ? data.recentDecisions
    : [];
  const fallbackPrice = data.price;

  const rows = useMemo(() => {
    if (apiItems.length > 0) {
      return apiItems.slice(0, 24).map((row, i) => {
        const line = formatDecisionFeedLine(row, fallbackPrice);
        if (line)
          return { key: `api-${i}`, text: line, mono: false as const };
        const fallback =
          typeof row === "object" && row !== null
            ? JSON.stringify(row)
            : String(row);
        return {
          key: `api-raw-${i}`,
          text: fallback,
          mono: true as const,
        };
      });
    }
    return buildSimulatedFeedRows(fallbackPrice).map((r) => ({
      ...r,
      mono: false as const,
    }));
  }, [apiItems, fallbackPrice]);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-zinc-200">Live feed</h3>
      <ul className="max-h-64 space-y-2 overflow-y-auto text-xs text-zinc-400">
        {rows.map((r) => (
          <li
            key={r.key}
            className={
              r.mono
                ? "rounded-lg border border-zinc-800 bg-zinc-900/40 px-2 py-1.5 font-mono text-[10px] text-zinc-500"
                : "rounded-lg border border-zinc-800 bg-zinc-900/40 px-2 py-1.5 text-zinc-300"
            }
          >
            {r.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

type PredictorRow = {
  id: string;
  username: string;
  points: number;
  predictions_correct: number | null;
  predictions_total: number | null;
};

function tierForPoints(points: number): {
  label: string;
  className: string;
} {
  if (points >= 10_000)
    return {
      label: "Elite",
      className:
        "border-amber-500/40 bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/25",
    };
  if (points >= 5000)
    return {
      label: "Gold",
      className:
        "border-yellow-500/35 bg-yellow-500/10 text-yellow-200 ring-1 ring-yellow-500/20",
    };
  if (points >= 1000)
    return {
      label: "Silver",
      className:
        "border-zinc-400/35 bg-zinc-500/15 text-zinc-200 ring-1 ring-zinc-400/20",
    };
  return {
    label: "Bronze",
    className:
      "border-orange-700/40 bg-orange-950/50 text-orange-200/90 ring-1 ring-orange-800/30",
  };
}

function formatAccuracyPct(correct: number | null, total: number | null): string {
  const t = total ?? 0;
  const c = correct ?? 0;
  if (t <= 0) return "—";
  return `${Math.round((c / t) * 100)}%`;
}

function LeaderboardPanel({
  sortedAgents,
}: {
  sortedAgents: { meta: (typeof AGENTS)[number]; api: AgentApiState }[];
}) {
  const { user, profile } = useAuth();
  const [predictors, setPredictors] = useState<PredictorRow[]>([]);
  const [predictorsError, setPredictorsError] = useState<string | null>(null);
  const [predictorsLoading, setPredictorsLoading] = useState(true);

  const fetchPredictors = useCallback(async () => {
    setPredictorsError(null);
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "id, username, points, predictions_correct, predictions_total",
      )
      .order("points", { ascending: false })
      .limit(20);

    if (error) {
      setPredictorsError(error.message);
      setPredictors([]);
    } else {
      const rows = (data ?? []).map((r) => {
        const o = r as Record<string, unknown>;
        return {
          id: String(o.id ?? ""),
          username: String(o.username ?? ""),
          points: Number(o.points ?? 0),
          predictions_correct:
            o.predictions_correct == null
              ? null
              : Number(o.predictions_correct),
          predictions_total:
            o.predictions_total == null ? null : Number(o.predictions_total),
        } satisfies PredictorRow;
      });
      setPredictors(rows);
    }
    setPredictorsLoading(false);
  }, []);

  useEffect(() => {
    void fetchPredictors();
    const id = window.setInterval(() => void fetchPredictors(), 30_000);
    return () => window.clearInterval(id);
  }, [fetchPredictors]);

  const loggedIn = Boolean(user);
  const zeroPointsLoggedIn = loggedIn && (profile?.points ?? 0) === 0;

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">
            Agent rankings
          </h3>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
            ChatGPT, Claude, Gemini, Grok ranked by live P&amp;L — book totals
            include starting pool plus session P&amp;L.
          </p>
        </div>
        <ol className="space-y-2">
          {sortedAgents.map(({ meta, api }, i) => {
            const bookTotal = totalBookGbp(meta.id, api.pnl);
            return (
              <li
                key={meta.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="shrink-0 text-xs font-bold tabular-nums text-zinc-500"
                    style={{ color: meta.color }}
                  >
                    #{i + 1}
                  </span>
                  <span className="truncate text-sm font-medium text-zinc-200">
                    {meta.name}
                  </span>
                </div>
                <div className="shrink-0 text-right">
                  <span
                    className={`block text-sm font-semibold tabular-nums ${api.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}
                  >
                    {formatGbp(bookTotal)}
                  </span>
                  <span className="text-[10px] tabular-nums text-zinc-500">
                    P&amp;L {formatGbp(api.pnl)}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="space-y-3 border-t border-zinc-800/80 pt-6">
        <h3 className="text-sm font-semibold text-zinc-200">Top predictors</h3>

        {!loggedIn && (
          <p className="rounded-lg border border-zinc-700/60 bg-zinc-900/30 px-3 py-2 text-xs text-zinc-400">
            Login to see your ranking
          </p>
        )}
        {loggedIn && zeroPointsLoggedIn && (
          <p className="rounded-lg border border-violet-500/25 bg-violet-500/10 px-3 py-2 text-xs text-violet-200/90">
            You&apos;re not on the leaderboard yet — start voting to earn
            points
          </p>
        )}

        {predictorsLoading && predictors.length === 0 ? (
          <p className="text-xs text-zinc-500">Loading predictors…</p>
        ) : null}
        {predictorsError && (
          <p className="text-xs text-red-400/90">{predictorsError}</p>
        )}

        <ul className="space-y-2">
          {predictors.map((row, i) => {
            const tier = tierForPoints(row.points);
            const isYou = Boolean(user?.id && row.id === user.id);
            return (
              <li
                key={row.id}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5 ${
                  isYou
                    ? "border-violet-500/35 bg-violet-500/[0.12]"
                    : "border-zinc-800 bg-zinc-900/40"
                }`}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
                  <span className="w-6 shrink-0 text-xs font-bold tabular-nums text-zinc-500">
                    #{i + 1}
                  </span>
                  <span className="min-w-0 truncate text-sm font-medium text-zinc-200">
                    {row.username}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tier.className}`}
                  >
                    {tier.label}
                  </span>
                </div>
                <div className="flex w-full shrink-0 items-center justify-between gap-3 pl-8 sm:ml-auto sm:w-auto sm:pl-0">
                  <span className="text-xs tabular-nums text-zinc-400">
                    {formatAccuracyPct(
                      row.predictions_correct,
                      row.predictions_total,
                    )}
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-zinc-100">
                    {row.points.toLocaleString()} pts
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
