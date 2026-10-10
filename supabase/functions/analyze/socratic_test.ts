import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildSocraticRequest,
  buildStudentMessage,
  callSocratic,
  MAX_SOCRATIC_MESSAGE_LEN,
} from "./socratic.ts";
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

// --- Multi-turn: carrying the earlier exchange ----------------------------
//
// The Socratic API owns the transcript. It keys a conversation on session_id
// and replays that session's prior turns into the prompt, so continuing a
// conversation means sending the stored session id — never the history itself.

const SESSION_ID = "44444444-4444-4444-8444-444444444444";

Deno.test("buildSocraticRequest sends session_id=null for a first review", () => {
  const body = buildSocraticRequest(makeRequest(), "user-abc");
  assertEquals(body.session_id, null);
});

Deno.test("buildSocraticRequest carries the stored session id on a follow-up", () => {
  const body = buildSocraticRequest(makeRequest(), "user-abc", {
    sessionId: SESSION_ID,
    message: "why is a dict faster here?",
  });
  // This is what makes the turn multi-turn: the API loads this session's
  // earlier turns and prepends them to the prompt.
  assertEquals(body.session_id, SESSION_ID);
  assertEquals(body.message, "why is a dict faster here?");
});

Deno.test("buildSocraticRequest sends the student's own words, not the generated opener", () => {
  const req = makeRequest();
  const generated = buildStudentMessage(req);
  const body = buildSocraticRequest(req, "user-abc", {
    sessionId: SESSION_ID,
    message: "I still don't see why the loop misses the last pair.",
  });
  assertEquals(body.message, "I still don't see why the loop misses the last pair.");
  assertEquals(body.message === generated, false);
});

Deno.test("buildSocraticRequest still sends the current code and tests on a follow-up", () => {
  // The tutor needs the submission as it stands now, not as it was on turn 1.
  const req = makeRequest({
    code: "def two_sum(nums, target):\n    return []\n",
    testReport: [
      { input: "[2,7]", expected: "[0,1]", actual: "[]", equal: false },
    ],
  });
  const body = buildSocraticRequest(req, "user-abc", {
    sessionId: SESSION_ID,
    message: "what about an empty list?",
  });
  assertEquals(body.problem_context.student_code, req.code);
  assertEquals(body.problem_context.test_results[0].equal, false);
});

Deno.test("buildSocraticRequest truncates a message to the upstream limit", () => {
  const body = buildSocraticRequest(makeRequest(), "user-abc", {
    message: "x".repeat(MAX_SOCRATIC_MESSAGE_LEN + 500),
  });
  assertEquals(body.message.length, MAX_SOCRATIC_MESSAGE_LEN);
});

// --- callSocratic over a stubbed upstream ---------------------------------

interface StubCall {
  sessionId: string | null;
  message: string;
}

function stubFetch(
  replies: Array<{ status: number; body: unknown }>,
): { calls: StubCall[]; restore: () => void } {
  const calls: StubCall[] = [];
  const original = globalThis.fetch;
  let i = 0;
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    const sent = JSON.parse(String(init?.body));
    calls.push({ sessionId: sent.session_id, message: sent.message });
    const reply = replies[Math.min(i, replies.length - 1)];
    i += 1;
    return Promise.resolve(
      new Response(JSON.stringify(reply.body), { status: reply.status }),
    );
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

Deno.test("callSocratic reports the session id so the next turn can continue it", async () => {
  Deno.env.set("SOCRATIC_PLATFORM_KEY", "test-key");
  const stub = stubFetch([{
    status: 200,
    body: { ok: true, session_id: SESSION_ID, turn_index: 0, reply: "What does line 2 do?" },
  }]);
  try {
    const result = await callSocratic(makeRequest(), "user-abc");
    assertEquals(result.analysis, "What does line 2 do?");
    assertEquals(result.sessionId, SESSION_ID);
    assertEquals(stub.calls.length, 1);
    assertEquals(stub.calls[0].sessionId, null);
  } finally {
    stub.restore();
  }
});

Deno.test("callSocratic continues the stored session on a follow-up", async () => {
  Deno.env.set("SOCRATIC_PLATFORM_KEY", "test-key");
  const stub = stubFetch([{
    status: 200,
    body: { ok: true, session_id: SESSION_ID, turn_index: 3, reply: "And at index 0?" },
  }]);
  try {
    const result = await callSocratic(makeRequest(), "user-abc", {
      sessionId: SESSION_ID,
      message: "why not a dict?",
    });
    assertEquals(stub.calls.length, 1);
    assertEquals(stub.calls[0].sessionId, SESSION_ID);
    assertEquals(stub.calls[0].message, "why not a dict?");
    assertEquals(result.sessionId, SESSION_ID);
  } finally {
    stub.restore();
  }
});

Deno.test("callSocratic retries once without a session id the API no longer knows", async () => {
  // A pruned or reset upstream session would otherwise wedge the conversation
  // forever. Dropping the id lets the API resolve the session by tenancy.
  Deno.env.set("SOCRATIC_PLATFORM_KEY", "test-key");
  const stub = stubFetch([
    { status: 409, body: { ok: false, kind: "session_mismatch", message: "nope" } },
    { status: 200, body: { ok: true, session_id: "55555555-5555-4555-8555-555555555555", turn_index: 0, reply: "Where does the loop stop?" } },
  ]);
  try {
    const result = await callSocratic(makeRequest(), "user-abc", {
      sessionId: SESSION_ID,
      message: "still stuck",
    });
    assertEquals(stub.calls.length, 2);
    assertEquals(stub.calls[0].sessionId, SESSION_ID);
    assertEquals(stub.calls[1].sessionId, null);
    assertEquals(result.sessionId, "55555555-5555-4555-8555-555555555555");
    assertEquals(result.analysis, "Where does the loop stop?");
  } finally {
    stub.restore();
  }
});

Deno.test("callSocratic does not retry an upstream failure that is not a session mismatch", async () => {
  Deno.env.set("SOCRATIC_PLATFORM_KEY", "test-key");
  const stub = stubFetch([
    { status: 502, body: { ok: false, kind: "upstream", message: "llm down" } },
  ]);
  try {
    await assertRejects(() =>
      callSocratic(makeRequest(), "user-abc", { sessionId: SESSION_ID, message: "hi" })
    );
    assertEquals(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

Deno.test("callSocratic does not retry a session mismatch when no session id was sent", async () => {
  Deno.env.set("SOCRATIC_PLATFORM_KEY", "test-key");
  const stub = stubFetch([
    { status: 409, body: { ok: false, kind: "session_mismatch", message: "nope" } },
  ]);
  try {
    await assertRejects(() => callSocratic(makeRequest(), "user-abc"));
    assertEquals(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

Deno.test("callSocratic rejects a reply-less 200 rather than storing an empty turn", async () => {
  Deno.env.set("SOCRATIC_PLATFORM_KEY", "test-key");
  const stub = stubFetch([{ status: 200, body: { ok: true, session_id: SESSION_ID } }]);
  try {
    await assertRejects(() => callSocratic(makeRequest(), "user-abc"));
  } finally {
    stub.restore();
  }
});
