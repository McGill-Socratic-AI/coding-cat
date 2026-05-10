-- =============================================================================
-- Seed: existing schema for coding-cat
--
-- ⚠️  FOR FRESH PROJECTS ONLY.
--
-- Do NOT apply this migration to a Supabase project that already has the
-- `activated`, `profiles`, `submissions`, or `contracts` tables — the
-- CREATE TABLE statements are unguarded and will fail with
-- "relation already exists", aborting the migration batch.  This will
-- block the subsequent ai_analysis migration from applying as well.
--
-- Intended use: spinning up a developer's own staging Supabase project
-- without needing access to the production schema.  On the production
-- project (which already has these tables), pre-mark this migration as
-- applied so `supabase db push` skips it:
--
--     INSERT INTO supabase_migrations.schema_migrations (version)
--       VALUES ('00000000000000');
--
-- Timestamp 00000000000000 sorts BEFORE all other migrations (including
-- 20260508095419_ai_analysis.sql which INSERT-references activated).
--
-- Reconstruction method: read every .from('<table>') call in src/, plus TS
-- interface definitions in src/types.ts.  Comments on each column note where
-- the inference came from.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- TABLE: activated
-- Source: src/routes/AdminPage.tsx  (select, update)
--         src/components/profile/contract/Contract.tsx  (select)
--         supabase/migrations/20260508095419_ai_analysis.sql  (INSERT reference)
--
-- Purpose: feature-flag table.  Each row is one named feature flag.
--
-- Columns inferred from:
--   .select('topic, activated')               → topic TEXT, activated BOOL
--   .update({ activated: f.activated })       → activated is BOOLEAN
--   .eq('topic', f.topic)                     → topic is the natural PK / unique key
--   AdminPage.tsx orders by 'topic'           → topic is TEXT
--
-- No surrogate PK observed in any query; the FE always addresses rows by
-- `topic`.  Using topic as PRIMARY KEY makes the ON CONFLICT in
-- 20260508095419_ai_analysis.sql work naturally.
-- ---------------------------------------------------------------------------

CREATE TABLE activated (
    topic       TEXT        PRIMARY KEY,              -- feature name, e.g. 'Haystack', 'Mutation', 'CodingStage2', 'AIAnalysis'
    activated   BOOLEAN     NOT NULL DEFAULT false    -- whether the feature is enabled
);

ALTER TABLE activated ENABLE ROW LEVEL SECURITY;

-- Any authenticated user may read feature flags (the FE reads them without a
-- privileged client, e.g. Contract.tsx, ProblemView.tsx).
CREATE POLICY activated_read_all ON activated
    FOR SELECT USING (true);   -- public/anonymous read is fine; flags are not sensitive

-- Admin writes go through the user-bound (anon-key) client from AdminPage.tsx,
-- so the policy must allow writes when profiles.is_admin = true for the
-- caller.  Anyone non-admin still gets blocked by RLS.
CREATE POLICY activated_admin_write ON activated
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profile_id = auth.uid() AND is_admin = true
        )
    );                         -- AdminPage.tsx (anon-key client) needs this to flip flags.


-- ---------------------------------------------------------------------------
-- TABLE: profiles
-- Source: src/routes/root.tsx           (select is_admin)
--         src/components/profile/UserInfo.tsx  (select username/student_id; upsert)
--
-- Columns inferred from:
--   .select('is_admin')                       → is_admin BOOLEAN
--   .select('username, student_id')           → username TEXT, student_id TEXT
--   .eq('profile_id', session.user.id)        → profile_id UUID (FK to auth.users)
--   upsert({ profile_id, username, student_id, updated_at })
--                                             → updated_at TIMESTAMPTZ
--
-- NOTE: profile_id is used as the lookup key (eq filter) AND as the upsert
-- conflict key, so it is the PRIMARY KEY (UUID, not BIGSERIAL).
-- ---------------------------------------------------------------------------

CREATE TABLE profiles (
    profile_id  UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
                                                -- same as auth.users.id; FE passes session.user.id
    username    TEXT,                           -- display name, nullable (UI shows "Unnamed User" fallback)
    student_id  TEXT,                           -- school/course ID, nullable (UI shows "#" fallback)
    is_admin    BOOLEAN     NOT NULL DEFAULT false,
                                                -- used in root.tsx to gate the Admin link
    updated_at  TIMESTAMPTZ DEFAULT now()       -- set explicitly on upsert in UserInfo.tsx
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Users may read and write their own profile row.
CREATE POLICY profiles_self_select ON profiles
    FOR SELECT USING (auth.uid() = profile_id);

CREATE POLICY profiles_self_insert ON profiles
    FOR INSERT WITH CHECK (auth.uid() = profile_id);

CREATE POLICY profiles_self_update ON profiles
    FOR UPDATE USING (auth.uid() = profile_id);

-- VERIFY: root.tsx reads profiles.is_admin for *every* authenticated user on
-- every page load; the SELECT policy above covers that.  If you want admins to
-- be able to view other profiles, add a separate policy.


-- ---------------------------------------------------------------------------
-- TABLE: submissions
-- Source: src/hooks/useEval.tsx         (select submission_id/code; update; insert)
--         src/routes/Account.tsx        (select many columns)
--         src/routes/ProblemView.tsx    (select code)
--         src/components/ProblemList.tsx (select problem_title/passed_tests/total_tests/question_type)
--         src/components/CategoryList.tsx (same four columns)
--         src/components/ReflectionInput.tsx (update reflection)
--
-- Full column list (union of all .select() and insert payload):
--   submission_id   – .eq('submission_id', json.submission_id)  → surrogate PK
--   profile_id      – .eq('profile_id', user.id)                → UUID FK
--   problem_title   – .eq('problem_title', ...)                  → TEXT
--   problem_category– Account.tsx select                         → TEXT
--   question_type   – insert payload & ProblemList select        → TEXT
--   code            – insert payload & ProblemView select
--                     types.ts Reflection.code = {code:string}|[{Input,Expected}][]
--                     useEval builds: { code: string } OR plain string for mutation
--                                                                → JSONB
--   passed_tests    – insert + select                            → INTEGER
--   total_tests     – insert + select                            → INTEGER
--   reflection      – ReflectionInput updates {question,answer}
--                     types.ts Reflection.reflection = string | {question,answer}
--                                                                → JSONB (nullable)
--   submitted_at    – insert + order                             → TIMESTAMPTZ
-- ---------------------------------------------------------------------------

CREATE TABLE submissions (
    submission_id   BIGSERIAL   PRIMARY KEY,
    profile_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    problem_title   TEXT        NOT NULL,       -- problem meta.name (slug), e.g. "two-sum"
    problem_category TEXT       NOT NULL,       -- problem meta.category, e.g. "Fundamentals"
    question_type   TEXT        NOT NULL,       -- "coding" | "haystack" | "mutation"
    code            JSONB,                      -- {code: string} for coding/haystack;
                                                -- raw string stored in JSONB for mutation.
                                                -- Nullable to allow rows where code was not re-stored.
    passed_tests    INTEGER     NOT NULL DEFAULT 0,
    total_tests     INTEGER     NOT NULL DEFAULT 0,
    reflection      JSONB,                      -- nullable; set later via ReflectionInput.
                                                -- Shape: {question: string, answer: string}
                                                -- (older rows may be plain string — use JSONB to handle both)
    submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX submissions_profile_title_idx
    ON submissions(profile_id, problem_title, submitted_at DESC);

CREATE INDEX submissions_profile_idx
    ON submissions(profile_id);

ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;

-- Users may read their own submissions.
CREATE POLICY submissions_self_select ON submissions
    FOR SELECT USING (auth.uid() = profile_id);

-- Users may insert their own submissions (useEval.tsx .insert([submission])).
CREATE POLICY submissions_self_insert ON submissions
    FOR INSERT WITH CHECK (auth.uid() = profile_id);

-- Users may update their own submissions (useEval.tsx updates submitted_at;
-- ReflectionInput updates reflection).
CREATE POLICY submissions_self_update ON submissions
    FOR UPDATE USING (auth.uid() = profile_id);


-- ---------------------------------------------------------------------------
-- TABLE: contracts
-- Source: src/components/profile/contract/Contract.tsx  (select, upsert)
--         src/routes/root.tsx                           (select data)
--
-- Columns inferred from:
--   .select('data, updated_at')               → data JSONB, updated_at TIMESTAMPTZ
--   .eq('profile_id', session?.user.id)       → profile_id UUID FK
--   .order('updated_at', {ascending:false})   → updated_at TIMESTAMPTZ
--   upsert({ profile_id, data, updated_at })
--
--   data shape from src/types.ts ContractData:
--     { Coding: CodingContract, Haystack: GenericContract, Mutation: GenericContract }
--   → stored as JSONB
--
-- NOTE: The FE uses .upsert({ profile_id, data, updated_at }) with no explicit
-- onConflict option, so Supabase will default to the PRIMARY KEY.
-- One row per user is the intended use (latest contract).  However the FE also
-- does .order('updated_at').limit(1), which implies multiple rows per user are
-- possible (history).  We model it with a BIGSERIAL PK to allow history rows,
-- which is consistent with both patterns.
-- ---------------------------------------------------------------------------

CREATE TABLE contracts (
    id          BIGSERIAL   PRIMARY KEY,
    profile_id  UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    data        JSONB       NOT NULL,           -- ContractData JSON blob (see src/types.ts)
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX contracts_profile_updated_idx
    ON contracts(profile_id, updated_at DESC);

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

-- Users may read their own contracts.
CREATE POLICY contracts_self_select ON contracts
    FOR SELECT USING (auth.uid() = profile_id);

-- Users may insert their own contracts.
CREATE POLICY contracts_self_insert ON contracts
    FOR INSERT WITH CHECK (auth.uid() = profile_id);

-- Users may update their own contracts (upsert hits UPDATE path).
CREATE POLICY contracts_self_update ON contracts
    FOR UPDATE USING (auth.uid() = profile_id);

-- VERIFY: Contract.tsx uses .upsert({ profile_id, data, updated_at }).
-- Without an explicit onConflict column, PostgREST upserts on the PK (id).
-- That means every save creates a NEW row (history), which is consistent with
-- the .order('updated_at').limit(1) pattern used to fetch the latest contract.
-- If you want true single-row upsert per user, add:
--   UNIQUE (profile_id)
-- and change the FE call to .upsert({...}, { onConflict: 'profile_id' }).


-- ---------------------------------------------------------------------------
-- Seed data: default feature flags
-- These match the flags referenced in the frontend code.
-- The ai_analysis migration adds 'AIAnalysis' later via ON CONFLICT DO NOTHING.
-- ---------------------------------------------------------------------------

INSERT INTO activated (topic, activated) VALUES
    ('Haystack',      false),
    ('Mutation',      false),
    ('CodingStage2',  false)
ON CONFLICT (topic) DO NOTHING;
