"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

const STATE_URL =
  "https://conductor-labs-backend-production-7d02.up.railway.app/state";

export type AgentKey = "chatgpt" | "claude" | "gemini" | "grok";

export type AgentApiState = {
  pnl: number;
  wins: number;
  total: number;
  streak: number;
  streakDir: "W" | "L" | string;
  lastAction: string;
};

export type CompetitionApiResponse = {
  price: number;
  agents: Record<AgentKey, AgentApiState>;
  recentDecisions?: unknown[];
};

const SIMULATED_AGENTS: Record<AgentKey, AgentApiState> = {
  chatgpt: {
    pnl: 120.5,
    wins: 2,
    total: 5,
    streak: 2,
    streakDir: "W",
    lastAction: "BUY",
  },
  claude: {
    pnl: -45.2,
    wins: 1,
    total: 5,
    streak: 1,
    streakDir: "L",
    lastAction: "HOLD",
  },
  gemini: {
    pnl: 88.0,
    wins: 2,
    total: 5,
    streak: 3,
    streakDir: "W",
    lastAction: "SELL",
  },
  grok: {
    pnl: -12.3,
    wins: 1,
    total: 5,
    streak: 0,
    streakDir: "W",
    lastAction: "BUY",
  },
};

function jitterSimulated(prev: Record<AgentKey, AgentApiState>) {
  const next = { ...prev };
  (Object.keys(next) as AgentKey[]).forEach((k) => {
    const a = { ...next[k] };
    a.pnl += (Math.random() - 0.45) * 80;
    a.total += 1;
    if (Math.random() > 0.5) {
      a.wins += 1;
      a.streak = a.streakDir === "W" ? a.streak + 1 : 1;
      a.streakDir = "W";
    } else {
      a.streak = a.streakDir === "L" ? a.streak + 1 : 1;
      a.streakDir = "L";
    }
    const acts = ["BUY", "SELL", "HOLD"] as const;
    a.lastAction = acts[Math.floor(Math.random() * acts.length)];
    next[k] = a;
  });
  return next;
}

function buildSimulatedResponse(
  seed?: CompetitionApiResponse,
): CompetitionApiResponse {
  const baseAgents = seed
    ? jitterSimulated(seed.agents)
    : { ...SIMULATED_AGENTS };
  return {
    price: (seed?.price ?? 69850) + (Math.random() - 0.5) * 400,
    agents: baseAgents,
    recentDecisions: seed?.recentDecisions ?? [],
  };
}

function normalizeApi(json: unknown): CompetitionApiResponse | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const price = o.price;
  const agents = o.agents;
  if (typeof price !== "number" || !agents || typeof agents !== "object")
    return null;
  const a = agents as Record<string, unknown>;
  const keys: AgentKey[] = ["chatgpt", "claude", "gemini", "grok"];
  const out: Partial<Record<AgentKey, AgentApiState>> = {};
  for (const k of keys) {
    const row = a[k];
    if (!row || typeof row !== "object") return null;
    const r = row as Record<string, unknown>;
    if (
      typeof r.pnl !== "number" ||
      typeof r.wins !== "number" ||
      typeof r.total !== "number" ||
      typeof r.streak !== "number"
    )
      return null;
    out[k] = {
      pnl: r.pnl,
      wins: r.wins,
      total: r.total,
      streak: r.streak,
      streakDir: typeof r.streakDir === "string" ? r.streakDir : "W",
      lastAction: typeof r.lastAction === "string" ? r.lastAction : "HOLD",
    };
  }
  return {
    price,
    agents: out as Record<AgentKey, AgentApiState>,
    recentDecisions: Array.isArray(o.recentDecisions)
      ? o.recentDecisions
      : [],
  };
}

type CompetitionContextValue = {
  data: CompetitionApiResponse;
  live: boolean;
  refresh: () => void;
};

const CompetitionContext = createContext<CompetitionContextValue | null>(null);

export function useCompetitionState(): CompetitionContextValue {
  const ctx = useContext(CompetitionContext);
  if (!ctx) {
    throw new Error(
      "useCompetitionState must be used within CompetitionProvider",
    );
  }
  return ctx;
}

export function CompetitionProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<CompetitionApiResponse>(() =>
    buildSimulatedResponse(),
  );
  const [live, setLive] = useState(false);
  const hadSuccessRef = useRef(false);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(STATE_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const json: unknown = await res.json();
      const parsed = normalizeApi(json);
      if (!parsed) throw new Error("invalid shape");
      hadSuccessRef.current = true;
      setData(parsed);
      setLive(true);
    } catch {
      setLive(false);
      setData((prev) =>
        hadSuccessRef.current ? prev : buildSimulatedResponse(prev),
      );
    }
  }, []);

  useEffect(() => {
    fetchState();
    const id = window.setInterval(fetchState, 5000);
    return () => window.clearInterval(id);
  }, [fetchState]);

  const value = useMemo(
    () => ({ data, live, refresh: fetchState }),
    [data, live, fetchState],
  );

  return (
    <CompetitionContext.Provider value={value}>
      {children}
    </CompetitionContext.Provider>
  );
}
