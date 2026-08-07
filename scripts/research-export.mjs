#!/usr/bin/env node
/**
 * research-export — build the COMP204 study dataset.
 *
 * Joins self-reported grades to Socratic-AI usage on the research pseudonym and
 * writes a dataset containing no direct identifier.
 *
 * THE JOIN
 * --------
 * Grades are stored keyed by HMAC-SHA256(RESEARCH_SALT, auth.uid()) and nothing
 * else — the table has no user column at all. Usage lives in tables keyed by the
 * raw uid. This script is the only place the two ever meet: it reads the
 * uid-keyed side, applies the same HMAC in memory, and emits rows keyed only by
 * the pseudonym.
 *
 * That makes this the counterpart of
 * supabase/functions/submit-grades/pseudonym.ts. If the two implementations ever
 * disagree, every join silently yields zero matches and the result looks exactly
 * like "nobody used the tutor". Both assert the same known-answer vector, and
 * this script refuses to run if it cannot reproduce it.
 *
 * WHAT DESTROYING THE SALT DOES AND DOES NOT BUY
 * ----------------------------------------------
 * Destroying RESEARCH_SALT removes the *direct* route from a pseudonym back to
 * an account. It does not by itself make the dataset unlinkable, and an earlier
 * version of this script wrongly implied it did.
 *
 * The problem is quasi-identifiers. Every per-student number here — analyses,
 * submissions, active days, tutor turns — also exists, keyed by raw uid, in the
 * operational database, so an adversary holding both can try to match on the
 * combination. Exact timestamps were by far the worst offender: first/last
 * activity were emitted at microsecond precision, unique per student
 * essentially always, so one equality join re-identified every row. They are now
 * coarsened to the ISO week, and assertDeidentified refuses to write any file
 * still containing a precise timestamp.
 *
 * Coarsening helps a great deal and does not finish the job: behavioural counts
 * remain distinctive. The real mitigation is retention — the operational tables
 * carrying the uid-keyed side must not outlive the study. That is a protocol
 * step, recorded in docs/comp204-deployment.md, not something this script can
 * enforce.
 *
 * CONSENT IS ENFORCED HERE
 * ------------------------
 * Only students whose latest research_consent row is a grant at the current
 * version appear at all. Withdrawal deletes a student's grades, but their usage
 * rows live in ordinary application tables that nothing deletes, so without this
 * filter a withdrawn student would still contribute a full usage row under their
 * stable pseudonym.
 *
 * USAGE
 *   node scripts/research-export.mjs --out ./export
 *
 * REQUIRED ENV (coding-cat project)
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEARCH_SALT
 *
 * OPTIONAL ENV (socratic-assistant project — richer tutoring metrics)
 *   SOCRATIC_SUPABASE_URL, SOCRATIC_SERVICE_ROLE_KEY
 *   SOCRATIC_PLATFORM_ID      (default: coding-cat-comp204)
 *   SOCRATIC_COURSE_OFFERING  (default: comp204-f2026 — the same variable name
 *                              the analyze function writes under, so one value
 *                              configures both sides)
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

import {
  assertDeidentified,
  assertPseudonymContract,
  buildRows,
  computePseudonym,
  consentedProfileIds,
  EXPORT_COLUMNS,
  KAT_SALT,
  latestConsentByProfile,
  MIN_SALT_LEN,
  reduceGrades,
  toCsv,
} from "./research-export-lib.mjs";

// Must match CONSENT_VERSION in supabase/functions/submit-grades/consent.ts.
const CONSENT_VERSION = process.env.CONSENT_VERSION || "2026-08-comp204-v1";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

function parseArgs(argv) {
  const args = { out: "./export" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log("usage: node scripts/research-export.mjs [--out DIR]");
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${argv[i]}`);
      process.exit(1);
    }
  }
  return args;
}

/**
 * Page through a PostgREST table.
 *
 * Two things here are load-bearing:
 *
 * 1. `.order(orderBy)` is not decoration. LIMIT/OFFSET over an unordered query
 *    has no stable row order — Postgres may return the same row on two pages and
 *    omit another entirely. Silent duplication and loss in a research dataset is
 *    about the worst failure available, so paging is always ordered by a unique
 *    key.
 *
 * 2. The loop advances by the number of rows actually returned and stops only on
 *    an empty page. A PostgREST instance can cap responses below the requested
 *    range (db-max-rows); treating a short page as "the last page" would
 *    silently truncate the read at that cap.
 */
async function fetchAll(client, table, columns, orderBy, tweak = (q) => q) {
  const PAGE = 1000;
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await tweak(
      client
        .from(table)
        .select(columns)
        .order(orderBy, { ascending: true })
        .range(from, from + PAGE - 1),
    );
    if (error) throw new Error(`reading ${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    from += data.length;
  }
  return rows;
}

async function main() {
  assertPseudonymContract();

  const args = parseArgs(process.argv.slice(2));

  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const salt = requireEnv("RESEARCH_SALT");

  if (salt.length < MIN_SALT_LEN) {
    console.error(
      `RESEARCH_SALT must be at least ${MIN_SALT_LEN} characters (got ${salt.length}).`,
    );
    process.exit(1);
  }
  if (salt === KAT_SALT) {
    console.error(
      "RESEARCH_SALT is the value used in the test vector. Refusing to export " +
        "real data under a publicly known salt.",
    );
    process.exit(1);
  }

  const cc = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Consent decides who is in the study at all.
  console.error("reading consent ledger...");
  const consentRows = await fetchAll(
    cc,
    "research_consent",
    "id, profile_id, consent_version, action, created_at",
    "id",
  );
  const latestConsent = latestConsentByProfile(consentRows);
  const consentedUids = consentedProfileIds(latestConsent, CONSENT_VERSION);

  const withdrawn = [...latestConsent.values()].filter(
    (r) => r.action === "withdrawn",
  ).length;
  console.error(
    `  ${consentedUids.size} currently consenting, ${withdrawn} withdrawn, ` +
      `${latestConsent.size - consentedUids.size - withdrawn} on a superseded version`,
  );

  if (consentedUids.size === 0) {
    console.error(
      `\nNo student has consented at version ${CONSENT_VERSION}, so there is ` +
        "nothing to export. If the consent wording changed recently, everyone " +
        "has to agree again.",
    );
    process.exit(1);
  }

  // 2. uid -> pseudonym, for consenting students only.
  const uidToPseudonym = new Map();
  for (const uid of consentedUids) {
    uidToPseudonym.set(uid, computePseudonym(salt, uid));
  }
  const consentedPseudonyms = new Set(uidToPseudonym.values());

  // 3. Grades — already pseudonymous; reduce the append-only log to the latest
  //    value per (pseudonym, item).
  console.error("reading self-reported grades...");
  const gradeRows = await fetchAll(
    cc,
    "self_reported_grades",
    "id, pseudonym, item_key, score, consent_version, submitted_at",
    "id",
  );
  const { byPseudonym: gradesByPseudonym, orphans } = reduceGrades(
    gradeRows,
    consentedPseudonyms,
  );
  console.error(
    `  ${gradeRows.length} rows -> ${gradesByPseudonym.size} students with at least one score` +
      (orphans ? ` (${orphans} rows ignored: no current consent)` : ""),
  );

  // 4. Usage inside the coding-cat project.
  console.error("reading analyze_calls...");
  const analyzeRows = await fetchAll(
    cc,
    "analyze_calls",
    "id, user_id, problem_name, created_at",
    "id",
  );

  console.error("reading submissions...");
  const submissionRows = await fetchAll(
    cc,
    "submissions",
    "submission_id, profile_id, problem_title, passed_tests, total_tests, submitted_at",
    "submission_id",
  );

  const usage = new Map();
  let skippedNonConsenting = 0;

  const bump = (uid, fn) => {
    const pseudonym = uidToPseudonym.get(uid);
    if (!pseudonym) {
      // Not consenting, withdrawn, on a superseded version, or a deleted
      // account. Counted so the run reports it rather than quietly dropping it.
      skippedNonConsenting++;
      return;
    }
    const entry = usage.get(pseudonym) ?? {
      pseudonym,
      analyses: 0,
      analysed_problems: new Set(),
      submissions: 0,
      solved_problems: new Set(),
      active_days: new Set(),
      tutor_sessions: 0,
      tutor_turns: 0,
      first_activity: null,
      last_activity: null,
    };
    fn(entry);
    usage.set(pseudonym, entry);
  };

  const touch = (entry, iso) => {
    if (!iso) return;
    if (!entry.first_activity || iso < entry.first_activity) entry.first_activity = iso;
    if (!entry.last_activity || iso > entry.last_activity) entry.last_activity = iso;
    entry.active_days.add(iso.slice(0, 10));
  };

  for (const r of analyzeRows) {
    bump(r.user_id, (e) => {
      e.analyses += 1;
      e.analysed_problems.add(r.problem_name);
      touch(e, r.created_at);
    });
  }
  for (const r of submissionRows) {
    bump(r.profile_id, (e) => {
      e.submissions += 1;
      if (r.total_tests > 0 && r.passed_tests === r.total_tests) {
        e.solved_problems.add(r.problem_title);
      }
      touch(e, r.submitted_at);
    });
  }
  console.error(
    `  ${analyzeRows.length} analyses, ${submissionRows.length} submissions ` +
      `(${skippedNonConsenting} rows from non-consenting accounts excluded)`,
  );

  // 5. Optional: richer tutoring metrics from the socratic-assistant project.
  //
  //    Aggregates only — turn counts, never conversation text. ADR-0006
  //    withholds raw turns from teachers because being read changes how students
  //    struggle; that argument carries over to a research export.
  let socraticNote = "not collected (SOCRATIC_SUPABASE_URL not set)";
  const socraticUrl = process.env.SOCRATIC_SUPABASE_URL;
  const socraticKey = process.env.SOCRATIC_SERVICE_ROLE_KEY;
  if (socraticUrl && socraticKey) {
    const platformId = process.env.SOCRATIC_PLATFORM_ID || "coding-cat-comp204";
    // Same variable name the analyze function writes under, so one value
    // configures both sides. The _ID suffix is accepted as an alias because an
    // earlier version of this script used it, and a mismatch here produces an
    // empty read that looks exactly like "nobody used the tutor".
    const offeringId = process.env.SOCRATIC_COURSE_OFFERING ||
      process.env.SOCRATIC_COURSE_OFFERING_ID ||
      "comp204-f2026";
    console.error(`reading socratic sessions (${platformId}/${offeringId})...`);

    const sa = createClient(socraticUrl, socraticKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const sessions = await fetchAll(
      sa,
      "sessions",
      "id, student_id, problem_ref, created_at",
      "id",
      (q) => q.eq("platform_id", platformId).eq("course_offering_id", offeringId),
    );
    const sessionOwner = new Map(sessions.map((s) => [s.id, s.student_id]));

    const turns = await fetchAll(sa, "turns", "id, session_id, created_at", "id");
    let matchedTurns = 0;
    for (const t of turns) {
      const uid = sessionOwner.get(t.session_id);
      if (!uid) continue; // a turn belonging to some other course offering
      matchedTurns++;
      bump(uid, (e) => {
        e.tutor_turns += 1;
        touch(e, t.created_at);
      });
    }
    for (const s of sessions) {
      bump(s.student_id, (e) => {
        e.tutor_sessions += 1;
      });
    }
    socraticNote = `${sessions.length} sessions, ${matchedTurns} turns`;
    console.error(`  ${socraticNote}`);

    if (sessions.length === 0) {
      console.error(
        `  WARNING: no sessions found for ${platformId}/${offeringId}. Check ` +
          "that SOCRATIC_PLATFORM_ID and SOCRATIC_COURSE_OFFERING match what " +
          "the analyze function was deployed with.",
      );
    }
  } else {
    console.error("skipping socratic metrics (SOCRATIC_SUPABASE_URL not set)");
  }

  // 6. Flatten and join.
  const joined = buildRows(
    consentedPseudonyms,
    gradesByPseudonym,
    usage,
    CONSENT_VERSION,
  );
  const csv = toCsv(joined, EXPORT_COLUMNS);

  const withGrades = joined.filter((r) => r.reported_any_grade === 1);
  const withBoth = withGrades.filter((r) => r.analyses > 0 || r.tutor_turns > 0);

  const readme = [
    "# COMP204 study export",
    "",
    `Generated from ${supabaseUrl}`,
    "",
    `- consenting students (version ${CONSENT_VERSION}): ${consentedPseudonyms.size}`,
    `- of those, reporting at least one grade: ${withGrades.length}`,
    `- of those, with recorded tutor usage: ${withBoth.length}`,
    `- socratic metrics: ${socraticNote}`,
    "",
    "## Who is in here",
    "",
    "Only students whose most recent consent decision is a grant at the current",
    "version. Students who never consented, who withdrew, or whose consent",
    "predates a wording change are excluded entirely — including their usage,",
    "which lives in ordinary application tables that withdrawal does not delete.",
    "",
    "## Keys",
    "",
    "`pseudonym` is HMAC-SHA256(RESEARCH_SALT, auth.uid()). It is stable across",
    "this dataset and meaningless outside it. No account identifier, email, name",
    "or student number appears in any file here.",
    "",
    "## Re-identification risk — read before sharing",
    "",
    "Destroy RESEARCH_SALT once you have this dataset. That removes the direct",
    "route from a pseudonym back to an account.",
    "",
    "It does not on its own make these rows unlinkable. Every per-student count",
    "below also exists, keyed by real account id, in the operational database,",
    "so someone holding both could attempt to match on the combination. Activity",
    "dates are reported as ISO weeks rather than timestamps for this reason — at",
    "full precision they were unique per student and would have re-identified",
    "every row with a single join.",
    "",
    "The remaining mitigation is retention: the operational tables carrying the",
    "account-keyed side must not outlive the study. Treat that as part of the",
    "protocol, not as cleanup.",
    "",
    "## Caveats",
    "",
    "- Grades are self-reported and unverified against official records.",
    "- Absent scores are blank, not zero. Do not impute.",
    "- A consenting student with no activity appears as a zero row. That is a",
    "  real outcome, not missing data.",
    "- `tutor_turns` counts turns; conversation text is deliberately not exported",
    "  (see ADR-0006 in the socratic-ai repo).",
    "",
  ].join("\n");

  assertDeidentified("study.csv", csv);
  assertDeidentified("README.md", readme);

  const outDir = resolve(args.out);
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, "study.csv"), csv, "utf8");
  await writeFile(resolve(outDir, "README.md"), readme, "utf8");

  console.error("");
  console.error(`wrote ${outDir}/study.csv (${joined.length} rows)`);
  console.error(`  ${withGrades.length} reported at least one grade`);
  console.error(`  ${withBoth.length} of those have recorded tutor usage`);
  console.error("");
  console.error("Next: destroy RESEARCH_SALT, and read the README for why that");
  console.error("alone does not make the dataset unlinkable.");
}

main().catch((e) => {
  console.error(`\n${e.message}`);
  process.exit(1);
});
