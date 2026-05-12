-- =============================================================================
-- Migration: fix contract default shape inserted by handle_new_user
--
-- Companion to 20260511000000_user_creation_trigger.sql.
--
-- Background: that migration's trigger inserted '{}'::jsonb as the default
-- contract data, which crashes root.tsx at `contract.Coding.problemsToSolveByCategory`
-- because the shape doesn't match src/types.ts:BLANK_CONTRACT. New signups
-- and any pre-existing user who got backfilled now hit the same crash with
-- a different error message ("Cannot read properties of undefined (reading
-- 'problemsToSolveByCategory')") instead of the original PGRST116.
--
-- This migration:
-- 1. Replaces handle_new_user() to insert a default ContractData matching
--    BLANK_CONTRACT (Coding/Mutation/Haystack keys, empty
--    problemsToSolveByCategory map — the FE populates it dynamically from
--    getCategoryList() on first upsert).
-- 2. Updates any existing rows that still have '{}'::jsonb (only those —
--    rows with real contract data from prior upserts are untouched).
-- =============================================================================


-- The default shape mirrors src/types.ts:BLANK_CONTRACT. Keep them in sync
-- if either side changes.
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


-- Repair rows that the previous version of handle_new_user backfilled with
-- '{}'::jsonb. We intentionally narrow to exact '{}' so user-saved contracts
-- (even partially shaped ones) are never overwritten.
UPDATE public.contracts
SET data = jsonb_build_object(
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
)
WHERE data = '{}'::jsonb;
