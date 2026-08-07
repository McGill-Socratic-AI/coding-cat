/**
 * Pure helpers for research-export.mjs.
 *
 * Split out so the parts that decide *who is in the dataset* and *what leaves
 * the building* can be tested without a database. An adversarial review of the
 * first version found four real defects in exactly this logic — consenting
 * students not being filtered, timestamps re-identifying every row, unordered
 * paging duplicating rows, consent_version taken from an arbitrary row — none of
 * which were reachable by a test at the time because it was all inline in a CLI.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const MIN_SALT_LEN = 32; // matches supabase/functions/submit-grades/pseudonym.ts

export const GRADE_ITEMS = [
  "exam_1",
  "exam_2",
  "exam_3",
  "assignment_1",
  "assignment_2",
  "assignment_3",
  "assignment_4",
];

// Known-answer vector, also asserted by
// supabase/functions/submit-grades/pseudonym_test.ts. The two implementations
// must agree byte for byte or the join silently yields nothing.
export const KAT_SALT = "0123456789abcdef0123456789abcdef";
export const KAT_USER = "97ca89f6-ca97-49d8-99ac-b7cbc1324616";
export const KAT_EXPECTED =
  "2d835d79088ff7335bc58ad516666a5c2b8403fba704b13f1ba282a536a84b50";

export function computePseudonym(salt, userId) {
  if (!userId) throw new Error("cannot derive a pseudonym from an empty user id");
  return createHmac("sha256", salt).update(userId, "utf8").digest("hex");
}

export function assertPseudonymContract() {
  const actual = computePseudonym(KAT_SALT, KAT_USER);
  const a = Buffer.from(actual, "hex");
  const b = Buffer.from(KAT_EXPECTED, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error(
      "pseudonym known-answer test FAILED.\n" +
        `  expected ${KAT_EXPECTED}\n` +
        `  actual   ${actual}\n` +
        "This script and the submit-grades Edge Function must derive pseudonyms\n" +
        "identically or the join silently produces zero matches. Refusing to run.",
    );
  }
}

/** ISO week (e.g. 2026-W37) — coarse enough not to be a join key on its own. */
export function isoWeek(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // Thursday of the current week determines the ISO year.
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function toCsv(rows, columns) {
  const escape = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    // \r as well as \n: a bare CR inside an unquoted field splits the row for
    // CRLF-aware readers such as Excel.
    return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [
    columns.join(","),
    ...rows.map((r) => columns.map((c) => escape(r[c])).join(",")),
  ].join("\n") + "\n";
}

const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/;
// A surviving high-precision timestamp is a near-unique join key back into the
// account-keyed tables. Everything time-like in the output must be an ISO week.
const TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/**
 * Last line of defence before anything reaches disk. A bug that leaks an
 * identifier must stop the run rather than produce a file someone then shares.
 */
export function assertDeidentified(name, content) {
  const checks = [
    [UUID_RE, "a raw UUID"],
    [EMAIL_RE, "an email address"],
    [TIMESTAMP_RE, "a precise timestamp (these re-identify; use isoWeek)"],
  ];
  for (const [re, what] of checks) {
    const hit = content.match(re);
    if (hit) {
      throw new Error(
        `${name} contains what looks like ${what} (${hit[0]}). Refusing to write.`,
      );
    }
  }
}

/**
 * Latest consent event per student.
 *
 * `rows` must be ordered by `id` ascending; research_consent is append-only, so
 * the last row for a profile is its current state.
 */
export function latestConsentByProfile(rows) {
  const latest = new Map();
  for (const row of rows) latest.set(row.profile_id, row);
  return latest;
}

/**
 * Students in the study: most recent decision is a grant, at the current
 * version.
 *
 * Withdrawal deletes a student's grades, but their usage rows live in ordinary
 * application tables that nothing deletes. Without this filter a withdrawn
 * student would still contribute a full usage row under their stable pseudonym.
 */
export function consentedProfileIds(latestConsent, version) {
  const ids = new Set();
  for (const [profileId, row] of latestConsent) {
    if (row.action === "granted" && row.consent_version === version) {
      ids.add(profileId);
    }
  }
  return ids;
}

/**
 * Reduce the append-only grade log to the latest score per (pseudonym, item),
 * dropping anything belonging to a student who is not currently consenting.
 *
 * `rows` must be ordered by `id` ascending so later writes win — including for
 * `consent_version`, which must reflect the version the student's most recent
 * report was made under, not whichever row happened to be seen first.
 */
export function reduceGrades(rows, consentedPseudonyms) {
  const byPseudonym = new Map();
  let orphans = 0;
  for (const row of rows) {
    if (!consentedPseudonyms.has(row.pseudonym)) {
      orphans++;
      continue;
    }
    const entry = byPseudonym.get(row.pseudonym) ?? { pseudonym: row.pseudonym };
    entry[row.item_key] = Number(row.score);
    entry.consent_version = row.consent_version;
    byPseudonym.set(row.pseudonym, entry);
  }
  return { byPseudonym, orphans };
}

export const EXPORT_COLUMNS = [
  "pseudonym",
  "consent_version",
  "reported_any_grade",
  ...GRADE_ITEMS,
  "analyses",
  "analysed_problems",
  "submissions",
  "solved_problems",
  "active_days",
  "tutor_sessions",
  "tutor_turns",
  "first_activity_week",
  "last_activity_week",
];

/**
 * One row per consenting student.
 *
 * A consenting student with no activity still appears, as a zero row: "consented
 * and never used it" is a real and interesting outcome, not missing data.
 */
export function buildRows(consentedPseudonyms, gradesByPseudonym, usage, version) {
  return [...consentedPseudonyms].sort().map((pseudonym) => {
    const g = gradesByPseudonym.get(pseudonym) ?? {};
    const u = usage.get(pseudonym);
    const row = {
      pseudonym,
      consent_version: g.consent_version ?? version,
      reported_any_grade: gradesByPseudonym.has(pseudonym) ? 1 : 0,
      analyses: u?.analyses ?? 0,
      analysed_problems: u ? u.analysed_problems.size : 0,
      submissions: u?.submissions ?? 0,
      solved_problems: u ? u.solved_problems.size : 0,
      active_days: u ? u.active_days.size : 0,
      tutor_sessions: u?.tutor_sessions ?? 0,
      tutor_turns: u?.tutor_turns ?? 0,
      // Coarsened deliberately. At full precision these are unique per student
      // and re-identify every row against the operational tables.
      first_activity_week: isoWeek(u?.first_activity),
      last_activity_week: isoWeek(u?.last_activity),
    };
    for (const item of GRADE_ITEMS) row[item] = g[item] ?? "";
    return row;
  });
}
