"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
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

type PolymarketMarketRow = {
  id: string;
  question: string;
  yesOdds: number;
  predictions: Partial<Record<AgentKey, string>>;
};

type CrowdTally = { yes: number; no: number };

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
      const predsRaw = m.predictions;
      const predictions: Partial<Record<AgentKey, string>> = {};
      if (predsRaw && typeof predsRaw === "object" && predsRaw !== null) {
        const pr = predsRaw as Record<string, unknown>;
        for (const a of AGENTS) {
          const raw = pr[a.id];
          if (raw && typeof raw === "object" && raw !== null) {
            const o = raw as Record<string, unknown>;
            predictions[a.id] = normalizePolyPrediction(o.prediction);
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

function initialCrowdFromOdds(yesOdds: number): CrowdTally {
  const scale = 8 + Math.round(yesOdds / 10);
  const yesW = Math.max(1, Math.round((yesOdds / 100) * scale * 10));
  const noW = Math.max(1, Math.round(((100 - yesOdds) / 100) * scale * 10));
  return { yes: yesW, no: noW };
}

export default function PredictionsPage() {
  const [markets, setMarkets] = useState<PolymarketMarketRow[]>([]);
  const [sourceUpdatedAt, setSourceUpdatedAt] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [crowd, setCrowd] = useState<Record<string, CrowdTally>>({});
  const [tick, setTick] = useState(0);

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

  const bumpCrowd = (marketId: string, side: "yes" | "no") => {
    setCrowd((prev) => {
      const cur = prev[marketId] ?? { yes: 1, no: 1 };
      return {
        ...prev,
        [marketId]: {
          yes: cur.yes + (side === "yes" ? 1 : 0),
          no: cur.no + (side === "no" ? 1 : 0),
        },
      };
    });
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
            <Link
              href="/competition"
              className="text-sm text-zinc-400 transition-colors hover:text-white"
            >
              ← Agent Wars
            </Link>
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

          {markets.map((m) => {
            const tally = crowd[m.id] ?? initialCrowdFromOdds(m.yesOdds);
            const total = tally.yes + tally.no;
            const crowdYesPct = total > 0 ? Math.round((tally.yes / total) * 100) : 50;

            return (
              <article
                key={m.id}
                className="w-full rounded-2xl border border-zinc-800/90 bg-[#111] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.03)_inset] sm:p-6"
              >
                <h2 className="text-lg font-bold leading-snug text-white sm:text-xl md:text-2xl">
                  {m.question || "—"}
                </h2>

                <div className="mt-6">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                    YES odds
                  </p>
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
                    const pred = m.predictions[agent.id] ?? "UNCERTAIN";
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
                          className={`inline-flex min-w-[7rem] items-center justify-center rounded-lg px-3 py-2 text-sm font-black uppercase tracking-wider sm:text-base ${agentBadgeGlow(pred)}`}
                        >
                          {pred}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-8 border-t border-zinc-800/80 pt-6">
                  <p className="text-center text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Back your prediction
                  </p>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-center sm:gap-4">
                    <button
                      type="button"
                      onClick={() => bumpCrowd(m.id, "yes")}
                      className="flex-1 rounded-xl border border-emerald-500/40 bg-emerald-500/10 py-3 text-sm font-bold uppercase tracking-wide text-emerald-300 transition-colors hover:bg-emerald-500/20 sm:flex-none sm:min-w-[140px]"
                    >
                      YES
                    </button>
                    <button
                      type="button"
                      onClick={() => bumpCrowd(m.id, "no")}
                      className="flex-1 rounded-xl border border-red-500/40 bg-red-500/10 py-3 text-sm font-bold uppercase tracking-wide text-red-300 transition-colors hover:bg-red-500/20 sm:flex-none sm:min-w-[140px]"
                    >
                      NO
                    </button>
                  </div>
                </div>

                <div className="mt-6">
                  <div className="mb-2 flex justify-between text-[11px] text-zinc-500">
                    <span>Crowd · YES {crowdYesPct}%</span>
                    <span>NO {100 - crowdYesPct}%</span>
                  </div>
                  <div className="flex h-3 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="bg-emerald-500 transition-all duration-300"
                      style={{ width: `${crowdYesPct}%` }}
                    />
                    <div className="min-w-0 flex-1 bg-red-500/90 transition-all duration-300" />
                  </div>
                </div>
              </article>
            );
          })}

          {!loading && markets.length === 0 && !error && (
            <p className="text-sm text-zinc-500">No markets available.</p>
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
