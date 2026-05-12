-- =============================================================================
-- Migration: auto-create profiles and contracts rows on new user signup
--
-- Closes #22.
--
-- Background: the seed migration reverse-engineered the schema from FE code
-- but the original Postgres trigger that auto-creates a profile + contract
-- per new auth.users row is invisible from FE source, so it was missed.
--
-- Without this trigger, root.tsx's `.from('profiles').select('is_admin')
-- .eq('profile_id', user.id).single()` errors with PGRST116 ("Cannot coerce
-- the result to a single JSON object") for any newly-registered user, and
-- Contract.tsx crashes on `data[0].data` (no row exists).
--
-- This migration is idempotent on the trigger side (DROP IF EXISTS first)
-- and uses ON CONFLICT DO NOTHING for the backfill so re-running is safe
-- and existing contract data is never overwritten.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Function: public.handle_new_user
--
-- Runs on every INSERT into auth.users. Inserts a corresponding row into
-- public.profiles (keyed by the new auth user id) and a default empty
-- contract row into public.contracts.
--
-- SECURITY DEFINER is required because auth.users is owned by the
-- `supabase_auth_admin` role; without it the trigger would run as that
-- role and would be blocked by public.profiles / public.contracts RLS.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (profile_id)
        VALUES (NEW.id)
        ON CONFLICT (profile_id) DO NOTHING;

    INSERT INTO public.contracts (profile_id, data)
        VALUES (NEW.id, '{}'::jsonb)
        ON CONFLICT DO NOTHING;

    RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------------
-- Trigger: on_auth_user_created
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();


-- ---------------------------------------------------------------------------
-- Backfill: any pre-existing auth.users without a profiles / contracts row
--
-- New users from now on will be covered by the trigger above. This block
-- closes the gap for users created before the trigger existed (e.g. test
-- accounts created via Supabase Dashboard on staging).
-- ---------------------------------------------------------------------------

INSERT INTO public.profiles (profile_id)
SELECT u.id
FROM auth.users u
LEFT JOIN public.profiles p ON p.profile_id = u.id
WHERE p.profile_id IS NULL
ON CONFLICT (profile_id) DO NOTHING;

INSERT INTO public.contracts (profile_id, data)
SELECT u.id, '{}'::jsonb
FROM auth.users u
LEFT JOIN public.contracts c ON c.profile_id = u.id
WHERE c.profile_id IS NULL;
