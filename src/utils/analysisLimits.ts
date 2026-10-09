// Follow-up conversation limits, shared by the hook, the panel and their tests.
//
// These mirror supabase/functions/analyze/thread.ts (MAX_FOLLOWUPS_PER_THREAD,
// MAX_FOLLOWUP_LEN) — keep the two in sync; the CRA app and the Deno function
// cannot share a file.
//
// They live here rather than in src/types.ts on purpose: types.ts imports
// getCategoryList, which imports the GENERATED src/problems/problems.js. Only
// type imports from types.ts are erased by Babel, so importing a runtime value
// from it drags that generated module into every Jest run — and CI's unit-test
// job does not run `npm run build-problems`.
export const MAX_FOLLOWUPS_PER_THREAD = 10;
export const MAX_FOLLOWUP_LEN = 2000;
