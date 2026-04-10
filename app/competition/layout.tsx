import type { ReactNode } from "react";
import { CompetitionProvider } from "./competition-provider";

export default function CompetitionLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <CompetitionProvider>
      <div className="min-h-screen bg-[#0d0d0d] text-zinc-100 antialiased">
        {children}
      </div>
    </CompetitionProvider>
  );
}
