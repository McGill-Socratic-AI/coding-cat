/**
 * Tests for the research export's pure logic.
 *
 *   node --test scripts/
 *
 * Most of these pin defects an adversarial review found in the first version.
 * They are the parts that decide who is in the dataset and what leaves the
 * building, so a regression here is a privacy or data-integrity failure, not a
 * cosmetic one.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assertDeidentified,
  assertPseudonymContract,
  buildRows,
  computePseudonym,
  consentedProfileIds,
  EXPORT_COLUMNS,
  isoWeek,
  KAT_EXPECTED,
  KAT_SALT,
  KAT_USER,
  latestConsentByProfile,
  reduceGrades,
  toCsv,
} from "./research-export-lib.mjs";

const VERSION = "2026-08-comp204-v1";
const P = (n) => String(n).repeat(64).slice(0, 64);

// --- pseudonym -------------------------------------------------------------

test("reproduces the cross-implementation known-answer vector", () => {
  assert.equal(computePseudonym(KAT_SALT, KAT_USER), KAT_EXPECTED);
  assert.doesNotThrow(assertPseudonymContract);
});

test("different users and different salts give different pseudonyms", () => {
  assert.notEqual(
    computePseudonym(KAT_SALT, "a"),
    computePseudonym(KAT_SALT, "b"),
  );
  assert.notEqual(
    computePseudonym(KAT_SALT, KAT_USER),
    computePseudonym("f".repeat(32), KAT_USER),
  );
});

test("an empty user id is refused rather than hashed", () => {
  assert.throws(() => computePseudonym(KAT_SALT, ""));
});

// --- consent gating --------------------------------------------------------
//
// The review's finding: the export included every student with usage, whether
// or not they had consented, and kept withdrawn students because withdrawal
// deletes grades but not the usage rows in ordinary application tables.

test("latestConsentByProfile takes the last row, since the ledger is append-only", () => {
  const latest = latestConsentByProfile([
    { id: 1, profile_id: "u1", action: "granted", consent_version: VERSION },
    { id: 2, profile_id: "u1", action: "withdrawn", consent_version: VERSION },
    { id: 3, profile_id: "u2", action: "granted", consent_version: VERSION },
  ]);
  assert.equal(latest.get("u1").action, "withdrawn");
  assert.equal(latest.get("u2").action, "granted");
});

test("a student who re-consents after withdrawing is included again", () => {
  const latest = latestConsentByProfile([
    { id: 1, profile_id: "u1", action: "granted", consent_version: VERSION },
    { id: 2, profile_id: "u1", action: "withdrawn", consent_version: VERSION },
    { id: 3, profile_id: "u1", action: "granted", consent_version: VERSION },
  ]);
  assert.deepEqual([...consentedProfileIds(latest, VERSION)], ["u1"]);
});

test("withdrawn and never-consented students are excluded", () => {
  const latest = latestConsentByProfile([
    { id: 1, profile_id: "granted", action: "granted", consent_version: VERSION },
    { id: 2, profile_id: "gone", action: "granted", consent_version: VERSION },
    { id: 3, profile_id: "gone", action: "withdrawn", consent_version: VERSION },
  ]);
  const ids = consentedProfileIds(latest, VERSION);
  assert.ok(ids.has("granted"));
  assert.ok(!ids.has("gone"));
  assert.ok(!ids.has("never-in-the-ledger"));
});

test("consent to superseded wording does not count", () => {
  const latest = latestConsentByProfile([
    { id: 1, profile_id: "u1", action: "granted", consent_version: "old-v0" },
  ]);
  assert.equal(consentedProfileIds(latest, VERSION).size, 0);
});

// --- grade reduction -------------------------------------------------------

test("reduceGrades keeps the last write per item, ordered by id", () => {
  const { byPseudonym } = reduceGrades(
    [
      { id: 1, pseudonym: P(1), item_key: "exam_1", score: "55", consent_version: VERSION },
      { id: 2, pseudonym: P(1), item_key: "exam_1", score: "91", consent_version: VERSION },
      { id: 3, pseudonym: P(1), item_key: "exam_2", score: "70", consent_version: VERSION },
    ],
    new Set([P(1)]),
  );
  assert.equal(byPseudonym.get(P(1)).exam_1, 91);
  assert.equal(byPseudonym.get(P(1)).exam_2, 70);
});

test("reduceGrades coerces PostgREST's string NUMERIC to a number", () => {
  const { byPseudonym } = reduceGrades(
    [{ id: 1, pseudonym: P(1), item_key: "exam_1", score: "87.50", consent_version: VERSION }],
    new Set([P(1)]),
  );
  assert.equal(byPseudonym.get(P(1)).exam_1, 87.5);
});

test("consent_version reflects the most recent report, not an arbitrary row", () => {
  // The review's finding: the version was taken from whichever row was reduced
  // first, mislabelling scores after a wording change.
  const { byPseudonym } = reduceGrades(
    [
      { id: 1, pseudonym: P(1), item_key: "exam_1", score: "70", consent_version: "old-v0" },
      { id: 2, pseudonym: P(1), item_key: "exam_2", score: "80", consent_version: VERSION },
    ],
    new Set([P(1)]),
  );
  assert.equal(byPseudonym.get(P(1)).consent_version, VERSION);
});

test("grade rows whose owner is not consenting are dropped and counted", () => {
  const { byPseudonym, orphans } = reduceGrades(
    [
      { id: 1, pseudonym: P(1), item_key: "exam_1", score: "70", consent_version: VERSION },
      { id: 2, pseudonym: P(2), item_key: "exam_1", score: "80", consent_version: VERSION },
    ],
    new Set([P(1)]),
  );
  assert.equal(byPseudonym.size, 1);
  assert.equal(orphans, 1);
});

// --- row building ----------------------------------------------------------

function usageEntry(over = {}) {
  return {
    analyses: 3,
    analysed_problems: new Set(["a", "b"]),
    submissions: 9,
    solved_problems: new Set(["a"]),
    active_days: new Set(["2026-09-08", "2026-09-09"]),
    tutor_sessions: 2,
    tutor_turns: 11,
    first_activity: "2026-09-08T14:03:11.204331+00:00",
    last_activity: "2026-11-27T19:41:02.881107+00:00",
    ...over,
  };
}

test("no exact timestamp reaches the output; weeks only", () => {
  // The review's highest-severity finding: microsecond timestamps copied from
  // uid-keyed tables re-identified every row once the salt was destroyed.
  const rows = buildRows(
    new Set([P(1)]),
    new Map(),
    new Map([[P(1), usageEntry()]]),
    VERSION,
  );
  assert.equal(rows[0].first_activity_week, "2026-W37");
  assert.equal(rows[0].last_activity_week, "2026-W48");

  const csv = toCsv(rows, EXPORT_COLUMNS);
  assert.ok(!csv.includes("14:03:11"), "no time-of-day may survive");
  assert.ok(!csv.includes("204331"), "no microseconds may survive");
  assert.doesNotThrow(() => assertDeidentified("study.csv", csv));
});

test("a consenting student with no activity is a zero row, not absent", () => {
  const rows = buildRows(new Set([P(1)]), new Map(), new Map(), VERSION);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].analyses, 0);
  assert.equal(rows[0].reported_any_grade, 0);
  assert.equal(rows[0].first_activity_week, "");
});

test("only consenting pseudonyms produce rows, even with usage recorded", () => {
  const rows = buildRows(
    new Set([P(1)]),
    new Map(),
    new Map([[P(1), usageEntry()], [P(2), usageEntry()]]),
    VERSION,
  );
  assert.deepEqual(rows.map((r) => r.pseudonym), [P(1)]);
});

test("absent scores are blank rather than zero", () => {
  const rows = buildRows(
    new Set([P(1)]),
    new Map([[P(1), { pseudonym: P(1), exam_1: 0, consent_version: VERSION }]]),
    new Map(),
    VERSION,
  );
  assert.equal(rows[0].exam_1, 0, "a real zero stays zero");
  assert.equal(rows[0].exam_2, "", "an unreported item is blank, never 0");
});

// --- isoWeek ---------------------------------------------------------------

test("isoWeek handles year boundaries the ISO way", () => {
  // 2027-01-01 is a Friday, so it belongs to ISO week 53 of 2026.
  assert.equal(isoWeek("2027-01-01T00:00:00Z"), "2026-W53");
  assert.equal(isoWeek("2026-01-01T00:00:00Z"), "2026-W01");
  assert.equal(isoWeek("2026-09-08T14:03:11.204331+00:00"), "2026-W37");
});

test("isoWeek is empty for missing or unparseable input", () => {
  assert.equal(isoWeek(null), "");
  assert.equal(isoWeek(undefined), "");
  assert.equal(isoWeek(""), "");
  assert.equal(isoWeek("not a date"), "");
});

test("isoWeek collapses a whole week to one value", () => {
  const monday = isoWeek("2026-09-07T00:00:00Z");
  const sunday = isoWeek("2026-09-13T23:59:59Z");
  assert.equal(monday, sunday);
});

// --- CSV -------------------------------------------------------------------

test("toCsv quotes commas, quotes, newlines and carriage returns", () => {
  const csv = toCsv(
    [
      { a: "x,y" },
      { a: 'say "hi"' },
      { a: "line1\nline2" },
      { a: "line1\rline2" },
    ],
    ["a"],
  );
  const lines = csv.split("\n");
  assert.equal(lines[0], "a");
  assert.equal(lines[1], '"x,y"');
  assert.equal(lines[2], '"say ""hi"""');
  assert.ok(csv.includes('"line1\nline2"'));
  assert.ok(csv.includes('"line1\rline2"'), "a bare CR must be quoted too");
});

test("toCsv writes null and undefined as empty, not the words", () => {
  const csv = toCsv([{ a: null, b: undefined, c: 0 }], ["a", "b", "c"]);
  assert.equal(csv.split("\n")[1], ",,0");
});

// --- the de-identification guard -------------------------------------------

test("assertDeidentified passes a pseudonym-only row", () => {
  assert.doesNotThrow(() =>
    assertDeidentified("study.csv", `pseudonym,exam_1\n${P(1)},88\n`),
  );
});

test("assertDeidentified refuses a leaked UUID", () => {
  assert.throws(
    () => assertDeidentified("study.csv", "a\n97ca89f6-ca97-49d8-99ac-b7cbc1324616\n"),
    /raw UUID/,
  );
});

test("assertDeidentified refuses a leaked email", () => {
  assert.throws(
    () => assertDeidentified("study.csv", "a\nxiding.hu@mail.mcgill.ca\n"),
    /email address/,
  );
});

test("assertDeidentified refuses a precise timestamp", () => {
  // This guard exists because the timestamps were the actual re-identification
  // vector, not a hypothetical one.
  assert.throws(
    () => assertDeidentified("study.csv", "a\n2026-09-08T14:03:11.204331+00:00\n"),
    /precise timestamp/,
  );
  assert.throws(
    () => assertDeidentified("study.csv", "a\n2026-09-08 14:03\n"),
    /precise timestamp/,
  );
});

test("assertDeidentified allows an ISO week and a plain date", () => {
  assert.doesNotThrow(() => assertDeidentified("study.csv", "a\n2026-W37\n"));
  assert.doesNotThrow(() => assertDeidentified("study.csv", "a\n2026-09-08\n"));
});
