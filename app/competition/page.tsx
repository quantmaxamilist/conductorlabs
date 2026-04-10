"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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

/** Base book shown on cards; API `pnl` is added on top. */
const STARTING_POOL_GBP: Record<AgentKey, number> = {
  chatgpt: 122_000,
  claude: 118_500,
  gemini: 120_800,
  grok: 116_900,
};

const ROUND_SEC = 60;

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

function strategyLabel(lastAction: string) {
  const a = lastAction.toUpperCase();
  if (a === "BUY") return "Long BTC";
  if (a === "SELL") return "Reduce exposure";
  return "Hold / observe";
}

function streakStatus(streak: number, streakDir: string): "hot" | "cold" | "neutral" {
  const d = String(streakDir).toUpperCase();
  if (d === "W" && streak >= 3) return "hot";
  if (d === "L" && streak >= 2) return "cold";
  return "neutral";
}

function moodFromStreak(streak: number, streakDir: string): string {
  const d = String(streakDir).toUpperCase();
  if (d === "W" && streak >= 4) return "On a tear";
  if (d === "W" && streak >= 2) return "Building momentum";
  if (d === "L" && streak >= 2) return "Struggling";
  return "Holding steady";
}

function totalBookGbp(id: AgentKey, apiPnl: number) {
  return STARTING_POOL_GBP[id] + apiPnl;
}

function pseudoCount(seed: string, salt: number) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h << 5) - h + seed.charCodeAt(i);
    h |= 0;
  }
  return Math.abs((h + salt) % 9000) + 800;
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

export default function CompetitionPage() {
  const router = useRouter();
  const { data } = useCompetitionState();
  const [watchers, setWatchers] = useState(18420);
  const [secondsLeft, setSecondsLeft] = useState(ROUND_SEC);
  const [roundPulse, setRoundPulse] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("vote");
  const [backedId, setBackedId] = useState<AgentKey | null>(null);
  const [toasts, setToasts] = useState<RankToast[]>([]);
  const startPnlRef = useRef<Record<AgentKey, number> | null>(null);
  const prevRanksRef = useRef<Record<AgentKey, number> | null>(null);
  const lastRankToastAt = useRef<Partial<Record<AgentKey, number>>>({});

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
          return ROUND_SEC;
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

  const progress = (secondsLeft / ROUND_SEC) * 100;
  const urgent = secondsLeft <= 10;

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

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col px-3 pb-28 pt-3 sm:px-4">
      {/* Top bar */}
      <header className="mb-4 flex flex-wrap items-center gap-2 border-b border-zinc-800/80 pb-3">
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
        <span className="rounded-md bg-violet-500/15 px-2 py-1 text-xs font-semibold text-violet-300 ring-1 ring-violet-500/30">
          12,400 pts
        </span>
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
            0:{secondsLeft.toString().padStart(2, "0")}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
          <div
            className={`h-full rounded-full transition-all duration-1000 ease-linear ${urgent ? "animate-pulse bg-red-500" : "bg-emerald-500"}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Positions settle every 60s. Rankings reshuffle on live P&amp;L.
        </p>
      </section>

      {/* Agent grid */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {sortedAgents.map(({ meta, api }, idx) => {
          const rank = idx + 1;
          const start = startPnlRef.current?.[meta.id] ?? api.pnl;
          const delta = api.pnl - start;
          const bookTotal = totalBookGbp(meta.id, api.pnl);
          const status = streakStatus(api.streak, api.streakDir);
          const supporters = pseudoCount(meta.id, Math.floor(watchers / 50));
          const votes = pseudoCount(meta.name, api.total);
          const streakShow =
            api.streak >= 3 && api.streakDir === "W"
              ? `${api.streak}W+`
              : api.streak >= 3 && api.streakDir === "L"
                ? `${api.streak}L+`
                : null;
          return (
            <article
              key={meta.id}
              className="relative flex flex-col gap-2 rounded-xl border border-zinc-800/90 bg-[#111] p-3 shadow-sm transition-shadow duration-300"
              style={
                backedId === meta.id
                  ? {
                      boxShadow: `0 0 0 2px ${meta.color}, 0 0 0 4px #0d0d0d`,
                    }
                  : undefined
              }
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-sm font-bold text-zinc-100">
                    #{rank}
                  </span>
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-100">
                      {meta.name}
                    </h2>
                    <p className="text-xs text-zinc-500">Live book</p>
                  </div>
                </div>
                {streakShow && (
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
                    style={{ backgroundColor: meta.color }}
                  >
                    {streakShow}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <p
                  className={`text-xl font-bold tabular-nums ${api.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}
                >
                  {formatGbp(bookTotal)}
                </p>
                <span
                  className={`text-xs font-medium tabular-nums ${delta >= 0 ? "text-emerald-400/80" : "text-red-400/80"}`}
                >
                  {delta >= 0 ? "+" : ""}
                  {formatGbp(delta)} vs start
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] text-zinc-400">
                <div>
                  <p className="text-zinc-600">Supporters</p>
                  <p className="font-medium text-zinc-200 tabular-nums">
                    {supporters.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-zinc-600">Votes cast</p>
                  <p className="font-medium text-zinc-200 tabular-nums">
                    {votes.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-zinc-600">Live P&amp;L</p>
                  <p
                    className={`font-semibold tabular-nums ${api.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}
                  >
                    {formatGbp(api.pnl)}
                  </p>
                </div>
                <div>
                  <p className="text-zinc-600">Strategy</p>
                  <p className="font-medium text-zinc-200">
                    {strategyLabel(api.lastAction)}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 border-t border-zinc-800/80 pt-2">
                <span
                  className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${
                    status === "hot"
                      ? "bg-orange-500/20 text-orange-300 ring-1 ring-orange-500/30"
                      : status === "cold"
                        ? "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/25"
                        : "bg-zinc-800 text-zinc-400"
                  }`}
                >
                  {status === "hot"
                    ? "Hot"
                    : status === "cold"
                      ? "Cold"
                      : "Neutral"}
                </span>
                <span className="rounded-md bg-zinc-800/80 px-2 py-0.5 text-[10px] text-zinc-300">
                  Mood: {moodFromStreak(api.streak, api.streakDir)}
                </span>
                <span className="rounded-md bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-500">
                  Last: {api.lastAction}
                </span>
              </div>
            </article>
          );
        })}
      </section>

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
        {activeTab === "vote" && (
          <VotePanel
            backedId={backedId}
            setBackedId={setBackedId}
          />
        )}
        {activeTab === "outcomes" && <OutcomesPanel data={data} />}
        {activeTab === "feed" && <FeedPanel data={data} />}
        {activeTab === "leaderboard" && (
          <LeaderboardPanel sortedAgents={sortedAgents} />
        )}
      </section>
    </div>
  );
}

function VotePanel({
  backedId,
  setBackedId,
}: {
  backedId: AgentKey | null;
  setBackedId: (id: AgentKey | null) => void;
}) {
  const questions = [
    {
      q: "Next 60s — BTC bias?",
      options: ["Pushes higher", "Chops sideways", "Flush lower"],
    },
    {
      q: "Which agent is most risk-on?",
      options: ["ChatGPT", "Claude", "Gemini / Grok tie"],
    },
    {
      q: "Crowd call: volatility this round?",
      options: ["Expands", "Compresses", "Spikes then mean reverts"],
    },
  ];

  const [picks, setPicks] = useState<(number | null)[]>([
    null,
    null,
    null,
  ]);

  return (
    <div className="space-y-5">
      <h3 className="text-sm font-semibold text-zinc-200">Crowd questions</h3>
      {questions.map((item, qi) => (
        <div key={item.q} className="space-y-2">
          <p className="text-xs font-medium text-zinc-400">{item.q}</p>
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

      <div>
        <p className="mb-2 text-xs font-medium text-zinc-400">Back a runner</p>
        <div className="grid grid-cols-2 gap-2">
          {AGENTS.map((a) => {
            const on = backedId === a.id;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setBackedId(on ? null : a.id)}
                className={`rounded-lg border-2 px-3 py-2.5 text-sm font-semibold transition-all ${
                  on
                    ? "text-white"
                    : "border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-600"
                }`}
                style={
                  on
                    ? {
                        borderColor: a.color,
                        backgroundColor: `${a.color}22`,
                        boxShadow: `0 0 0 1px ${a.color}55`,
                      }
                    : undefined
                }
              >
                Back {a.name}
              </button>
            );
          })}
        </div>
      </div>
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

function LeaderboardPanel({
  sortedAgents,
}: {
  sortedAgents: { meta: (typeof AGENTS)[number]; api: AgentApiState }[];
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-zinc-200">Leaderboard</h3>
      <ol className="space-y-2">
        {sortedAgents.map(({ meta, api }, i) => (
          <li
            key={meta.id}
            className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <span
                className="text-xs font-bold text-zinc-500"
                style={{ color: meta.color }}
              >
                #{i + 1}
              </span>
              <span className="text-sm font-medium text-zinc-200">
                {meta.name}
              </span>
            </div>
            <span
              className={`text-sm font-semibold tabular-nums ${api.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}
            >
              {formatGbp(api.pnl)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
