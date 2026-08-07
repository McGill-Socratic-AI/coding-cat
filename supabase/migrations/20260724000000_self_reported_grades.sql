-- Self-reported grades (COMP204 research instrument)
--
-- Students voluntarily report their own Exam 1-3 and Assignment 1-4 scores so
-- the research team can relate Socratic-AI usage to course outcomes.
--
-- THE CENTRAL DESIGN CONSTRAINT
-- -----------------------------
-- Correlating usage with outcomes requires a join key, and a join key that
-- reaches a student's usage data is a pseudonym, not anonymity. We do not
-- pretend otherwise. What we do instead is make the link *unusable without a
-- secret that lives outside the database*:
--
--   pseudonym = HMAC-SHA256(RESEARCH_SALT, auth.uid())
--
-- RESEARCH_SALT is an Edge Function secret. It is never in the database, never
-- in the repo, and never sent to the browser. Consequently:
--
--   * self_reported_grades has NO profile_id, NO user_id, and NO foreign key
--     to auth.users. Nothing in the schema links a row to a person.
--   * Anyone with full database access (including a leaked service-role key)
--     sees only opaque 64-hex strings. They cannot join to profiles.username
--     or profiles.student_id without the salt.
--   * The research export applies the same HMAC on both sides, so grades line
--     up with usage without a raw UUID ever entering the exported dataset.
--   * Destroying the salt after export converts the retained dataset from
--     pseudonymous to genuinely anonymous. That is the point, and it is the
--     part that should be written into the REB protocol and consent form.
--
-- Whoever holds the salt can re-identify. That is unavoidable for any design
-- that answers the research question, and it must be disclosed rather than
-- glossed over.
--
-- WHY APPEND-ONLY
-- ---------------
-- Students report scores as the term progresses (after each exam), not once at
-- the end. Appending means a late correction never destroys the earlier answer,
-- which matters for data integrity in a study. The export takes the latest row
-- per (pseudonym, item_key). Unlike the existing `contracts` table, which is
-- accidentally append-only and unindexed, this is deliberate and indexed for
-- the "latest per key" read.

-- ---------------------------------------------------------------------------
-- research_consent: append-only consent ledger
-- ---------------------------------------------------------------------------
-- Keyed by profile_id ON PURPOSE. Consent must be attributable to a real person
-- to be meaningful and to honour withdrawal. This table does not weaken the
-- pseudonymity of self_reported_grades: knowing that a student consented tells
-- you nothing about which grade rows are theirs without the salt.

CREATE TABLE research_consent (
  id               BIGSERIAL PRIMARY KEY,
  profile_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consent_version  TEXT NOT NULL,
  action           TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT research_consent_action_valid
    CHECK (action IN ('granted', 'withdrawn')),
  CONSTRAINT research_consent_version_len
    CHECK (char_length(consent_version) BETWEEN 1 AND 100)
);

-- The only read pattern: "what is this student's current consent state?"
CREATE INDEX research_consent_latest_idx
  ON research_consent(profile_id, created_at DESC);

ALTER TABLE research_consent ENABLE ROW LEVEL SECURITY;

-- Students may read their own consent history so the UI can render the correct
-- state (and so they can see that a withdrawal was in fact recorded).
CREATE POLICY research_consent_self_read ON research_consent
  FOR SELECT USING (auth.uid() = profile_id);

-- INTENTIONALLY no INSERT policy. Consent is recorded by the submit-grades
-- Edge Function under the service role, so consent_version is set by the
-- server from the deployed policy text rather than by the client. A student
-- must not be able to manufacture a consent record for a version they were
-- never shown.

-- ---------------------------------------------------------------------------
-- self_reported_grades: pseudonym-keyed, unjoinable without the salt
-- ---------------------------------------------------------------------------

CREATE TABLE self_reported_grades (
  id               BIGSERIAL PRIMARY KEY,

  -- HMAC-SHA256(RESEARCH_SALT, auth.uid()) as lowercase hex. Deliberately TEXT
  -- with a shape constraint rather than a FK: there is nothing to reference.
  pseudonym        TEXT NOT NULL,

  item_key         TEXT NOT NULL,

  -- Percentage 0-100. NUMERIC(5,2) admits 100.00 and one decimal of precision
  -- (e.g. 87.5), which is how McGill grades are usually reported back.
  score            NUMERIC(5,2) NOT NULL,

  -- The exact consent text version in force when this row was written, copied
  -- from the consent ledger at write time so the dataset is self-describing.
  consent_version  TEXT NOT NULL,

  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT self_reported_grades_pseudonym_shape
    CHECK (pseudonym ~ '^[0-9a-f]{64}$'),
  CONSTRAINT self_reported_grades_item_key_valid
    CHECK (item_key IN (
      'exam_1', 'exam_2', 'exam_3',
      'assignment_1', 'assignment_2', 'assignment_3', 'assignment_4'
    )),
  CONSTRAINT self_reported_grades_score_range
    CHECK (score >= 0 AND score <= 100)
);

-- Serves both reads we care about: "this student's current answers" (the UI,
-- via the Edge Function) and "latest row per key" (the export).
CREATE INDEX self_reported_grades_latest_idx
  ON self_reported_grades(pseudonym, item_key, submitted_at DESC);

ALTER TABLE self_reported_grades ENABLE ROW LEVEL SECURITY;

-- INTENTIONALLY no policies at all — not even SELECT.
--
-- With RLS enabled and zero policies, the anon and authenticated roles can do
-- nothing to this table; only the service role reaches it. This is the same
-- posture socratic-assistant uses for `sessions` and `turns`.
--
-- Students still see and edit their own answers: the submit-grades Edge
-- Function holds the salt, so it can compute the caller's pseudonym and read
-- their rows back. Read-back therefore requires proving you are that user via
-- a JWT, and never exposes the pseudonym itself to the browser.

-- ---------------------------------------------------------------------------
-- Feature flag, default OFF so the whole feature is dark until deliberately
-- switched on from /#/admin. Mirrors the AIAnalysis rollout.
-- ---------------------------------------------------------------------------

INSERT INTO activated(topic, activated)
VALUES ('GradeSelfReport', false)
ON CONFLICT DO NOTHING;
