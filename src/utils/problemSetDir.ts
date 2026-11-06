// The directory under `src/` that holds the active problem set, selected by the
// `REACT_APP_PROBLEM_SET` environment variable and defaulting to `problems`
// (the `src/problems` symlink).
//
// It lives in its own module so that every consumer — the async loader
// (getProblemSet) and the synchronous one (getProblemSetSync) — resolves the
// SAME set, and so a module can read the name without pulling in the generated
// problems.js.
export const PROBLEM_SET_DIR = process.env.REACT_APP_PROBLEM_SET || "problems";
