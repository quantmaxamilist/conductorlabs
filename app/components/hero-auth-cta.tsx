"use client";

import { AuthButton } from "@/components/AuthButton";

export function HeroAuthCta() {
  return (
    <div className="mt-8 flex flex-col items-start gap-3 sm:items-center sm:text-center">
      <p className="max-w-md text-sm text-white/65">
        Login to start earning points on every correct prediction
      </p>
      <AuthButton />
    </div>
  );
}
