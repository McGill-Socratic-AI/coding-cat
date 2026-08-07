#!/usr/bin/env node
/**
 * research-export — build the COMP204 study dataset.
 *
 * Joins self-reported grades to Socratic-AI usage on the research pseudonym,
 * and writes a dataset in which no raw user id, email, name or student number
 * appears.
 *
 * THE JOIN
 * --------
 * Grades are stored keyed by HMAC-SHA256(RESEARCH_SALT, auth.uid()) and nothing
 * else — the table has no user column at all. Usage lives in tables keyed by
 * the raw uid. This script is the only place the two ever meet: it reads the
 * uid-keyed side, applies the *same* HMAC, and emits rows keyed only by the
 * pseudonym. The uid is used in memory and never written out.
 *
 * That makes this script the counterpart of
 * supabase/functions/submit-grades/pseudonym.ts. If the two implementations
 * ever disagree, every join silently yields zero matches and the study data
 * looks like nobody used the tutor. Both sides therefore assert the same
 * known-answer vector, and this script refuses to run if its own HMAC is wrong.
 *
 * AFTER THE EXPORT
 * ----------------
 * Destroy RESEARCH_SALT. Until it is destroyed the dataset is pseudonymous and
 * the holder of the salt can re-identify; once it is gone the retained data is
 * anonymous. That is the commitment made in the consent text, so it is a step
 * in the protocol, not an optional tidy-up.
 *
 * USAGE
 *   node scripts/research-export.mjs --out ./export
 *
 * REQUIRED ENV (coding-cat project)
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEARCH_SALT
 *
 * OPTIONAL ENV (socratic-assistant project — richer tutoring metrics)
 *   SOCRATIC_SUPABASE_URL, SOCRATIC_SERVICE_ROLE_KEY
 *   SOCRATIC_PLATFORM_ID        (default: coding-cat-comp204)
 *   SOCRATIC_COURSE_OFFERING_ID (default: comp204-f2026)
 *
 * Without the socratic credentials the export still works and falls back to
 * analyze_calls, which lives in the same project and is a perfectly good usage
 * proxy: one row per analysis request, with problem name and timestamp.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

// --- pseudonym -------------------------------------------------------------

const MIN_SALT_LEN = 32; // matches pseudonym.ts

function computePseudonym(salt, userId) {
  if (!userId) throw new Error("cannot derive a pseudonym from an empty user id");
  return createHmac("sha256", salt).update(userId, "utf8").digest("hex");
}

// Same vector asserted by supabase/functions/submit-grades/pseudonym_test.ts.
const KAT_SALT = "0123456789abcdef0123456789abcdef";
const KAT_USER = "97ca89f6-ca97-49d8-99ac-b7cbc1324616";
const KAT_EXPECTED =
  "2d835d79088ff7335bc58ad516666a5c2b8403fba704b13f1ba282a536a84b50";

function assertPseudonymContract() {
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

// --- small helpers ---------------------------------------------------------

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

function parseArgs(argv) {
  const args = { out: "./export", limitUsers: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--limit-users") args.limitUsers = Number(argv[++i]);
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(
        "usage: node scripts/research-export.mjs [--out DIR] [--limit-users N]",
      );
      process.exit(0);
    }
  }
  return args;
}

/** Page through a PostgREST table so a large course does not truncate at 1000. */
async function fetchAll(client, table, columns, tweak = (q) => q) {
  const PAGE = 1000;
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await tweak(
      client.from(table).select(columns).range(from, from + PAGE - 1),
    );
    if (error) throw new Error(`reading ${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

function toCsv(rows, columns) {
  const escape = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [
    columns.join(","),
    ...rows.map((r) => columns.map((c) => escape(r[c])).join(",")),
  ].join("\n") + "\n";
}

const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/;

/**
 * Last line of defence before anything hits disk.
 *
 * The whole point of the export is that identifiers do not leave the database,
 * so a bug that leaks one must stop the run rather than produce a file someone
 * then shares. Cheap to check, catastrophic to miss.
 */
function assertDeidentified(name, content) {
  const uuid = content.match(UUID_RE);
  if (uuid) {
    throw new Error(
      `${name} contains what looks like a raw UUID (${uuid[0]}). Refusing to write.`,
    );
  }
  const email = content.match(EMAIL_RE);
  if (email) {
    throw new Error(
      `${name} contains what looks like an email address (${email[0]}). Refusing to write.`,
    );
  }
}

const GRADE_ITEMS = [
  "exam_1",
  "exam_2",
  "exam_3",
  "assignment_1",
  "assignment_2",
  "assignment_3",
  "assignment_4",
];

// --- main ------------------------------------------------------------------

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

  // 1. Every account, so we can map uid -> pseudonym. Read from auth via the
  //    admin API rather than profiles: a user with no profile row still has
  //    submissions and analyze_calls.
  console.error("reading accounts...");
  const uidToPseudonym = new Map();
  for (let page = 1; ; page++) {
    const { data, error } = await cc.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listing users: ${error.message}`);
    const users = data?.users ?? [];
    if (users.length === 0) break;
    for (const u of users) uidToPseudonym.set(u.id, computePseudonym(salt, u.id));
    if (args.limitUsers && uidToPseudonym.size >= args.limitUsers) break;
    if (users.length < 1000) break;
  }
  console.error(`  ${uidToPseudonym.size} accounts`);

  // 2. Grades. Already pseudonymous; we only reduce the append-only log to the
  //    latest value per (pseudonym, item).
  console.error("reading self-reported grades...");
  const gradeRows = await fetchAll(
    cc,
    "self_reported_grades",
    "pseudonym, item_key, score, consent_version, submitted_at",
  );
  const latestGrade = new Map(); // `${pseudonym}|${item}` -> row
  for (const row of gradeRows) {
    const key = `${row.pseudonym}|${row.item_key}`;
    const seen = latestGrade.get(key);
    if (!seen || new Date(row.submitted_at) > new Date(seen.submitted_at)) {
      latestGrade.set(key, row);
    }
  }
  const gradesByPseudonym = new Map();
  for (const row of latestGrade.values()) {
    const entry = gradesByPseudonym.get(row.pseudonym) ?? {
      pseudonym: row.pseudonym,
      consent_version: row.consent_version,
    };
    entry[row.item_key] = Number(row.score);
    gradesByPseudonym.set(row.pseudonym, entry);
  }
  console.error(
    `  ${gradeRows.length} rows -> ${gradesByPseudonym.size} students with at least one score`,
  );

  // 3. Usage inside the coding-cat project.
  console.error("reading analyze_calls...");
  const analyzeRows = await fetchAll(
    cc,
    "analyze_calls",
    "user_id, problem_name, latency_ms, created_at",
  );

  console.error("reading submissions...");
  const submissionRows = await fetchAll(
    cc,
    "submissions",
    "profile_id, problem_title, passed_tests, total_tests, submitted_at",
  );

  const usage = new Map(); // pseudonym -> aggregate
  const bump = (uid, fn) => {
    const pseudonym = uidToPseudonym.get(uid);
    if (!pseudonym) return; // deleted account
    const entry = usage.get(pseudonym) ?? {
      pseudonym,
      analyses: 0,
      analysed_problems: new Set(),
      first_activity: null,
      last_activity: null,
      submissions: 0,
      solved_problems: new Set(),
      active_days: new Set(),
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
    `  ${analyzeRows.length} analyses, ${submissionRows.length} submissions`,
  );

  // 4. Optional: richer tutoring metrics from the socratic-assistant project.
  //
  //    Aggregates only — turn counts and token totals, never the text of a
  //    conversation. ADR-0006 withholds raw turns from teachers because being
  //    read changes how students struggle; the argument carries over to a
  //    research export, so raw text stays put unless someone deliberately
  //    decides otherwise and says so in the consent form.
  let socraticNote = "not collected (SOCRATIC_SUPABASE_URL not set)";
  const socraticUrl = process.env.SOCRATIC_SUPABASE_URL;
  const socraticKey = process.env.SOCRATIC_SERVICE_ROLE_KEY;
  if (socraticUrl && socraticKey) {
    const platformId = process.env.SOCRATIC_PLATFORM_ID || "coding-cat-comp204";
    const offeringId = process.env.SOCRATIC_COURSE_OFFERING_ID || "comp204-f2026";
    console.error(`reading socratic sessions (${platformId}/${offeringId})...`);

    const sa = createClient(socraticUrl, socraticKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const sessions = await fetchAll(
      sa,
      "sessions",
      "id, student_id, problem_ref, created_at",
      (q) => q.eq("platform_id", platformId).eq("course_offering_id", offeringId),
    );
    const sessionOwner = new Map(sessions.map((s) => [s.id, s.student_id]));

    const turns = await fetchAll(sa, "turns", "session_id, created_at");
    for (const t of turns) {
      const uid = sessionOwner.get(t.session_id);
      if (!uid) continue;
      bump(uid, (e) => {
        e.tutor_turns = (e.tutor_turns ?? 0) + 1;
        touch(e, t.created_at);
      });
    }
    for (const s of sessions) {
      bump(s.student_id, (e) => {
        e.tutor_sessions = (e.tutor_sessions ?? 0) + 1;
      });
    }
    socraticNote = `${sessions.length} sessions, ${turns.length} turns`;
    console.error(`  ${socraticNote}`);
  } else {
    console.error("skipping socratic metrics (SOCRATIC_SUPABASE_URL not set)");
  }

  // 5. Flatten and join.
  const allPseudonyms = new Set([...gradesByPseudonym.keys(), ...usage.keys()]);
  const joined = [...allPseudonyms].sort().map((pseudonym) => {
    const g = gradesByPseudonym.get(pseudonym) ?? {};
    const u = usage.get(pseudonym);
    const row = {
      pseudonym,
      consent_version: g.consent_version ?? "",
      reported_any_grade: gradesByPseudonym.has(pseudonym) ? 1 : 0,
      analyses: u?.analyses ?? 0,
      analysed_problems: u ? u.analysed_problems.size : 0,
      submissions: u?.submissions ?? 0,
      solved_problems: u ? u.solved_problems.size : 0,
      active_days: u ? u.active_days.size : 0,
      tutor_sessions: u?.tutor_sessions ?? 0,
      tutor_turns: u?.tutor_turns ?? 0,
      first_activity: u?.first_activity ?? "",
      last_activity: u?.last_activity ?? "",
    };
    for (const item of GRADE_ITEMS) {
      row[item] = g[item] ?? "";
    }
    return row;
  });

  const columns = [
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
    "first_activity",
    "last_activity",
  ];

  const csv = toCsv(joined, columns);

  const withGrades = joined.filter((r) => r.reported_any_grade === 1);
  const withBoth = withGrades.filter((r) => r.analyses > 0 || r.tutor_turns > 0);

  const readme = [
    "# COMP204 study export",
    "",
    `Generated from ${supabaseUrl}`,
    "",
    `- accounts seen: ${uidToPseudonym.size}`,
    `- students reporting at least one grade: ${withGrades.length}`,
    `- of those, with any recorded tutor usage: ${withBoth.length}`,
    `- socratic metrics: ${socraticNote}`,
    "",
    "## Keys",
    "",
    "`pseudonym` is HMAC-SHA256(RESEARCH_SALT, auth.uid()). It is stable across",
    "this dataset and meaningless outside it. No raw account identifier, email,",
    "name or student number appears in any file here.",
    "",
    "## Before sharing",
    "",
    "Destroy RESEARCH_SALT. Until it is destroyed this dataset is pseudonymous",
    "and whoever holds the salt can re-identify participants. Once it is gone,",
    "the data is anonymous — which is what the consent text promised.",
    "",
    "## Caveats",
    "",
    "- Grades are self-reported and unverified against official records.",
    "- Absent scores are blank, not zero. Do not impute.",
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
  console.error(`  ${withGrades.length} students reported at least one grade`);
  console.error(`  ${withBoth.length} of those have recorded tutor usage`);
  console.error("");
  console.error("Now destroy RESEARCH_SALT to make this dataset anonymous.");
}

main().catch((e) => {
  console.error(`\n${e.message}`);
  process.exit(1);
});
