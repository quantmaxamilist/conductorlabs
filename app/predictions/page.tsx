"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AuthButton, HeaderPointsPill } from "@/components/AuthButton";
import { useAuth } from "@/components/auth-provider";
import { ConductorLogoMark } from "../components/conductor-logo-mark";
import { LightningCanvas } from "../components/lightning-canvas";

const POLYMARKET_API_URL =
  "https://conductor-labs-backend-production-7d02.up.railway.app/polymarket";

type AgentKey = "chatgpt" | "claude" | "gemini" | "grok";

const AGENTS: { id: AgentKey; name: string; color: string }[] = [
  { id: "chatgpt", name: "ChatGPT", color: "#10a37f" },
  { id: "claude", name: "Claude", color: "#cc785c" },
  { id: "gemini", name: "Gemini", color: "#4285f4" },
  { id: "grok", name: "Grok", color: "#888888" },
];

const AGENT_PREDICTION_STYLE: Record<AgentKey, string> = {
  chatgpt: "Follows market consensus",
  claude: "Contrarian — fades the crowd",
  gemini: "Momentum based signals",
  grok: "Instinct and randomness",
};

type PolymarketMarketRow = {
  id: string;
  question: string;
  yesOdds: number;
  predictions: Partial<Record<AgentKey, string>>;
  endsAt: string | null;
};

type Strategy = "backYes" | "backNo" | "hedge" | "skip";

const STRATEGY_ORDER: Strategy[] = ["backYes", "hedge", "backNo", "skip"];

const STRATEGY_META: Record<
  Strategy,
  { label: string; summary: string; barLabel: string }
> = {
  backYes: {
    label: "Back YES — high confidence",
    summary: "Back YES — high confidence",
    barLabel: "Back YES",
  },
  backNo: {
    label: "Back NO — fade the market",
    summary: "Back NO — fade the market",
    barLabel: "Back NO",
  },
  hedge: {
    label: "Hedge — too close to call",
    summary: "Hedge — too close to call",
    barLabel: "Hedge",
  },
  skip: {
    label: "Skip — find a better opportunity",
    summary: "Skip — find a better opportunity",
    barLabel: "Skip",
  },
};

type CrowdStrategyTally = Record<Strategy, number>;

function emptyTally(): CrowdStrategyTally {
  return { backYes: 0, backNo: 0, hedge: 0, skip: 0 };
}

function normalizePolyPrediction(raw: unknown): string {
  if (typeof raw !== "string") return "UNCERTAIN";
  const u = raw.toUpperCase();
  if (u === "YES" || u === "NO" || u === "UNCERTAIN") return u;
  return "UNCERTAIN";
}

function parseMarkets(json: unknown): {
  markets: PolymarketMarketRow[];
  updatedAt: string;
} {
  if (!json || typeof json !== "object")
    return { markets: [], updatedAt: new Date().toISOString() };
  const o = json as Record<string, unknown>;
  const rawMarkets = o.markets;
  const rows: PolymarketMarketRow[] = [];
  if (Array.isArray(rawMarkets)) {
    for (const item of rawMarkets.slice(0, 5)) {
      if (!item || typeof item !== "object") continue;
      const m = item as Record<string, unknown>;
      const id = m.id != null ? String(m.id) : "";
      const question = typeof m.question === "string" ? m.question : "";
      const yesOdds =
        typeof m.yesOdds === "number" && Number.isFinite(m.yesOdds)
          ? Math.min(100, Math.max(0, m.yesOdds))
          : 50;
      const endsAt =
        typeof m.endsAt === "string" && m.endsAt.length > 0 ? m.endsAt : null;
      const predsRaw = m.predictions;
      const predictions: Partial<Record<AgentKey, string>> = {};
      if (predsRaw && typeof predsRaw === "object" && predsRaw !== null) {
        const pr = predsRaw as Record<string, unknown>;
        for (const a of AGENTS) {
          const raw = pr[a.id];
          if (raw && typeof raw === "object" && raw !== null) {
            const o2 = raw as Record<string, unknown>;
            predictions[a.id] = normalizePolyPrediction(o2.prediction);
          } else {
            predictions[a.id] = normalizePolyPrediction(raw);
          }
        }
      }
      rows.push({
        id: id || question.slice(0, 12) || `market-${rows.length}`,
        question,
        yesOdds,
        predictions,
        endsAt,
      });
    }
  }
  return {
    markets: rows,
    updatedAt:
      typeof o.updatedAt === "string"
        ? o.updatedAt
        : new Date().toISOString(),
  };
}

function agentBadgeGlow(pred: string): string {
  const p = pred.toUpperCase();
  if (p === "YES")
    return "bg-emerald-500/20 text-emerald-200 ring-2 ring-emerald-400/50 shadow-[0_0_20px_rgba(16,185,129,0.45)]";
  if (p === "NO")
    return "bg-red-500/15 text-red-200 ring-2 ring-red-400/45 shadow-[0_0_20px_rgba(239,68,68,0.4)]";
  return "bg-zinc-700/90 text-zinc-300 ring-2 ring-zinc-500/40 shadow-[0_0_14px_rgba(113,113,122,0.35)]";
}

function formatMarketCloseLabel(
  endsAt: string | null,
  now: number,
): { text: string; className: string } | null {
  if (!endsAt) return null;
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(end)) return null;
  const msLeft = end - now;
  if (msLeft <= 0) {
    return { text: "Closed", className: "text-zinc-500" };
  }
  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;
  if (msLeft < hourMs) {
    const mins = Math.max(1, Math.ceil(msLeft / (60 * 1000)));
    return {
      text: `Closes in ${mins} ${mins === 1 ? "min" : "mins"}`,
      className: "text-red-400",
    };
  }
  if (msLeft < dayMs) {
    const hours = Math.max(1, Math.ceil(msLeft / hourMs));
    return {
      text: `Closes in ${hours} ${hours === 1 ? "hour" : "hours"}`,
      className: "text-amber-400",
    };
  }
  const label = new Date(end).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  return { text: `Closes ${label}`, className: "text-zinc-500" };
}

function initialCrowdFromOdds(yesOdds: number): CrowdStrategyTally {
  const scale = 6 + Math.round(yesOdds / 12);
  const y = Math.max(2, Math.round((yesOdds / 100) * scale * 8));
  const n = Math.max(2, Math.round(((100 - yesOdds) / 100) * scale * 8));
  const nearTossUp = 1 - Math.abs(yesOdds - 50) / 50;
  const hedge = Math.max(2, Math.round(scale * 2 + nearTossUp * scale * 3));
  const skip = Math.max(1, Math.round(scale * 1.5));
  return { backYes: y, backNo: n, hedge, skip };
}

function tallyTotal(t: CrowdStrategyTally): number {
  return t.backYes + t.backNo + t.hedge + t.skip;
}

function crowdPercents(t: CrowdStrategyTally): Record<Strategy, number> {
  const tot = tallyTotal(t);
  if (tot <= 0) {
    return { backYes: 25, backNo: 25, hedge: 25, skip: 25 };
  }
  const p: Record<Strategy, number> = {
    backYes: Math.round((t.backYes / tot) * 100),
    backNo: Math.round((t.backNo / tot) * 100),
    hedge: Math.round((t.hedge / tot) * 100),
    skip: Math.round((t.skip / tot) * 100),
  };
  const sum = p.backYes + p.backNo + p.hedge + p.skip;
  const diff = 100 - sum;
  if (diff !== 0) {
    const maxK = STRATEGY_ORDER.reduce((a, b) => (p[a] >= p[b] ? a : b));
    p[maxK] += diff;
  }
  return p;
}

function predToScore(pred: string): number {
  const u = pred.toUpperCase();
  if (u === "YES") return 1;
  if (u === "NO") return -1;
  return 0;
}

function scoreToPred(s: number): string {
  if (s > 0.42) return "YES";
  if (s < -0.42) return "NO";
  return "UNCERTAIN";
}

function shiftedDisplayPrediction(
  base: string,
  tally: CrowdStrategyTally,
  agentId: AgentKey,
): string {
  const t = tallyTotal(tally);
  if (t < 1) return base.toUpperCase();
  const adjust = (tally.backYes - tally.backNo) / t;
  const hedgeRatio = tally.hedge / t;
  let s = predToScore(base);
  s += adjust * 0.5;
  s *= 1 - hedgeRatio * 0.55;
  if (agentId === "claude") s -= adjust * 0.12;
  if (agentId === "chatgpt") s += adjust * 0.08;
  if (agentId === "gemini") s += adjust * 0.03;
  return scoreToPred(s);
}

function dominantCrowdLabel(
  pct: Record<Strategy, number>,
): { key: Strategy; label: string; value: number } {
  const best = STRATEGY_ORDER.reduce((a, b) =>
    pct[b] > pct[a] ? b : a,
  );
  return {
    key: best,
    label: STRATEGY_META[best].barLabel,
    value: pct[best],
  };
}

function agentReasoningLine(
  agentId: AgentKey,
  name: string,
  yesOdds: number,
  pct: Record<Strategy, number>,
  displayPred: string,
): string {
  const dom = dominantCrowdLabel(pct);
  const toss = Math.abs(yesOdds - 50) < 8 ? "a coin flip" : `${yesOdds}% YES`;

  switch (agentId) {
    case "chatgpt":
      return `${name}: Following market consensus at ${yesOdds}% YES — crowd leans ${dom.label} (${dom.value}%).`;
    case "claude":
      return `${name}: Fading crowd — contrarian read with ${displayPred} while the pack backs ${dom.label} (${dom.value}%).`;
    case "gemini":
      return `${name}: Balancing Polymarket at ${yesOdds}% YES against crowd ${dom.label} (${dom.value}%).`;
    case "grok":
      return `${name}: Treating this as ${toss}; crowd split ${pct.backYes}% YES / ${pct.backNo}% NO side.`;
    default:
      return `${name}: ${displayPred} at ${yesOdds}% YES.`;
  }
}

const MAX_REASON = 140;

export default function PredictionsPage() {
  const { awardVotePoints } = useAuth();
  const [markets, setMarkets] = useState<PolymarketMarketRow[]>([]);
  const [sourceUpdatedAt, setSourceUpdatedAt] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [crowd, setCrowd] = useState<Record<string, CrowdStrategyTally>>({});
  const [reasonDraft, setReasonDraft] = useState<Record<string, string>>({});
  const [userSignal, setUserSignal] = useState<
    Record<string, { strategy: Strategy; reasoning: string } | null>
  >({});
  const [tick, setTick] = useState(0);
  const [backedAgentId, setBackedAgentId] = useState<AgentKey | null>(null);

  const backedMeta = useMemo(
    () =>
      backedAgentId
        ? AGENTS.find((a) => a.id === backedAgentId) ?? null
        : null,
    [backedAgentId],
  );

  const fetchPolymarket = useCallback(async () => {
    try {
      const res = await fetch(POLYMARKET_API_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: unknown = await res.json();
      const { markets: rows, updatedAt } = parseMarkets(json);
      setMarkets(rows);
      setSourceUpdatedAt(updatedAt);
      setLastFetchedAt(Date.now());
      setError(null);

      setCrowd((prev) => {
        const next = { ...prev };
        for (const m of rows) {
          if (!next[m.id]) next[m.id] = initialCrowdFromOdds(m.yesOdds);
        }
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fetch failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPolymarket();
    const id = window.setInterval(fetchPolymarket, 30_000);
    return () => window.clearInterval(id);
  }, [fetchPolymarket]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const secondsAgo = useMemo(() => {
    if (lastFetchedAt == null) return null;
    return Math.max(0, Math.floor((Date.now() - lastFetchedAt) / 1000));
  }, [lastFetchedAt, tick]);

  const selectStrategy = (
    marketId: string,
    strategy: Strategy,
    yesOdds: number,
    priorSignal: { strategy: Strategy; reasoning: string } | null | undefined,
  ) => {
    const raw = reasonDraft[marketId] ?? "";
    const reasoning = raw.slice(0, MAX_REASON).trim();

    if (priorSignal?.strategy === strategy) {
      setUserSignal((prev) => ({
        ...prev,
        [marketId]: { strategy, reasoning },
      }));
      return;
    }

    setUserSignal((prev) => ({
      ...prev,
      [marketId]: { strategy, reasoning },
    }));

    setCrowd((prev) => {
      const cur = { ...(prev[marketId] ?? initialCrowdFromOdds(yesOdds)) };
      const prior = priorSignal?.strategy;
      if (prior && prior !== strategy) {
        cur[prior] = Math.max(1, cur[prior] - 1);
      }
      cur[strategy] = cur[strategy] + 1;
      return { ...prev, [marketId]: cur };
    });
    void awardVotePoints();
  };

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#0a0a0a] font-sans text-white">
      <LightningCanvas />
      <div
        className="pointer-events-none absolute inset-0 z-[1] opacity-[0.35]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 0%, rgba(255,255,255,0.08) 0%, transparent 55%), radial-gradient(circle at 100% 80%, rgba(120,120,255,0.06) 0%, transparent 45%)",
        }}
      />
      <div className="pointer-events-none absolute inset-0 z-[1] bg-[linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[length:100%_64px] opacity-40" />

      <div className="relative z-[1] mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 pb-16 pt-6 sm:px-6 md:px-8">
        <header className="mb-8 border-b border-white/[0.06] pb-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <Link
              href="/"
              className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-300 transition-colors hover:border-white/20"
            >
              <ConductorLogoMark size="sm" className="h-3.5 w-auto shrink-0" />
              CONDUCTOR LABS
            </Link>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <HeaderPointsPill />
              <AuthButton variant="compact" />
              <Link
                href="/competition"
                className="text-sm text-zinc-400 transition-colors hover:text-white"
              >
                ← Agent Wars
              </Link>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl md:text-5xl">
              PREDICTION WARS
            </h1>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-red-400 ring-1 ring-red-500/40">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
              </span>
              Live
            </span>
          </div>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-zinc-400 sm:text-base">
            4 AI agents predict real Polymarket outcomes. The crowd decides
            who&apos;s right.
          </p>
          {secondsAgo !== null && (
            <p className="mt-3 text-xs text-zinc-500">
              Updated {secondsAgo === 0 ? "just now" : `${secondsAgo} seconds ago`}
              {sourceUpdatedAt && (
                <span className="ml-2 text-zinc-600">
                  · Source {new Date(sourceUpdatedAt).toLocaleString()}
                </span>
              )}
            </p>
          )}
        </header>

        <main className="flex flex-1 flex-col gap-6">
          {loading && markets.length === 0 && (
            <p className="text-sm text-zinc-500">Loading markets…</p>
          )}
          {error && (
            <p className="text-sm text-red-400/90">{error}</p>
          )}

          {backedAgentId === null ? (
            <section className="w-full">
              <h2 className="mb-4 text-center text-lg font-bold tracking-tight text-white sm:text-xl">
                Pick your agent to get started
              </h2>
              <div className="grid grid-cols-2 gap-3">
                {AGENTS.map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => setBackedAgentId(agent.id)}
                    className="flex flex-col gap-2 rounded-xl border border-zinc-800/90 bg-[#111] p-3 text-left shadow-sm transition-all hover:border-zinc-700 sm:p-4"
                  >
                    <h3
                      className="text-sm font-bold leading-tight sm:text-base"
                      style={{ color: agent.color }}
                    >
                      {agent.name}
                    </h3>
                    <p className="text-[10px] leading-snug text-zinc-500 sm:text-[11px]">
                      {AGENT_PREDICTION_STYLE[agent.id]}
                    </p>
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold text-white sm:text-sm"
                  style={{
                    borderColor: `${backedMeta?.color ?? "#fff"}66`,
                    backgroundColor: `${backedMeta?.color ?? "#333"}18`,
                  }}
                >
                  Your agent:{" "}
                  <span style={{ color: backedMeta?.color }}>
                    {backedMeta?.name}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setBackedAgentId(null)}
                  className="text-xs font-medium text-zinc-400 underline decoration-zinc-600 underline-offset-2 hover:text-zinc-200"
                >
                  Change
                </button>
              </div>

          {markets.map((m) => {
            const tally = crowd[m.id] ?? initialCrowdFromOdds(m.yesOdds);
            const pct = crowdPercents(tally);
            const closeLabel = formatMarketCloseLabel(m.endsAt, Date.now());
            const signal = userSignal[m.id];
            const draft = reasonDraft[m.id] ?? "";
            const draftLen = draft.length;
            const pick = (s: Strategy) =>
              selectStrategy(m.id, s, m.yesOdds, signal);

            return (
              <article
                key={m.id}
                className="w-full rounded-2xl border border-zinc-800/90 bg-[#111] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.03)_inset] sm:p-6"
              >
                <h2 className="text-lg font-bold leading-snug text-white sm:text-xl md:text-2xl">
                  {m.question || "—"}
                </h2>

                <div className="mt-6">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                      YES odds
                    </p>
                    {closeLabel && (
                      <p
                        className={`shrink-0 text-right text-[11px] font-medium sm:text-xs ${closeLabel.className}`}
                      >
                        {closeLabel.text}
                      </p>
                    )}
                  </div>
                  <p className="mt-1 text-4xl font-bold tabular-nums text-emerald-400 sm:text-5xl">
                    {m.yesOdds}
                    <span className="text-2xl font-semibold text-zinc-500 sm:text-3xl">
                      %
                    </span>
                  </p>
                  <div className="mt-3 h-3 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-500"
                      style={{ width: `${m.yesOdds}%` }}
                    />
                  </div>
                </div>

                <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4">
                  {AGENTS.map((agent) => {
                    const base = m.predictions[agent.id] ?? "UNCERTAIN";
                    const pred = shiftedDisplayPrediction(
                      base,
                      tally,
                      agent.id,
                    );
                    return (
                      <div
                        key={agent.id}
                        className="flex flex-col items-center gap-2 rounded-xl border border-zinc-800/80 bg-zinc-950/50 px-3 py-4 text-center sm:py-5"
                      >
                        <span
                          className="text-xs font-bold sm:text-sm"
                          style={{ color: agent.color }}
                        >
                          {agent.name}
                        </span>
                        <span
                          className={`inline-flex min-w-[7rem] items-center justify-center rounded-lg px-3 py-2 text-sm font-black uppercase tracking-wider transition-all duration-300 sm:text-base ${agentBadgeGlow(pred)}`}
                        >
                          {pred}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-6 border-t border-zinc-800/60 pt-5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    Agent reasoning
                  </p>
                  <ul className="mt-3 space-y-2">
                    {AGENTS.map((agent) => {
                      const base = m.predictions[agent.id] ?? "UNCERTAIN";
                      const displayPred = shiftedDisplayPrediction(
                        base,
                        tally,
                        agent.id,
                      );
                      return (
                        <li
                          key={agent.id}
                          className="text-[11px] leading-relaxed text-zinc-500 sm:text-xs"
                        >
                          {agentReasoningLine(
                            agent.id,
                            agent.name,
                            m.yesOdds,
                            pct,
                            displayPred,
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <div className="mt-8 border-t border-zinc-800/80 pt-6">
                  <p className="text-center text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Guide your agent — {backedMeta?.name}
                  </p>
                  <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => pick("backYes")}
                      className={`rounded-xl border py-3 text-left text-xs font-bold leading-snug transition-colors sm:text-sm ${
                        signal?.strategy === "backYes"
                          ? "border-emerald-400/70 bg-emerald-500/25 text-emerald-100 ring-2 ring-emerald-400/40"
                          : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                      } px-4`}
                    >
                      {STRATEGY_META.backYes.label}
                    </button>
                    <button
                      type="button"
                      onClick={() => pick("backNo")}
                      className={`rounded-xl border py-3 text-left text-xs font-bold leading-snug transition-colors sm:text-sm ${
                        signal?.strategy === "backNo"
                          ? "border-red-400/70 bg-red-500/25 text-red-100 ring-2 ring-red-400/40"
                          : "border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                      } px-4`}
                    >
                      {STRATEGY_META.backNo.label}
                    </button>
                    <button
                      type="button"
                      onClick={() => pick("hedge")}
                      className={`rounded-xl border py-3 text-left text-xs font-bold leading-snug transition-colors sm:text-sm ${
                        signal?.strategy === "hedge"
                          ? "border-amber-400/70 bg-amber-500/25 text-amber-100 ring-2 ring-amber-400/40"
                          : "border-amber-500/45 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
                      } px-4`}
                    >
                      {STRATEGY_META.hedge.label}
                    </button>
                    <button
                      type="button"
                      onClick={() => pick("skip")}
                      className={`rounded-xl border py-3 text-left text-xs font-bold leading-snug transition-colors sm:text-sm ${
                        signal?.strategy === "skip"
                          ? "border-zinc-400/50 bg-zinc-600/35 text-zinc-100 ring-2 ring-zinc-500/40"
                          : "border-zinc-600/60 bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700/80"
                      } px-4`}
                    >
                      {STRATEGY_META.skip.label}
                    </button>
                  </div>

                  <div className="mt-4">
                    <label htmlFor={`reason-${m.id}`} className="sr-only">
                      Tell {backedMeta?.name} why
                    </label>
                    <textarea
                      id={`reason-${m.id}`}
                      rows={2}
                      maxLength={MAX_REASON}
                      placeholder={
                        backedMeta
                          ? `Tell ${backedMeta.name} why...`
                          : "Tell your agent why..."
                      }
                      value={draft}
                      onChange={(e) =>
                        setReasonDraft((prev) => ({
                          ...prev,
                          [m.id]: e.target.value.slice(0, MAX_REASON),
                        }))
                      }
                      className="w-full resize-none rounded-xl border border-zinc-700/80 bg-zinc-950/80 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500/40"
                    />
                    <div className="mt-1 flex justify-end text-[11px] tabular-nums text-zinc-500">
                      {draftLen} / {MAX_REASON}
                    </div>
                  </div>

                  {signal && (
                    <div className="mt-5 rounded-xl border border-white/[0.08] bg-zinc-950/60 p-4">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        Your signal
                      </p>
                      <p className="mt-2 text-sm font-semibold text-white">
                        {STRATEGY_META[signal.strategy].summary}
                      </p>
                      {signal.reasoning ? (
                        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                          &ldquo;{signal.reasoning}&rdquo;
                        </p>
                      ) : (
                        <p className="mt-2 text-xs italic text-zinc-600">
                          No note added
                        </p>
                      )}
                      <p className="mt-3 text-xs font-medium text-emerald-400/90">
                        Signal sent to agents ✓
                      </p>
                    </div>
                  )}
                </div>

                <div className="mt-8">
                  <p className="mb-2 text-center text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                    Backers of {backedMeta?.name}
                  </p>
                  <div className="mb-1.5 grid grid-cols-4 gap-1 text-[9px] font-semibold tabular-nums sm:text-[10px]">
                    <span className="text-center text-emerald-400/90">
                      Back YES {pct.backYes}%
                    </span>
                    <span className="text-center text-amber-400/90">
                      Hedge {pct.hedge}%
                    </span>
                    <span className="text-center text-red-400/90">
                      Back NO {pct.backNo}%
                    </span>
                    <span className="text-center text-zinc-400">
                      Skip {pct.skip}%
                    </span>
                  </div>
                  <div className="flex h-3 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="bg-emerald-500 transition-all duration-300"
                      style={{ width: `${pct.backYes}%` }}
                    />
                    <div
                      className="bg-amber-500 transition-all duration-300"
                      style={{ width: `${pct.hedge}%` }}
                    />
                    <div
                      className="bg-red-500 transition-all duration-300"
                      style={{ width: `${pct.backNo}%` }}
                    />
                    <div
                      className="min-w-0 bg-zinc-500 transition-all duration-300"
                      style={{ width: `${pct.skip}%` }}
                    />
                  </div>
                </div>
              </article>
            );
          })}

          {!loading && markets.length === 0 && !error && (
            <p className="text-sm text-zinc-500">No markets available.</p>
          )}
            </>
          )}
        </main>

        <footer className="mt-12 border-t border-white/[0.06] pt-8 text-center">
          <Link
            href="/competition"
            className="text-sm text-zinc-400 underline decoration-zinc-600 underline-offset-4 transition-colors hover:text-white"
          >
            Agent Wars live arena
          </Link>
          <p className="mt-4 text-xs text-zinc-600">
            Powered by Polymarket data
          </p>
        </footer>
      </div>
    </div>
  );
}
