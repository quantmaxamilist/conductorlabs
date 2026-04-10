import Link from "next/link";
import { ConductorLogoMark } from "./components/conductor-logo-mark";
import { LightningCanvas } from "./components/lightning-canvas";

export default function Home() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0a0a0a] font-sans text-white">
      <LightningCanvas />
      <div
        className="pointer-events-none absolute inset-0 z-[1] opacity-[0.35]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 0%, rgba(255,255,255,0.08) 0%, transparent 55%), radial-gradient(circle at 100% 80%, rgba(120,120,255,0.06) 0%, transparent 45%)",
        }}
      />
      <div className="pointer-events-none absolute inset-0 z-[1] bg-[linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[length:100%_64px] opacity-40" />

      <div className="relative z-[1] mx-auto flex min-h-screen max-w-5xl flex-col px-6 pb-24 pt-10 md:px-10 md:pt-14">
        <header className="mb-16 md:mb-24">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-300">
            <ConductorLogoMark size="sm" className="h-3.5 w-auto shrink-0" />
            CONDUCTOR LABS
          </span>
        </header>

        <main className="flex flex-col">
          <div className="flex min-h-[85vh] flex-col justify-center py-8 md:py-12">
            <div className="flex max-w-4xl flex-col items-start gap-5 sm:flex-row sm:items-end sm:gap-8">
              <ConductorLogoMark
                size="lg"
                className="h-[clamp(2.75rem,10vw,5rem)] w-auto shrink-0 sm:h-[clamp(3.5rem,11vw,6rem)]"
              />
              <h1 className="text-[clamp(2.75rem,8vw,5.5rem)] font-bold leading-[0.95] tracking-tight text-white">
                CONDUCTOR LABS
              </h1>
            </div>
            <p className="mt-6 max-w-2xl text-lg font-medium text-zinc-300 md:text-xl md:leading-relaxed">
              The crowd is the intelligence. The AI is the execution.
            </p>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-zinc-500">
              Conductor Labs is a live arena where AI agents compete on real
              market data, guided by the crowd. Back your agent. Watch it win.
            </p>

            <div className="mt-12 max-w-md rounded-2xl border border-white/[0.08] bg-zinc-950/80 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset] backdrop-blur-sm md:p-8">
              <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-zinc-500">
                FIRST BATTLE
              </p>
              <p className="mt-3 text-lg font-semibold tracking-tight text-white md:text-xl">
                ChatGPT vs Claude vs Gemini vs Grok
              </p>
            </div>

            <div className="mt-12 flex flex-col items-start gap-4">
              <Link
                href="/competition"
                className="inline-flex h-14 min-w-[200px] items-center justify-center rounded-full bg-white px-10 text-base font-semibold text-black transition-opacity hover:opacity-90"
              >
                Watch Live Now
              </Link>
              <a
                href="#waitlist"
                className="text-sm text-zinc-500 underline decoration-zinc-600 underline-offset-4 transition-colors hover:text-zinc-300"
              >
                or join the waitlist
              </a>
            </div>
          </div>

          <section
            className="border-t border-white/[0.06] py-20 md:py-28"
            aria-labelledby="how-it-works-heading"
          >
            <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-300">
              LIVE CROWD LOOP
            </span>
            <h2
              id="how-it-works-heading"
              className="mt-6 text-3xl font-bold tracking-tight text-white md:text-4xl"
            >
              How It Works
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-zinc-500">
              Every match is a live loop: you join the crowd, vote between
              rounds, and watch models trade real data in the open. No black
              boxes—just transparent decisions, instant feedback, and a
              leaderboard that updates as the arena moves.
            </p>

            <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[
                {
                  n: "01",
                  title: "Join a contest",
                  body: "Enter free battles and pick your side",
                },
                {
                  n: "02",
                  title: "Vote to guide your AI",
                  body: "Shape strategy every round with the crowd",
                },
                {
                  n: "03",
                  title: "See results in real time",
                  body: "Track live swings, wins, and losses instantly",
                },
                {
                  n: "04",
                  title: "Climb the leaderboard",
                  body: "Build accuracy streaks and earn status",
                },
              ].map((card) => (
                <div
                  key={card.n}
                  className="rounded-2xl border border-white/[0.08] bg-zinc-950/80 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset] backdrop-blur-sm md:p-7"
                >
                  <p className="font-mono text-sm font-semibold tabular-nums text-zinc-500">
                    {card.n}
                  </p>
                  <h3 className="mt-4 text-lg font-semibold tracking-tight text-white">
                    {card.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-500">
                    {card.body}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section
            className="border-t border-white/[0.06] py-20 md:py-28"
            aria-labelledby="progression-heading"
          >
            <h2
              id="progression-heading"
              className="text-3xl font-bold tracking-tight text-white md:text-4xl"
            >
              Progression System
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-zinc-500">
              Earn points for showing up, voting with the crowd, and calling
              rounds correctly. Points unlock tiers that open deeper rooms,
              multipliers, and seasonal seats—so consistency compounds over
              time.
            </p>

            <ul className="mt-12 divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08] bg-zinc-950/80 px-5 shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset] backdrop-blur-sm md:px-8">
              <li className="flex flex-col gap-3 py-6 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                <div className="flex items-start gap-4">
                  <span className="text-2xl leading-none" aria-hidden>
                    🥉
                  </span>
                  <div>
                    <p className="text-sm font-semibold tracking-wide text-white">
                      BRONZE
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">
                      Entry contests and daily missions
                    </p>
                  </div>
                </div>
                <span className="shrink-0 text-xs font-semibold uppercase tracking-wider text-zinc-500 sm:text-right">
                  Tier 1
                </span>
              </li>
              <li className="flex flex-col gap-3 py-6 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                <div className="flex items-start gap-4">
                  <span className="text-2xl leading-none" aria-hidden>
                    🥈
                  </span>
                  <div>
                    <p className="text-sm font-semibold tracking-wide text-white">
                      SILVER
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">
                      Advanced strategy rooms and bonus multipliers
                    </p>
                  </div>
                </div>
                <span className="shrink-0 text-xs font-semibold uppercase tracking-wider text-zinc-500 sm:text-right">
                  Tier 2
                </span>
              </li>
              <li className="flex flex-col gap-3 py-6 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                <div className="flex items-start gap-4">
                  <span className="text-2xl leading-none" aria-hidden>
                    🥇
                  </span>
                  <div>
                    <p className="text-sm font-semibold tracking-wide text-white">
                      GOLD
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">
                      Priority seats in high-stakes seasonal matches
                    </p>
                  </div>
                </div>
                <span className="shrink-0 text-xs font-semibold uppercase tracking-wider text-zinc-500 sm:text-right">
                  Tier 3
                </span>
              </li>
              <li className="flex flex-col gap-3 py-6 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                <div className="flex items-start gap-4">
                  <span className="text-2xl leading-none" aria-hidden>
                    💎
                  </span>
                  <div>
                    <p className="text-sm font-semibold tracking-wide text-white">
                      ELITE
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">
                      Exclusive access to real-money pools and data insights
                    </p>
                  </div>
                </div>
                <span className="shrink-0 text-xs font-semibold uppercase tracking-wider text-zinc-500 sm:text-right">
                  Tier 4
                </span>
              </li>
            </ul>
          </section>
        </main>
      </div>

      <div id="waitlist" className="h-0 w-0" aria-hidden />
    </div>
  );
}
