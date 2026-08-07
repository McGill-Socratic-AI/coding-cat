import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyGrades,
  countRecentRows,
  deleteAllGrades,
  readGrades,
  readLatestConsent,
} from "./store.ts";

// A PostgREST-shaped fake. Every builder method returns the builder, and the
// builder is thenable, so any chain length resolves through one `respond`
// callback that sees the accumulated query state.
interface QueryState {
  table: string;
  op: string | null;
  cols?: string;
  opts?: unknown;
  payload?: unknown;
  filters: Array<[string, string, unknown]>;
  order?: [string, unknown];
  limit?: number;
  single?: boolean;
}

function fakeClient(respond: (state: QueryState) => unknown) {
  const calls: QueryState[] = [];

  function makeBuilder(table: string) {
    const state: QueryState = { table, op: null, filters: [] };
    calls.push(state);
    // deno-lint-ignore no-explicit-any
    const builder: any = {
      select(cols: string, opts?: unknown) {
        state.op ??= "select";
        state.cols = cols;
        state.opts = opts;
        return builder;
      },
      insert(rows: unknown) {
        state.op = "insert";
        state.payload = rows;
        return builder;
      },
      delete() {
        state.op = "delete";
        return builder;
      },
      eq(col: string, val: unknown) {
        state.filters.push(["eq", col, val]);
        return builder;
      },
      in(col: string, val: unknown) {
        state.filters.push(["in", col, val]);
        return builder;
      },
      gte(col: string, val: unknown) {
        state.filters.push(["gte", col, val]);
        return builder;
      },
      order(col: string, opts: unknown) {
        state.order = [col, opts];
        return builder;
      },
      limit(n: number) {
        state.limit = n;
        return builder;
      },
      maybeSingle() {
        state.single = true;
        return builder;
      },
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
        return Promise.resolve(respond(state)).then(resolve, reject);
      },
    };
    return builder;
  }

  return {
    client: { from: (table: string) => makeBuilder(table) },
    calls,
  };
}

const PSEUDONYM = "a".repeat(64);

// --- readGrades ------------------------------------------------------------
//
// readGrades issues one newest-first lookup per grade item, so the fake answers
// per item_key filter.

function itemOf(state: QueryState): string | undefined {
  const filter = state.filters.find(([op, col]) => op === "eq" && col === "item_key");
  return filter ? (filter[2] as string) : undefined;
}

Deno.test("readGrades returns the newest row for each item", async () => {
  const stored: Record<string, unknown> = {
    exam_1: { item_key: "exam_1", score: 91 },
    assignment_2: { item_key: "assignment_2", score: 78 },
  };
  const { client } = fakeClient((state) => ({
    data: stored[itemOf(state) ?? ""] ?? null,
    error: null,
  }));

  const grades = await readGrades(client as never, PSEUDONYM);
  assertEquals(grades, { exam_1: 91, assignment_2: 78 });
});

Deno.test("readGrades asks for the newest row by id, per item", async () => {
  // The correctness property: a student who revised one score a thousand times
  // must not lose the newest row for a different item. That only holds if each
  // item is queried on its own, ordered by id descending, limit 1.
  const { client, calls } = fakeClient(() => ({ data: null, error: null }));
  await readGrades(client as never, PSEUDONYM);

  assertEquals(calls.length, 7, "one query per grade item");
  for (const call of calls) {
    assertEquals(call.table, "self_reported_grades");
    assertEquals(call.order, ["id", { ascending: false }]);
    assertEquals(call.limit, 1);
    assertEquals(call.filters[0], ["eq", "pseudonym", PSEUDONYM]);
  }
  const items = calls.map(itemOf).sort();
  assertEquals(items, [
    "assignment_1",
    "assignment_2",
    "assignment_3",
    "assignment_4",
    "exam_1",
    "exam_2",
    "exam_3",
  ]);
});

Deno.test("readGrades coerces PostgREST's string NUMERIC into a number", async () => {
  // PostgREST serialises NUMERIC as a string to avoid float precision loss.
  const { client } = fakeClient((state) =>
    itemOf(state) === "exam_1"
      ? { data: { item_key: "exam_1", score: "87.50" }, error: null }
      : { data: null, error: null }
  );

  const grades = await readGrades(client as never, PSEUDONYM);
  assertEquals(grades.exam_1, 87.5);
  assertEquals(typeof grades.exam_1, "number");
});

Deno.test("readGrades ignores a row whose item_key is not a known item", async () => {
  const { client } = fakeClient((state) =>
    itemOf(state) === "exam_1"
      ? { data: { item_key: "midterm_9", score: 70 }, error: null }
      : { data: null, error: null }
  );

  assertEquals(await readGrades(client as never, PSEUDONYM), {});
});

Deno.test("readGrades returns an empty map when nothing is stored", async () => {
  const { client } = fakeClient(() => ({ data: null, error: null }));
  assertEquals(await readGrades(client as never, PSEUDONYM), {});
});

Deno.test("readGrades surfaces a database error instead of returning empty", async () => {
  // Silently returning {} would look to the student like their data vanished.
  const { client } = fakeClient(() => ({
    data: null,
    error: { message: "boom" },
  }));
  await assertRejects(() => readGrades(client as never, PSEUDONYM));
});

// --- applyGrades -----------------------------------------------------------

Deno.test("applyGrades inserts scores and deletes explicit nulls", async () => {
  const { client, calls } = fakeClient(() => ({ error: null }));

  await applyGrades(
    client as never,
    PSEUDONYM,
    { exam_1: 88, exam_2: null, assignment_1: 73 },
    "2026-08-comp204-v1",
  );

  const deletes = calls.filter((c) => c.op === "delete");
  const inserts = calls.filter((c) => c.op === "insert");

  assertEquals(deletes.length, 1);
  assertEquals(deletes[0].filters, [
    ["eq", "pseudonym", PSEUDONYM],
    ["in", "item_key", ["exam_2"]],
  ]);

  assertEquals(inserts.length, 1);
  assertEquals(inserts[0].payload, [
    {
      pseudonym: PSEUDONYM,
      item_key: "exam_1",
      score: 88,
      consent_version: "2026-08-comp204-v1",
    },
    {
      pseudonym: PSEUDONYM,
      item_key: "assignment_1",
      score: 73,
      consent_version: "2026-08-comp204-v1",
    },
  ]);
});

Deno.test("applyGrades issues no insert when every value is a clear", async () => {
  const { client, calls } = fakeClient(() => ({ error: null }));
  await applyGrades(client as never, PSEUDONYM, { exam_1: null }, "v1");

  assertEquals(calls.filter((c) => c.op === "insert").length, 0);
  assertEquals(calls.filter((c) => c.op === "delete").length, 1);
});

Deno.test("applyGrades issues no delete when nothing is cleared", async () => {
  const { client, calls } = fakeClient(() => ({ error: null }));
  await applyGrades(client as never, PSEUDONYM, { exam_1: 60 }, "v1");

  assertEquals(calls.filter((c) => c.op === "delete").length, 0);
  assertEquals(calls.filter((c) => c.op === "insert").length, 1);
});

Deno.test("applyGrades stamps every row with the consent version in force", async () => {
  const { client, calls } = fakeClient(() => ({ error: null }));
  await applyGrades(
    client as never,
    PSEUDONYM,
    { exam_1: 1, exam_2: 2 },
    "v-current",
  );

  const insert = calls.find((c) => c.op === "insert")!;
  for (const row of insert.payload as Array<{ consent_version: string }>) {
    assertEquals(row.consent_version, "v-current");
  }
});

Deno.test("applyGrades raises when the write fails", async () => {
  const { client } = fakeClient(() => ({ error: { message: "denied" } }));
  await assertRejects(
    () => applyGrades(client as never, PSEUDONYM, { exam_1: 50 }, "v1"),
  );
});

// --- deleteAllGrades -------------------------------------------------------

Deno.test("deleteAllGrades removes only the caller's rows", async () => {
  const { client, calls } = fakeClient(() => ({ error: null }));
  await deleteAllGrades(client as never, PSEUDONYM);

  const del = calls.find((c) => c.op === "delete")!;
  assertEquals(del.table, "self_reported_grades");
  assertEquals(del.filters, [["eq", "pseudonym", PSEUDONYM]]);
});

// --- countRecentRows -------------------------------------------------------

Deno.test("countRecentRows returns the reported count", async () => {
  const { client } = fakeClient(() => ({ count: 7, error: null }));
  assertEquals(await countRecentRows(client as never, PSEUDONYM), 7);
});

Deno.test("countRecentRows fails open so a counting error cannot block a student", async () => {
  const { client } = fakeClient(() => ({
    count: null,
    error: { message: "boom" },
  }));
  assertEquals(await countRecentRows(client as never, PSEUDONYM), 0);
});

// --- readLatestConsent -----------------------------------------------------

Deno.test("readLatestConsent returns null when the student has never answered", async () => {
  const { client } = fakeClient(() => ({ data: null, error: null }));
  assertEquals(await readLatestConsent(client as never, "user-1"), null);
});

Deno.test("readLatestConsent asks for the newest row only", async () => {
  const { client, calls } = fakeClient(() => ({
    data: {
      consent_version: "v1",
      action: "granted",
      created_at: "2026-08-01T00:00:00Z",
    },
    error: null,
  }));

  const row = await readLatestConsent(client as never, "user-1");
  assertEquals(row?.action, "granted");
  assertEquals(calls[0].table, "research_consent");
  assertEquals(calls[0].order, ["created_at", { ascending: false }]);
  assertEquals(calls[0].limit, 1);
});
