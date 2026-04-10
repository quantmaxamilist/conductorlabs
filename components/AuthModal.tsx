"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Tab = "login" | "signup";

type AuthModalProps = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export function AuthModal({ open, onClose, onSuccess }: AuthModalProps) {
  const [tab, setTab] = useState<Tab>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setError(null);
      setPassword("");
      setConfirm("");
      setUsername("");
      setTab("login");
    }
  }, [open]);

  const handleSignup = useCallback(async () => {
    setError(null);
    const raw = username.trim();
    const safe = raw
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, "");
    if (safe.length < 2) {
      setError("Username must be at least 2 letters or numbers.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    const email = `${safe}@conductorlabs.app`;

    setBusy(true);
    try {
      const { data: taken } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", safe)
        .maybeSingle();

      if (taken) {
        setError("That username is already taken.");
        setBusy(false);
        return;
      }

      const { data, error: signErr } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { username: safe } },
      });

      if (signErr) {
        if (
          signErr.message.toLowerCase().includes("already") ||
          signErr.message.toLowerCase().includes("registered")
        ) {
          setError("That username is already taken.");
        } else {
          setError(signErr.message);
        }
        setBusy(false);
        return;
      }

      if (data.user) {
        const { error: insErr } = await supabase.from("profiles").insert({
          id: data.user.id,
          username: safe,
          points: 0,
        });

        if (insErr) {
          setError(insErr.message || "Could not create profile.");
          setBusy(false);
          return;
        }
      }

      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }, [username, password, confirm, onClose, onSuccess]);

  const handleLogin = useCallback(async () => {
    setError(null);
    const safe = username
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, "");
    if (safe.length < 1) {
      setError("Enter a valid username.");
      return;
    }
    if (password.length < 1) {
      setError("Enter your password.");
      return;
    }

    const email = `${safe}@conductorlabs.app`;
    setBusy(true);
    try {
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signErr) {
        if (
          signErr.message.toLowerCase().includes("invalid") ||
          signErr.message.toLowerCase().includes("credentials")
        ) {
          setError("Wrong username or password.");
        } else {
          setError(signErr.message);
        }
        setBusy(false);
        return;
      }

      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }, [username, password, onClose, onSuccess]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-black/70 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close modal"
        onClick={onClose}
      />
      <div className="relative z-[201] w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#111] p-5 shadow-2xl sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2
            id="auth-modal-title"
            className="text-lg font-bold text-white sm:text-xl"
          >
            {tab === "login" ? "Log in" : "Create account"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="mb-5 flex rounded-lg border border-white/10 bg-[#0a0a0a] p-0.5">
          <button
            type="button"
            onClick={() => {
              setTab("login");
              setError(null);
            }}
            className={`flex-1 rounded-md py-2 text-center text-sm font-semibold transition-colors ${
              tab === "login"
                ? "bg-zinc-700 text-white"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => {
              setTab("signup");
              setError(null);
            }}
            className={`flex-1 rounded-md py-2 text-center text-sm font-semibold transition-colors ${
              tab === "signup"
                ? "bg-zinc-700 text-white"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Sign up
          </button>
        </div>

        {error && (
          <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        <div className="space-y-3">
          <div>
            <label
              htmlFor="auth-username"
              className="mb-1 block text-xs font-medium text-zinc-400"
            >
              Username
            </label>
            <input
              id="auth-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-xl border border-zinc-700 bg-[#0a0a0a] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500/40"
              placeholder="yourname"
            />
          </div>
          <div>
            <label
              htmlFor="auth-password"
              className="mb-1 block text-xs font-medium text-zinc-400"
            >
              Password
            </label>
            <input
              id="auth-password"
              type="password"
              autoComplete={
                tab === "signup" ? "new-password" : "current-password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-zinc-700 bg-[#0a0a0a] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500/40"
              placeholder="••••••••"
            />
          </div>
          {tab === "signup" && (
            <div>
              <label
                htmlFor="auth-confirm"
                className="mb-1 block text-xs font-medium text-zinc-400"
              >
                Confirm password
              </label>
              <input
                id="auth-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-xl border border-zinc-700 bg-[#0a0a0a] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500/40"
                placeholder="••••••••"
              />
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-300 hover:bg-white/5"
          >
            Cancel
          </button>
          {tab === "login" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleLogin()}
              className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#0a0a0a] hover:bg-zinc-200 disabled:opacity-50"
            >
              {busy ? "…" : "Login"}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleSignup()}
              className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#0a0a0a] hover:bg-zinc-200 disabled:opacity-50"
            >
              {busy ? "…" : "Create account"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
