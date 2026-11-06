import type { Problem } from "../types";
import { PROBLEM_SET_DIR } from "./problemSetDir";

/**
 * Synchronous counterpart to getProblemSet: returns the problem set selected by
 * `REACT_APP_PROBLEM_SET`, defaulting to `src/problems`.
 *
 * Needed because `types.ts` builds `BLANK_CONTRACT` at module-evaluation time
 * from getCategoryList(), so the category list cannot be awaited. The template
 * literal keeps the same `../<dir>/problems` shape webpack already resolves for
 * getProblemSet's dynamic import, so both loaders see the same candidate
 * directories; `require` only makes this one eager instead of a lazy chunk.
 * Eager means every `src/<dir>/problems` that exists at build time lands in the
 * main bundle, so build only the set you intend to ship.
 */
export default function getProblemSetSync(): Problem[] {
  return require(`../${PROBLEM_SET_DIR}/problems`).default;
}
