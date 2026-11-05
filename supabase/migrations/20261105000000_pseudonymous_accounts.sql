-- =============================================================================
-- Migration: pseudonymous accounts
--
-- Coding Cat is self-hosted for a single course and reached only from the
-- school network. We must be able to tell that a given user is always the same
-- person, and we must NOT be able to tie that person to a named student. The
-- email magic link did the opposite: `auth.users.email` held the student's real
-- address, and the profile page printed it.
--
-- The replacement, implemented by the `account` Edge Function
-- (supabase/functions/account/):
--
--   * a student registers with a self-chosen username and a password;
--   * Supabase still gets an `email` because GoTrue requires one, but it is a
--     random placeholder at a reserved-for-testing domain (RFC 2606 `.invalid`),
--     so it is undeliverable and identifies nobody;
--   * `profiles.username` is the public, pseudonymous handle AND the login name
--     (the function resolves username -> auth user, never the browser);
--   * a one-time recovery code replaces "email me a link"; only a salted hash
--     of it is stored, in `account_recovery`.
--
-- What this migration changes:
--   1. drops `profiles.student_id` — a student number is exactly the field that
--      de-pseudonymises a user, so the column must not exist to be filled in;
--   2. makes `profiles.username` unique and constrains its shape, so it can be
--      a login name and cannot itself be an email address or a student number;
--   3. adds `account_recovery`, service-role-only, holding the recovery hash;
--   4. teaches `handle_new_user` to copy the username out of the new auth
--      user's metadata, so profile creation and the uniqueness check happen in
--      the same transaction as the auth user insert — a taken username fails
--      the signup instead of leaving an orphaned auth user behind.
--
-- No data migration: the VM this runs on starts with no users, and cloud
-- accounts are deliberately not carried over (their emails are the problem).
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. Drop the student number
--
-- `student_id` was collected by the old profile editor (UserInfo.tsx). Both the
-- field and the editor are gone. Dropping the column is the point: no code path
-- can reintroduce it by accident, and nothing is left to leak.
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles DROP COLUMN IF EXISTS student_id;


-- ---------------------------------------------------------------------------
-- 2. `profiles.username` becomes the login name
--
-- Stored already-normalised (trimmed, lower-cased) by the account function, so
-- a plain unique index is enough — no need for a functional index, and no LIKE
-- matching anywhere (`_` is a username character and a LIKE wildcard).
--
-- Still nullable: `handle_new_user` runs for every auth.users insert, including
-- one made from the Supabase dashboard with no username metadata. Such a user
-- simply has no way to sign in through the app, which is the safe failure.
-- NULLs do not collide under a UNIQUE index.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_key
    ON public.profiles (username);

-- Shape rules, kept in step with the two copies of the policy in code:
--   supabase/functions/account/username.ts  (authoritative, server-side)
--   src/utils/username.ts                   (same rules, for instant feedback)
--
--   * 3-24 characters, starts with a letter, then letters / digits / _ / -
--     (lower-case only, because the function normalises before writing);
--   * no '@' and no '.', so a username cannot be an email address;
--   * no run of 5 or more digits and no more than 6 digits in total, so it
--     cannot be a 9-digit student number (or an obvious slice of one).
--
-- NOT VALID on purpose: this is a new rule, and the staging/cloud project has
-- pre-existing rows whose usernames were free-form display names ("Jane Doe").
-- NOT VALID enforces the rule on every INSERT and UPDATE from now on without
-- demanding that history satisfy it. The VM starts empty, so there every row
-- satisfies it anyway.
ALTER TABLE public.profiles
    DROP CONSTRAINT IF EXISTS profiles_username_policy;

ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_username_policy CHECK (
        username IS NULL
        OR (
            username ~ '^[a-z][a-z0-9_-]{2,23}$'
            AND username !~ '[0-9]{5}'
            AND length(regexp_replace(username, '[^0-9]', '', 'g')) <= 6
        )
    ) NOT VALID;

COMMENT ON COLUMN public.profiles.username IS
    'Pseudonymous handle, also the login name. Normalised lower-case. Never a real name, email or student number — see profiles_username_policy.';


-- ---------------------------------------------------------------------------
-- 3. `account_recovery` — the one-time recovery code, hashed
--
-- With no email address there is no "send me a reset link", so a code shown
-- once at registration is the student's only way back into their account. Only
-- a hash of it is stored, so a database dump cannot be used to take accounts
-- over, and a lost code cannot be re-read by anyone, us included.
--
-- Format of `recovery_code_hash` is `s256$<salt hex>$<sha256 hex>` and is
-- produced and checked by supabase/functions/account/recovery.ts.
--
-- One-time-ness is enforced by replacement: redeeming a code immediately
-- overwrites this row with the hash of a freshly issued code, so the redeemed
-- code stops working and the student is never left without a way back.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.account_recovery (
    profile_id          UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    recovery_code_hash  TEXT        NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.account_recovery ENABLE ROW LEVEL SECURITY;

-- INTENTIONALLY no policy of any kind: RLS is on and no policy exists, so
-- neither `anon` nor `authenticated` can read, insert, update or delete here.
-- Every access goes through the account Edge Function's service-role client,
-- which bypasses RLS. A student must not be able to read their own hash (it
-- would make a stolen session enough to brute-force the code offline) nor to
-- write one (it would let them re-point recovery at a code they chose).
--
-- Belt and braces: Supabase's default privileges hand the API roles table
-- grants on anything new in `public`, and RLS is then the only thing standing
-- between them and this table. Take the grants away too, so a future policy
-- added here by mistake still cannot expose it.
REVOKE ALL ON public.account_recovery FROM anon, authenticated;

COMMENT ON TABLE public.account_recovery IS
    'Salted hash of each account''s current recovery code. Service-role only: no RLS policies exist, by design.';


-- ---------------------------------------------------------------------------
-- 4. `handle_new_user` also lands the username
--
-- Supersedes the version in 20260511100000_fix_contract_default_shape.sql; the
-- contract default below is unchanged from it and must stay in step with
-- src/types.ts:BLANK_CONTRACT.
--
-- Why the username travels in `raw_user_meta_data`: the account function needs
-- "create the auth user and claim the username" to be one atomic step. This
-- trigger runs inside the transaction that inserts into auth.users, so a
-- username already taken raises a unique violation here and aborts the whole
-- insert — the signup fails and no auth user is left stranded without a
-- profile. The metadata value is only ever read here, at insert time, so a
-- later self-service `updateUser({ data: ... })` cannot move an account onto
-- somebody else's handle.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_username TEXT := NULLIF(trim(NEW.raw_user_meta_data->>'username'), '');
BEGIN
    INSERT INTO public.profiles (profile_id, username)
        VALUES (NEW.id, v_username)
        ON CONFLICT (profile_id) DO NOTHING;

    INSERT INTO public.contracts (profile_id, data)
        VALUES (NEW.id, jsonb_build_object(
            'Coding',   jsonb_build_object(
                'gradeWanted', '',
                'problemsToSolveByCategory', '{}'::jsonb,
                'codeDescription', '',
                'reflectionPlan', ''
            ),
            'Mutation', jsonb_build_object(
                'gradeWanted', '',
                'problemsToSolve', 0,
                'codeDescription', '',
                'reflectionPlan', ''
            ),
            'Haystack', jsonb_build_object(
                'gradeWanted', '',
                'problemsToSolve', 0,
                'codeDescription', '',
                'reflectionPlan', ''
            )
        ));

    RETURN NEW;
END;
$$;
