import { supabase } from "@/lib/supabase";

/** +10 points per strategy vote (placeholder scoring). */
export async function addVotePoints(userId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("points")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) return null;

  const next = (data.points ?? 0) + 10;
  const { error: upErr } = await supabase
    .from("profiles")
    .update({ points: next })
    .eq("id", userId);

  if (upErr) return null;
  return next;
}
