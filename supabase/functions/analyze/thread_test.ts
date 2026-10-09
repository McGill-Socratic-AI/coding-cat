import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  appendTurn,
  countDailyFollowUps,
  countThreadFollowUps,
  findOwnedThread,
  FOLLOWUP_DAILY_CAP,
  gateFollowUp,
  getOrCreateThread,
  loadThread,
  MAX_FOLLOWUP_LEN,
  MAX_FOLLOWUPS_PER_THREAD,
  reviewTurnLabel,
  setSocraticSession,
  toAnalyzeThread,
  unsavedTurn,
  validateFollowUp,
  type MessageRow,
  type ThreadRow,
} from "./thread.ts";

// --- Fake Supabase client --------------------------------------------------
//
// Records every query the module under test builds and lets the test answer it.
// PostgREST builders are thenable, and thread.ts awaits some chains without a
// terminal .single()/.maybeSingle(), so the builder implements `then` too.

interface Op {
  table: string;
  op: "select" | "insert" | "update";
  columns?: string;
  options?: Record<string, unknown>;
  payload?: unknown;
  filters: Array<[string, string, unknown]>;
  order?: { column: string; ascending: boolean };
  limit?: number;
  terminal?: "single" | "maybeSingle";
}

interface Answer {
  data?: unknown;
  count?: number;
  error?: unknown;
}

function filterValue(op: Op, column: string): unknown {
  return op.filters.find(([, c]) => c === column)?.[2];
}

function fakeClient(respond: (op: Op, index: number) => Answer) {
  const ops: Op[] = [];

  function builder(op: Op) {
    const settle = () => Promise.resolve(respond(op, ops.indexOf(op)));
    // deno-lint-ignore no-explicit-any
    const b: any = {
      eq(c: string, v: unknown) {
        op.filters.push(["eq", c, v]);
        return b;
      },
      gte(c: string, v: unknown) {
        op.filters.push(["gte", c, v]);
        return b;
      },
      select(c: string, o?: Record<string, unknown>) {
        op.columns = c;
        op.options = o;
        return b;
      },
      order(c: string, o?: { ascending?: boolean }) {
        op.order = { column: c, ascending: o?.ascending !== false };
        return b;
      },
      limit(n: number) {
        op.limit = n;
        return b;
      },
      single() {
        op.terminal = "single";
        return settle();
      },
      maybeSingle() {
        op.terminal = "maybeSingle";
        return settle();
      },
      // deno-lint-ignore no-explicit-any
      then(onOk: any, onErr: any) {
        return settle().then(onOk, onErr);
      },
    };
    return b;
  }

  function start(table: string, op: Op["op"], payload?: unknown) {
    const record: Op = { table, op, payload, filters: [] };
    ops.push(record);
    return builder(record);
  }

  return {
    ops,
    from(table: string) {
      return {
        select(columns: string, options?: Record<string, unknown>) {
          const b = start(table, "select");
          return b.select(columns, options);
        },
        insert(payload: unknown) {
          return start(table, "insert", payload);
        },
        update(payload: unknown) {
          return start(table, "update", payload);
        },
      };
    },
  };
}

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const THREAD_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";

function threadRow(overrides: Partial<ThreadRow> = {}): ThreadRow {
  return {
    id: THREAD_ID,
    user_id: OWNER,
    problem_name: "two-sum",
    socratic_session_id: SESSION_ID,
    ...overrides,
  };
}

// --- Access control --------------------------------------------------------

Deno.test("findOwnedThread returns the thread to the student who owns it", async () => {
  const client = fakeClient(() => ({ data: threadRow(), error: null }));
  const row = await findOwnedThread(client as any, OWNER, THREAD_ID);
  assertEquals(row?.id, THREAD_ID);
  assertEquals(row?.socratic_session_id, SESSION_ID);
});

Deno.test("findOwnedThread refuses another student's thread", async () => {
  // The row exists, but it belongs to OTHER. The caller must get nothing back —
  // this is the access-control boundary for follow-ups.
  const client = fakeClient(() => ({
    data: threadRow({ user_id: OTHER }),
    error: null,
  }));
  const row = await findOwnedThread(client as any, OWNER, THREAD_ID);
  assertEquals(row, null);
});

Deno.test("findOwnedThread returns null for an unknown thread id", async () => {
  const client = fakeClient(() => ({ data: null, error: null }));
  assertEquals(await findOwnedThread(client as any, OWNER, THREAD_ID), null);
});

Deno.test("findOwnedThread surfaces a lookup error instead of granting access", async () => {
  const client = fakeClient(() => ({ data: null, error: { message: "boom" } }));
  await assertRejects(() => findOwnedThread(client as any, OWNER, THREAD_ID));
});

Deno.test("gateFollowUp rejects another student's thread as not found", () => {
  // findOwnedThread already mapped "someone else's thread" to null; the gate
  // must report that identically to a thread that never existed, so a client
  // cannot tell the two apart and probe for ids.
  const missing = gateFollowUp({
    thread: null,
    problemName: "two-sum",
    threadFollowUps: 0,
    dailyFollowUps: 0,
  });
  assertEquals(missing, { allowed: false, kind: "thread_not_found" });
});

Deno.test("gateFollowUp rejects a thread belonging to a different problem", () => {
  const gate = gateFollowUp({
    thread: threadRow({ problem_name: "reverse-string" }),
    problemName: "two-sum",
    threadFollowUps: 0,
    dailyFollowUps: 0,
  });
  assertEquals(gate, { allowed: false, kind: "thread_not_found" });
});

Deno.test("gateFollowUp admits the owner's thread for its own problem", () => {
  const gate = gateFollowUp({
    thread: threadRow(),
    problemName: "two-sum",
    threadFollowUps: MAX_FOLLOWUPS_PER_THREAD - 1,
    dailyFollowUps: FOLLOWUP_DAILY_CAP - 1,
  });
  assertEquals(gate.allowed, true);
});

// --- Turn cap --------------------------------------------------------------

Deno.test("gateFollowUp blocks once the conversation hits its follow-up cap", () => {
  const gate = gateFollowUp({
    thread: threadRow(),
    problemName: "two-sum",
    threadFollowUps: MAX_FOLLOWUPS_PER_THREAD,
    dailyFollowUps: 0,
  });
  assertEquals(gate, { allowed: false, kind: "turn_limit" });
});

Deno.test("gateFollowUp blocks on the daily follow-up budget", () => {
  const gate = gateFollowUp({
    thread: threadRow(),
    problemName: "two-sum",
    threadFollowUps: 0,
    dailyFollowUps: FOLLOWUP_DAILY_CAP,
  });
  assertEquals(gate, { allowed: false, kind: "rate_limit" });
});

Deno.test("gateFollowUp reports the turn cap before the daily budget", () => {
  // Both are exhausted. The per-conversation cap is the more actionable
  // message ("start a new analysis"), so it wins.
  const gate = gateFollowUp({
    thread: threadRow(),
    problemName: "two-sum",
    threadFollowUps: MAX_FOLLOWUPS_PER_THREAD,
    dailyFollowUps: FOLLOWUP_DAILY_CAP,
  });
  assertEquals(gate, { allowed: false, kind: "turn_limit" });
});

Deno.test("countThreadFollowUps counts only the student's follow-up turns", async () => {
  const client = fakeClient(() => ({ count: 4, error: null }));
  const n = await countThreadFollowUps(client as any, THREAD_ID);
  assertEquals(n, 4);

  const op = client.ops[0];
  assertEquals(op.table, "analyze_messages");
  assertEquals(op.options?.head, true);
  assertEquals(filterValue(op, "thread_id"), THREAD_ID);
  // Assistant replies and the review turn must not inflate the follow-up cap.
  assertEquals(filterValue(op, "role"), "user");
  assertEquals(filterValue(op, "source"), "followup");
});

Deno.test("countDailyFollowUps counts the student's follow-ups since UTC midnight", async () => {
  const client = fakeClient(() => ({ count: 7, error: null }));
  assertEquals(await countDailyFollowUps(client as any, OWNER), 7);

  const op = client.ops[0];
  assertEquals(filterValue(op, "user_id"), OWNER);
  assertEquals(filterValue(op, "role"), "user");
  assertEquals(filterValue(op, "source"), "followup");
  const since = op.filters.find(([k, c]) => k === "gte" && c === "created_at");
  assertEquals(typeof since?.[2], "string");
  assertEquals((since?.[2] as string).endsWith("T00:00:00.000Z"), true);
});

Deno.test("countThreadFollowUps fails loudly rather than reporting zero", async () => {
  // Failing open here would hand the student unlimited follow-ups.
  const client = fakeClient(() => ({ count: null as any, error: { message: "boom" } }));
  await assertRejects(() => countThreadFollowUps(client as any, THREAD_ID));
});

// --- Follow-up payload validation -----------------------------------------

Deno.test("validateFollowUp accepts a trimmed question", () => {
  const v = validateFollowUp({ threadId: THREAD_ID, message: "  why is it O(n^2)?  " });
  assertEquals(v, { ok: true, message: "why is it O(n^2)?" });
});

Deno.test("validateFollowUp rejects a threadId that is not a conversation id", () => {
  const v = validateFollowUp({ threadId: "not-a-uuid", message: "hi" });
  assertEquals(v.ok, false);
});

Deno.test("validateFollowUp rejects a blank question", () => {
  assertEquals(validateFollowUp({ threadId: THREAD_ID, message: "   " }).ok, false);
});

Deno.test("validateFollowUp rejects a question over the length cap", () => {
  const v = validateFollowUp({
    threadId: THREAD_ID,
    message: "x".repeat(MAX_FOLLOWUP_LEN + 1),
  });
  assertEquals(v.ok, false);
  if (v.ok) throw new Error("unreachable");
  assertEquals(v.error.includes(String(MAX_FOLLOWUP_LEN)), true);
});

Deno.test("validateFollowUp accepts a question exactly at the length cap", () => {
  const v = validateFollowUp({
    threadId: THREAD_ID,
    message: "x".repeat(MAX_FOLLOWUP_LEN),
  });
  assertEquals(v.ok, true);
});

Deno.test("validateFollowUp rejects a non-object payload", () => {
  assertEquals(validateFollowUp("nope").ok, false);
  assertEquals(validateFollowUp(null).ok, false);
});

// --- Thread resolution -----------------------------------------------------

Deno.test("getOrCreateThread reuses the student's existing thread for the problem", async () => {
  const client = fakeClient(() => ({ data: threadRow(), error: null }));
  const row = await getOrCreateThread(client as any, OWNER, "two-sum");
  assertEquals(row.id, THREAD_ID);
  // One lookup, no insert.
  assertEquals(client.ops.length, 1);
  assertEquals(client.ops[0].op, "select");
});

Deno.test("getOrCreateThread creates a thread on the first review", async () => {
  const client = fakeClient((op) =>
    op.op === "insert"
      ? { data: threadRow({ socratic_session_id: null }), error: null }
      : { data: null, error: null }
  );
  const row = await getOrCreateThread(client as any, OWNER, "two-sum");
  assertEquals(row.socratic_session_id, null);
  assertEquals(client.ops[1].op, "insert");
  assertEquals(client.ops[1].payload, { user_id: OWNER, problem_name: "two-sum" });
});

Deno.test("getOrCreateThread resolves a concurrent create via the unique constraint", async () => {
  let selects = 0;
  const client = fakeClient((op) => {
    if (op.op === "insert") return { data: null, error: { code: "23505" } };
    selects += 1;
    return selects === 1
      ? { data: null, error: null }
      : { data: threadRow(), error: null };
  });
  const row = await getOrCreateThread(client as any, OWNER, "two-sum");
  assertEquals(row.id, THREAD_ID);
});

Deno.test("getOrCreateThread rethrows an insert error that is not a duplicate", async () => {
  const client = fakeClient((op) =>
    op.op === "insert"
      ? { data: null, error: { code: "42501" } }
      : { data: null, error: null }
  );
  await assertRejects(() => getOrCreateThread(client as any, OWNER, "two-sum"));
});

Deno.test("setSocraticSession stores the upstream session against the thread", async () => {
  const client = fakeClient(() => ({ data: null, error: null }));
  await setSocraticSession(client as any, THREAD_ID, SESSION_ID);
  const op = client.ops[0];
  assertEquals(op.table, "analyze_threads");
  assertEquals(op.op, "update");
  assertEquals((op.payload as Record<string, unknown>).socratic_session_id, SESSION_ID);
  assertEquals(filterValue(op, "id"), THREAD_ID);
});

// --- Appending turns -------------------------------------------------------

Deno.test("appendTurn writes the question and its reply as consecutive turns", async () => {
  const client = fakeClient((op) =>
    op.table === "analyze_messages" && op.op === "select"
      ? { data: { turn_index: 3 }, error: null }
      : { data: null, error: null }
  );

  await appendTurn(client as any, {
    threadId: THREAD_ID,
    userId: OWNER,
    source: "followup",
    studentMessage: "why not a dict?",
    code: "def f(): pass",
    reply: "What would a dict let you look up in one step?",
    model: "socratic-followup",
    latencyMs: 1234.6,
  });

  const insert = client.ops.find((o) => o.op === "insert")!;
  const rows = insert.payload as Array<Record<string, unknown>>;
  assertEquals(rows.length, 2);

  assertEquals(rows[0].role, "user");
  assertEquals(rows[0].turn_index, 4);
  assertEquals(rows[0].source, "followup");
  assertEquals(rows[0].content, "why not a dict?");
  assertEquals(rows[0].code, "def f(): pass");

  assertEquals(rows[1].role, "assistant");
  assertEquals(rows[1].turn_index, 5);
  assertEquals(rows[1].source, "followup");
  assertEquals(rows[1].content, "What would a dict let you look up in one step?");
  assertEquals(rows[1].latency_ms, 1235);
  assertEquals(rows[1].model, "socratic-followup");
});

Deno.test("appendTurn starts an empty thread at turn 0", async () => {
  const client = fakeClient((op) =>
    op.op === "select" ? { data: null, error: null } : { data: null, error: null }
  );
  await appendTurn(client as any, {
    threadId: THREAD_ID,
    userId: OWNER,
    source: "review",
    studentMessage: "Requested an analysis of my code.",
    code: "",
    reply: "What does your loop do on an empty list?",
    model: "socratic",
    latencyMs: 10,
  });
  const rows = client.ops.find((o) => o.op === "insert")!
    .payload as Array<Record<string, unknown>>;
  assertEquals(rows[0].turn_index, 0);
  assertEquals(rows[1].turn_index, 1);
});

Deno.test("appendTurn retries once when two turns race for the same index", async () => {
  let inserts = 0;
  const client = fakeClient((op) => {
    if (op.op === "insert") {
      inserts += 1;
      return inserts === 1
        ? { data: null, error: { code: "23505" } }
        : { data: null, error: null };
    }
    return { data: { turn_index: inserts === 0 ? 1 : 3 }, error: null };
  });

  await appendTurn(client as any, {
    threadId: THREAD_ID,
    userId: OWNER,
    source: "followup",
    studentMessage: "and the space complexity?",
    code: "",
    reply: "How many entries does your dict hold at worst?",
    model: "socratic-followup",
    latencyMs: 5,
  });

  assertEquals(inserts, 2);
  const retry = client.ops.filter((o) => o.op === "insert")[1];
  const rows = retry.payload as Array<Record<string, unknown>>;
  assertEquals(rows[0].turn_index, 4);
});

Deno.test("appendTurn gives up after a second collision", async () => {
  const client = fakeClient((op) =>
    op.op === "insert"
      ? { data: null, error: { code: "23505" } }
      : { data: { turn_index: 0 }, error: null }
  );
  await assertRejects(() =>
    appendTurn(client as any, {
      threadId: THREAD_ID,
      userId: OWNER,
      source: "followup",
      studentMessage: "hm?",
      code: "",
      reply: "...",
      model: "socratic-followup",
      latencyMs: 1,
    })
  );
});

// --- Projection for the panel ---------------------------------------------

function msg(overrides: Partial<MessageRow> & { id: number }): MessageRow {
  return {
    role: "user",
    source: "review",
    content: "",
    turn_index: overrides.id,
    created_at: "2026-10-09T00:00:00.000Z",
    ...overrides,
  };
}

Deno.test("toAnalyzeThread counts only the student's follow-up turns", () => {
  const thread = toAnalyzeThread(THREAD_ID, [
    msg({ id: 0, role: "user", source: "review", content: "review please" }),
    msg({ id: 1, role: "assistant", source: "review", content: "what does line 2 do?" }),
    msg({ id: 2, role: "user", source: "followup", content: "q1" }),
    msg({ id: 3, role: "assistant", source: "followup", content: "a1" }),
    msg({ id: 4, role: "user", source: "followup", content: "q2" }),
    msg({ id: 5, role: "assistant", source: "followup", content: "a2" }),
  ]);
  assertEquals(thread.threadId, THREAD_ID);
  assertEquals(thread.messages.length, 6);
  assertEquals(thread.followUpsUsed, 2);
  assertEquals(thread.followUpsLimit, MAX_FOLLOWUPS_PER_THREAD);
  assertEquals(thread.messages[0].id, "0");
  assertEquals(thread.messages[0].turnIndex, 0);
});

Deno.test("toAnalyzeThread reports a conversation that has reached the cap", () => {
  const rows: MessageRow[] = [];
  for (let i = 0; i < MAX_FOLLOWUPS_PER_THREAD; i++) {
    rows.push(msg({ id: i * 2, role: "user", source: "followup", content: `q${i}` }));
    rows.push(msg({ id: i * 2 + 1, role: "assistant", source: "followup", content: `a${i}` }));
  }
  const thread = toAnalyzeThread(THREAD_ID, rows);
  assertEquals(thread.followUpsUsed, thread.followUpsLimit);
});

Deno.test("loadThread returns the conversation in turn order", async () => {
  const client = fakeClient(() => ({
    data: [
      msg({ id: 0, role: "user", source: "review", content: "review please" }),
      msg({ id: 1, role: "assistant", source: "review", content: "and line 3?" }),
    ],
    error: null,
  }));
  const thread = await loadThread(client as any, THREAD_ID);
  assertEquals(thread.messages.map((m) => m.role), ["user", "assistant"]);
  const op = client.ops[0];
  assertEquals(filterValue(op, "thread_id"), THREAD_ID);
  assertEquals(op.order, { column: "turn_index", ascending: true });
});

Deno.test("loadThread yields an empty conversation when the thread has no turns", async () => {
  const client = fakeClient(() => ({ data: null, error: null }));
  const thread = await loadThread(client as any, THREAD_ID);
  assertEquals(thread.messages, []);
  assertEquals(thread.followUpsUsed, 0);
});

// --- Transcript label ------------------------------------------------------

Deno.test("reviewTurnLabel summarises the tests the review was asked about", () => {
  assertEquals(
    reviewTurnLabel([{ equal: true }, { equal: false }, { equal: true }]),
    "Requested an analysis of my code (2/3 tests passing).",
  );
});

Deno.test("reviewTurnLabel handles a submission with no test results", () => {
  assertEquals(reviewTurnLabel([]), "Requested an analysis of my code.");
});

// --- Turns that could not be stored ---------------------------------------

Deno.test("unsavedTurn hands back a reply the thread failed to store", () => {
  // Otherwise a storage hiccup would make the answer the student just waited
  // for disappear, since the panel renders the thread rather than the raw reply.
  const stored = toAnalyzeThread(THREAD_ID, [
    msg({ id: 0, role: "user", source: "review", content: "review please" }),
    msg({ id: 1, role: "assistant", source: "review", content: "what does line 2 do?" }),
  ]);
  const withTurn = unsavedTurn(stored, "followup", "why not a dict?", "What would it look up?");

  assertEquals(withTurn.messages.length, 4);
  assertEquals(withTurn.messages[2].role, "user");
  assertEquals(withTurn.messages[2].content, "why not a dict?");
  assertEquals(withTurn.messages[2].turnIndex, 2);
  assertEquals(withTurn.messages[3].role, "assistant");
  assertEquals(withTurn.messages[3].content, "What would it look up?");
  assertEquals(withTurn.messages[3].turnIndex, 3);
  assertEquals(withTurn.followUpsUsed, 1);
  assertEquals(withTurn.threadId, THREAD_ID);
});

Deno.test("unsavedTurn starts at turn 0 on a conversation that stored nothing", () => {
  const withTurn = unsavedTurn(
    toAnalyzeThread(THREAD_ID, []),
    "review",
    "Requested an analysis of my code.",
    "Where does your loop stop?",
  );
  assertEquals(withTurn.messages.map((m) => m.turnIndex), [0, 1]);
  assertEquals(withTurn.followUpsUsed, 0);
});
