import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normaliseScore, parseRequest, validateGrades } from "./validate.ts";
import { GRADE_ITEMS } from "./types.ts";

function expectInvalid(result: { ok: boolean }, contains?: string) {
  assertEquals(result.ok, false);
  if (contains && !result.ok) {
    const message = (result as { ok: false; message: string }).message;
    assertEquals(
      message.includes(contains),
      true,
      `expected message to contain "${contains}", got "${message}"`,
    );
  }
}

// --- validateGrades --------------------------------------------------------

Deno.test("validateGrades accepts every documented item key", () => {
  for (const key of GRADE_ITEMS) {
    const result = validateGrades({ [key]: 75 });
    assertEquals(result.ok, true, `${key} should be accepted`);
  }
});

Deno.test("validateGrades accepts the 0 and 100 boundaries", () => {
  assertEquals(validateGrades({ exam_1: 0 }).ok, true);
  assertEquals(validateGrades({ exam_1: 100 }).ok, true);
});

Deno.test("validateGrades rejects out-of-range scores", () => {
  expectInvalid(validateGrades({ exam_1: -0.01 }), "between 0 and 100");
  expectInvalid(validateGrades({ exam_1: 100.01 }), "between 0 and 100");
  expectInvalid(validateGrades({ exam_1: 1000 }), "between 0 and 100");
});

Deno.test("validateGrades rejects NaN and Infinity", () => {
  expectInvalid(validateGrades({ exam_1: NaN }));
  expectInvalid(validateGrades({ exam_1: Infinity }));
  expectInvalid(validateGrades({ exam_1: -Infinity }));
});

Deno.test("validateGrades rejects non-numeric scores", () => {
  expectInvalid(validateGrades({ exam_1: "90" }));
  expectInvalid(validateGrades({ exam_1: true }));
  expectInvalid(validateGrades({ exam_1: { value: 90 } }));
  expectInvalid(validateGrades({ exam_1: [90] }));
});

Deno.test("validateGrades rejects unknown item keys", () => {
  expectInvalid(validateGrades({ exam_4: 90 }), "unknown grade item");
  expectInvalid(validateGrades({ final_exam: 90 }), "unknown grade item");
  // A key that would slip past a naive prefix check.
  expectInvalid(validateGrades({ assignment_5: 90 }), "unknown grade item");
});

Deno.test("validateGrades treats null as an explicit clear", () => {
  const result = validateGrades({ exam_1: null });
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.value.exam_1, null);
});

Deno.test("validateGrades rejects empty, non-object and array payloads", () => {
  expectInvalid(validateGrades({}), "at least one item");
  expectInvalid(validateGrades(null), "must be an object");
  expectInvalid(validateGrades([]), "must be an object");
  expectInvalid(validateGrades("exam_1=90"), "must be an object");
  expectInvalid(validateGrades(42), "must be an object");
});

Deno.test("validateGrades rejects more entries than there are items", () => {
  const oversized: Record<string, number> = {};
  for (let i = 0; i < GRADE_ITEMS.length + 1; i++) oversized[`k${i}`] = 50;
  expectInvalid(validateGrades(oversized), "at most");
});

Deno.test("validateGrades rounds to the two decimals the column stores", () => {
  const result = validateGrades({ exam_1: 87.555, exam_2: 12.344 });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.exam_1, 87.56);
    assertEquals(result.value.exam_2, 12.34);
  }
});

Deno.test("normaliseScore keeps whole and one-decimal values intact", () => {
  assertEquals(normaliseScore(90), 90);
  assertEquals(normaliseScore(87.5), 87.5);
  assertEquals(normaliseScore(0), 0);
  assertEquals(normaliseScore(100), 100);
});

// --- parseRequest ----------------------------------------------------------

Deno.test("parseRequest accepts status and withdraw", () => {
  assertEquals(parseRequest({ action: "status" }).ok, true);
  assertEquals(parseRequest({ action: "withdraw" }).ok, true);
});

Deno.test("parseRequest requires a consentVersion on consent", () => {
  expectInvalid(parseRequest({ action: "consent" }), "consentVersion");
  expectInvalid(
    parseRequest({ action: "consent", consentVersion: "" }),
    "consentVersion",
  );
  expectInvalid(
    parseRequest({ action: "consent", consentVersion: 1 }),
    "consentVersion",
  );
  expectInvalid(
    parseRequest({ action: "consent", consentVersion: "x".repeat(101) }),
    "exceeds",
  );

  const ok = parseRequest({
    action: "consent",
    consentVersion: "2026-08-comp204-v1",
  });
  assertEquals(ok.ok, true);
});

Deno.test("parseRequest propagates grade validation failures on submit", () => {
  expectInvalid(
    parseRequest({ action: "submit", grades: { nope: 1 } }),
    "unknown grade item",
  );
  expectInvalid(parseRequest({ action: "submit" }), "must be an object");
});

Deno.test("parseRequest rejects unknown or missing actions", () => {
  expectInvalid(
    parseRequest({ action: "delete_everything" }),
    "action must be one of",
  );
  expectInvalid(parseRequest({}), "action must be one of");
  expectInvalid(parseRequest(null), "must be a JSON object");
  expectInvalid(parseRequest([]), "must be a JSON object");
  expectInvalid(parseRequest("status"), "must be a JSON object");
});

Deno.test("parseRequest ignores fields the action does not use", () => {
  // A client sending extra junk on a status call should not be rejected; we
  // only read what the action needs.
  const result = parseRequest({ action: "status", grades: { exam_1: 9000 } });
  assertEquals(result.ok, true);
});
