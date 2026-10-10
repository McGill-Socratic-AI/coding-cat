-- AI Analysis — multi-turn follow-up conversations
--
-- Today a student gets exactly one review per `analyze` call and cannot ask a
-- follow-up. These two tables hold the conversation that makes follow-ups
-- possible, on top of the single-turn `analyze_calls` log (left untouched):
--
--   analyze_threads   one conversation per (user, problem). Stores the Socratic
--                     API's own `session_id`, so a follow-up continues the same
--                     upstream session. The Socratic API keeps the authoritative
--                     turn history server-side and replays it into the prompt —
--                     we send the session id, never the transcript.
--   analyze_messages  the conversation as the student sees it, one row per turn.
--
-- Why a thread is keyed per (user, problem) and not per submission: the Socratic
-- API itself keys a session on (platform, course_offering, student, problem_ref)
-- and will only ever hand back one session per student per problem, so several
-- local threads would map onto one upstream history and interleave. Each turn
-- still snapshots the code it was asked about, in analyze_messages.code.
--
-- Relationship to analyze_calls: analyze_calls stays the immutable cost/audit
-- log for *review* calls and keeps driving the existing daily (20) and
-- per-problem (5) caps unchanged. analyze_messages is the renderable projection
-- of the conversation and carries its own follow-up budget, so asking follow-up
-- questions never eats into a student's review budget for that problem.
--
-- TODO (post-v1): same unbounded-growth caveat as analyze_calls — add a
-- scheduled cleanup once telemetry shows real growth. ON DELETE CASCADE from
-- analyze_threads means deleting a thread takes its messages with it.


-- ---------------------------------------------------------------------------
-- TABLE: analyze_threads
-- ---------------------------------------------------------------------------

CREATE TABLE analyze_threads (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  problem_name         TEXT NOT NULL,              -- problem meta.name (slug), matches analyze_calls.problem_name
  socratic_session_id  UUID,                       -- NULL until the first upstream reply hands one back
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One thread per student per problem — mirrors the Socratic API's own session
  -- uniqueness, and lets the function resolve "the thread" with a single lookup.
  UNIQUE (user_id, problem_name)
);


-- ---------------------------------------------------------------------------
-- TABLE: analyze_messages
-- ---------------------------------------------------------------------------

CREATE TABLE analyze_messages (
  id          BIGSERIAL PRIMARY KEY,
  thread_id   UUID NOT NULL REFERENCES analyze_threads(id) ON DELETE CASCADE,
  -- Denormalised from analyze_threads so the RLS SELECT policy needs no join.
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  turn_index  INT  NOT NULL,                       -- 0-based, strictly increasing within a thread
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  -- Which kind of call produced the turn. Both the student message and its
  -- reply carry the same value, so counting role='user' AND source='followup'
  -- gives the follow-up budget without touching the review budget.
  source      TEXT NOT NULL CHECK (source IN ('review', 'followup')),
  content     TEXT NOT NULL,                       -- the student's question, or the tutor's reply
  code        TEXT,                                -- code snapshot the turn was asked about (user rows)
  model       TEXT,                                -- upstream model label (assistant rows)
  latency_ms  INT,                                 -- upstream round-trip (assistant rows)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (thread_id, turn_index)
);

-- Serves the daily follow-up budget count. Partial so it only indexes the rows
-- that budget actually counts.
CREATE INDEX analyze_messages_followup_budget_idx
  ON analyze_messages(user_id, created_at DESC)
  WHERE role = 'user' AND source = 'followup';


-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

ALTER TABLE analyze_threads  ENABLE ROW LEVEL SECURITY;
ALTER TABLE analyze_messages ENABLE ROW LEVEL SECURITY;

-- A student reads only their own threads and only their own messages. This is
-- what the frontend uses to re-open a conversation after a page reload, with
-- the plain anon-key client.
CREATE POLICY analyze_threads_self_select ON analyze_threads
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY analyze_messages_self_select ON analyze_messages
  FOR SELECT USING (auth.uid() = user_id);

-- INTENTIONALLY no INSERT, UPDATE or DELETE policy on either table: threads
-- and both rows of every turn are written only by the analyze Edge Function's
-- service-role client (see functions/analyze/auth.ts and thread.ts), which
-- enforces the length caps and follow-up budgets. A student therefore cannot
-- forge a turn, rewrite history, re-point a thread at another student's
-- Socratic session, or manufacture a thread under someone else's user_id.
