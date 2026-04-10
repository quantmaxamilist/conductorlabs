"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuthModal } from "@/components/AuthModal";
import { useAuth } from "@/components/auth-provider";

const DEMO_POINTS = 12_400;

export function AuthButton({ variant = "default" }: { variant?: "default" | "compact" }) {
  const { user, profile, loading, refreshProfile, signOut } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const onAuthSuccess = useCallback(() => {
    void refreshProfile();
  }, [refreshProfile]);

  if (loading) {
    return (
      <span className="text-xs text-zinc-500 tabular-nums">…</span>
    );
  }

  if (!user) {
    return (
      <>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className={
            variant === "compact"
              ? "whitespace-nowrap rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-1 text-[10px] font-semibold text-violet-200 ring-1 ring-violet-500/25 hover:bg-violet-500/20 sm:text-xs"
              : "inline-flex items-center justify-center rounded-xl border border-violet-500/35 bg-violet-500/10 px-4 py-2.5 text-sm font-semibold text-violet-200 ring-1 ring-violet-500/30 transition hover:bg-violet-500/20"
          }
        >
          Login to earn points →
        </button>
        <AuthModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onSuccess={onAuthSuccess}
        />
      </>
    );
  }

  const pts = profile?.points ?? 0;
  const name = profile?.username ?? user.email?.split("@")[0] ?? "Player";

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        className={
          variant === "compact"
            ? "inline-flex max-w-[11rem] items-center gap-1 truncate rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-1 text-[10px] font-semibold text-violet-200 ring-1 ring-violet-500/25 sm:max-w-none sm:text-xs"
            : "inline-flex max-w-full items-center gap-1 truncate rounded-xl border border-violet-500/35 bg-violet-500/10 px-3 py-2 text-sm font-semibold text-violet-200 ring-1 ring-violet-500/30"
        }
      >
        <span aria-hidden>👤</span>
        <span className="truncate">{name}</span>
        <span className="shrink-0 text-violet-300/90 tabular-nums">· {pts} pts</span>
      </button>
      {menuOpen && (
        <div className="absolute right-0 top-full z-[100] mt-1 min-w-[10rem] rounded-xl border border-zinc-700 bg-[#111] py-1 shadow-xl">
          <Link
            href="/profile"
            className="block px-3 py-2 text-sm text-zinc-200 hover:bg-white/5"
            onClick={() => setMenuOpen(false)}
          >
            View profile
          </Link>
          <button
            type="button"
            className="w-full px-3 py-2 text-left text-sm text-zinc-200 hover:bg-white/5"
            onClick={() => {
              setMenuOpen(false);
              void signOut();
            }}
          >
            Logout
          </button>
        </div>
      )}
    </div>
  );
}

export function HeaderPointsPill() {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return (
      <span className="rounded-md bg-violet-500/15 px-2 py-1 text-xs font-semibold text-violet-300 ring-1 ring-violet-500/30">
        … pts
      </span>
    );
  }

  const pts = user ? (profile?.points ?? 0) : DEMO_POINTS;

  return (
    <span className="rounded-md bg-violet-500/15 px-2 py-1 text-xs font-semibold text-violet-300 ring-1 ring-violet-500/30 tabular-nums">
      {pts.toLocaleString()} pts
    </span>
  );
}
