"use client";

import Link from "next/link";
import { useAuth } from "@/components/auth-provider";

export default function ProfilePage() {
  const { user, profile, loading, signOut } = useAuth();

  if (loading) {
    return (
      <div className="mx-auto min-h-screen max-w-lg px-4 py-16 text-zinc-400">
        Loading…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto min-h-screen max-w-lg px-4 py-16">
        <p className="text-zinc-300">You&apos;re not logged in.</p>
        <Link
          href="/"
          className="mt-4 inline-block text-sm text-violet-400 underline"
        >
          Back home
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-lg px-4 py-16 text-white">
      <h1 className="text-2xl font-bold">Profile</h1>
      <div className="mt-6 space-y-3 rounded-2xl border border-zinc-800 bg-[#111] p-5">
        <p className="text-sm text-zinc-400">
          Username
        </p>
        <p className="text-lg font-semibold text-zinc-100">
          {profile?.username ?? user.email}
        </p>
        <p className="mt-4 text-sm text-zinc-400">Points</p>
        <p className="text-2xl font-bold tabular-nums text-violet-300">
          {(profile?.points ?? 0).toLocaleString()} pts
        </p>
      </div>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/competition"
          className="rounded-xl border border-zinc-600 px-4 py-2 text-sm text-zinc-200 hover:bg-white/5"
        >
          Trading Wars
        </Link>
        <Link
          href="/predictions"
          className="rounded-xl border border-zinc-600 px-4 py-2 text-sm text-zinc-200 hover:bg-white/5"
        >
          Prediction Wars
        </Link>
        <button
          type="button"
          onClick={() => void signOut()}
          className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-[#0a0a0a]"
        >
          Logout
        </button>
      </div>
    </div>
  );
}
