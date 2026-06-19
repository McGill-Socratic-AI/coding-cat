import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildStudentMessage, buildSocraticRequest } from "./socratic.ts";
import type { AnalyzeRequest } from "./types.ts";

function makeRequest(overrides: Partial<AnalyzeRequest> = {}): AnalyzeRequest {
  return {
    meta: {
      name: "two-sum",
      title: "Two Sum",
      difficulty: "easy",
      author: "admin",
      category: "arrays",
      question_type: ["standard"],
    },
    description: "Given an array of integers, return indices of two numbers that add up to target.",
    io: [],
    starter: "def two_sum(nums, target):\n    pass\n",
    code: "def two_sum(nums, target):\n    return [0, 1]\n",
    testReport: [
      { input: "[2,7,11,15]", expected: "[0,1]", actual: "[0,1]", equal: true },
    ],
    ...overrides,
  };
}

// --- buildStudentMessage ---

Deno.test("buildStudentMessage: all-pass mentions improving/optimizing", () => {
  const req = makeRequest({
    testReport: [
      { input: "[2,7]", expected: "[0,1]", actual: "[0,1]", equal: true },
      { input: "[3,2]", expected: "[0,1]", actual: "[0,1]", equal: true },
    ],
  });
  const msg = buildStudentMessage(req);
  // Should mention improvement/optimization — not "failing"
  const lower = msg.toLowerCase();
  const mentionsImprove =
    lower.includes("improve") || lower.includes("optim") || lower.includes("complexity");
  assertEquals(mentionsImprove, true);
});

Deno.test("buildStudentMessage: some-fail mentions failing/what's wrong", () => {
  const req = makeRequest({
    testReport: [
      { input: "[2,7]", expected: "[0,1]", actual: "[0,1]", equal: true },
      { input: "[3,2]", expected: "[1,0]", actual: "[0,1]", equal: false },
    ],
  });
  const msg = buildStudentMessage(req);
  const lower = msg.toLowerCase();
  const mentionsFailing =
    lower.includes("fail") || lower.includes("wrong") || lower.includes("going wrong");
  assertEquals(mentionsFailing, true);
});

Deno.test("buildStudentMessage: haystack question_type appends nudge", () => {
  const req = makeRequest({
    meta: {
      name: "find-needle",
      title: "Find Needle",
      difficulty: "medium",
      author: "admin",
      category: "sets",
      question_type: ["haystack"],
    },
  });
  const msg = buildStudentMessage(req);
  assertEquals(
    msg.includes("without just naming it"),
    true,
    "Expected haystack nudge in message",
  );
});

Deno.test("buildStudentMessage: non-haystack does NOT append nudge", () => {
  const req = makeRequest();
  const msg = buildStudentMessage(req);
  assertEquals(msg.includes("without just naming it"), false);
});

// --- buildSocraticRequest ---

Deno.test("buildSocraticRequest: maps fields correctly", () => {
  // Override SOCRATIC_COURSE_OFFERING env to ensure default
  const req = makeRequest({
    meta: {
      name: "my-problem",
      title: "My Problem",
      difficulty: "easy",
      author: "admin",
      category: "dp",
      question_type: ["standard"],
    },
    code: "def solve(): pass",
    description: "A tricky problem.",
    testReport: [
      { input: "1", expected: "2", actual: "3", equal: false, error: null },
    ],
  });

  const body = buildSocraticRequest(req, "user-abc");

  assertEquals(body.student_id, "user-abc");
  assertEquals(body.problem_ref, "my-problem");
  assertEquals(body.session_id, null);
  assertEquals(body.problem_context.student_code, "def solve(): pass");
  assertEquals(body.problem_context.description, "A tricky problem.");
  assertEquals(body.problem_context.test_results.length, 1);

  const tr = body.problem_context.test_results[0];
  assertEquals(tr.input, "1");
  assertEquals(tr.expected, "2");
  assertEquals(tr.actual, "3");
  assertEquals(tr.equal, false);
  // error field must NOT be forwarded (only 4 fields mapped)
  assertEquals("error" in tr, false);
});

Deno.test("buildSocraticRequest: course_offering_id uses env or default", () => {
  const req = makeRequest();
  const body = buildSocraticRequest(req, "user-xyz");
  // In test env SOCRATIC_COURSE_OFFERING is not set → falls back to "rag-smoke-test"
  const expected =
    Deno.env.get("SOCRATIC_COURSE_OFFERING") ?? "rag-smoke-test";
  assertEquals(body.course_offering_id, expected);
});
