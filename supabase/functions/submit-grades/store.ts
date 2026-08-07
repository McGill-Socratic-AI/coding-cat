import type { SupabaseClient } from "supabase";
import { type GradeItem, type GradeMap, isGradeItem } from "./types.ts";

// A legitimate student edits a handful of values a handful of times across a
// term. This cap exists only so an authenticated client cannot append rows
// without bound; it is generous enough that no real user will meet it.
export const DAILY_ROW_CAP = 100;

export interface ConsentRow {
  consent_version: string;
  action: "granted" | "withdrawn";
  created_at: string;
}

/** Latest consent event for a student, or null if they have never answered. */
export async function readLatestConsent(
  service: SupabaseClient,
  profileId: string,
): Promise<ConsentRow | null> {
  const { data, error } = await service
    .from("research_consent")
    .select("consent_version, action, created_at")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[store] readLatestConsent error:", error);
    throw new Error("could not read consent state");
  }
  return (data as ConsentRow | null) ?? null;
}

export async function recordConsent(
  service: SupabaseClient,
  profileId: string,
  consentVersion: string,
  action: "granted" | "withdrawn",
): Promise<void> {
  const { error } = await service
    .from("research_consent")
    .insert({
      profile_id: profileId,
      consent_version: consentVersion,
      action,
    });

  if (error) {
    console.error("[store] recordConsent error:", error);
    throw new Error("could not record consent");
  }
}

/**
 * The caller's current answers.
 *
 * The table is append-only, so "current" means the newest row per item_key. We
 * reduce in JS rather than reaching for DISTINCT ON because PostgREST has no
 * clean way to express it and the row count per student is bounded by
 * DAILY_ROW_CAP anyway.
 */
export async function readGrades(
  service: SupabaseClient,
  pseudonym: string,
): Promise<Partial<Record<GradeItem, number>>> {
  const { data, error } = await service
    .from("self_reported_grades")
    .select("item_key, score, submitted_at")
    .eq("pseudonym", pseudonym)
    .order("submitted_at", { ascending: false })
    .limit(1000);

  if (error) {
    console.error("[store] readGrades error:", error);
    throw new Error("could not read grades");
  }

  const out: Partial<Record<GradeItem, number>> = {};
  for (
    const row of (data ?? []) as Array<
      { item_key: string; score: number | string }
    >
  ) {
    if (!isGradeItem(row.item_key)) continue;
    if (row.item_key in out) continue; // rows are newest-first, so keep the first
    // PostgREST returns NUMERIC as a string to preserve precision.
    const score = typeof row.score === "string" ? Number(row.score) : row.score;
    if (Number.isFinite(score)) out[row.item_key] = score;
  }
  return out;
}

/** Rows this pseudonym has appended in the last 24 hours. */
export async function countRecentRows(
  service: SupabaseClient,
  pseudonym: string,
): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await service
    .from("self_reported_grades")
    .select("id", { count: "exact", head: true })
    .eq("pseudonym", pseudonym)
    .gte("submitted_at", since);

  if (error) {
    // Fail open: a counting failure must not block a student from reporting a
    // grade. The cap is an anti-bloat guard, not a security control — the
    // security control is that pseudonym is server-derived.
    console.error("[store] countRecentRows error (failing open):", error);
    return 0;
  }
  return count ?? 0;
}

/**
 * Apply a submission: append a row for each score, delete rows for each
 * explicit null.
 *
 * Not a transaction. PostgREST gives us no way to batch an insert and a delete
 * atomically, and the failure mode is benign: a partial apply leaves earlier
 * items saved and the student simply resubmits. Making this atomic would mean
 * an RPC, which is more moving parts than the risk justifies.
 */
export async function applyGrades(
  service: SupabaseClient,
  pseudonym: string,
  grades: GradeMap,
  consentVersion: string,
): Promise<void> {
  const toInsert: Array<{
    pseudonym: string;
    item_key: string;
    score: number;
    consent_version: string;
  }> = [];
  const toClear: GradeItem[] = [];

  for (
    const [key, value] of Object.entries(grades) as Array<
      [GradeItem, number | null]
    >
  ) {
    if (value === null) {
      toClear.push(key);
    } else {
      toInsert.push({
        pseudonym,
        item_key: key,
        score: value,
        consent_version: consentVersion,
      });
    }
  }

  if (toClear.length > 0) {
    const { error } = await service
      .from("self_reported_grades")
      .delete()
      .eq("pseudonym", pseudonym)
      .in("item_key", toClear);
    if (error) {
      console.error("[store] applyGrades clear error:", error);
      throw new Error("could not clear grades");
    }
  }

  if (toInsert.length > 0) {
    const { error } = await service
      .from("self_reported_grades")
      .insert(toInsert);
    if (error) {
      console.error("[store] applyGrades insert error:", error);
      throw new Error("could not save grades");
    }
  }
}

/**
 * Withdrawal deletes rather than tombstones.
 *
 * A student who withdraws is asking for their data to be gone, and honouring
 * that literally is both the right behaviour and the simplest thing to explain
 * to an ethics board. The consent ledger keeps the audit trail that a
 * withdrawal happened; the data itself does not survive it.
 */
export async function deleteAllGrades(
  service: SupabaseClient,
  pseudonym: string,
): Promise<void> {
  const { error } = await service
    .from("self_reported_grades")
    .delete()
    .eq("pseudonym", pseudonym);

  if (error) {
    console.error("[store] deleteAllGrades error:", error);
    throw new Error("could not delete grades");
  }
}
