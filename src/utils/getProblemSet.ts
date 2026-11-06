import type { Problem } from "../types";
import { PROBLEM_SET_DIR } from "./problemSetDir";

/**
 * Returns the current problem set as defined by the `REACT_APP_PROBLEM_SET` environment variable.
 * If no variable is defined, it uses the `src/problems` symlink (see problemSetDir).
 */
export default async function getProblemSet(): Promise<Problem[]> {
  return (await import(`../${PROBLEM_SET_DIR}/problems`)).default;
}
