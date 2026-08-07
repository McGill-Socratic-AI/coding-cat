import { Problem } from "../types";

// TODO: since mutation and haystack aren't considered categories,
// the array this function returns doesn't contain them. if the issue
// of the problem type/category nesting is resolved, this may not be a problem anymore.

/**
 * The sorted set of categories present in a problem set.
 *
 * Takes the problem set as an argument rather than importing it. This module
 * used to `import problems from "../problems/problems"`, which silently
 * bypassed `REACT_APP_PROBLEM_SET` — so with a second problem set configured,
 * the app rendered problems from one set and categories from another. Callers
 * pass the set they actually loaded via `getProblemSet()`.
 */
export function getCategoryList(problems: Problem[]) {
  const categories = new Set<string>();

  problems.forEach((p) => {
    categories.add(p.meta.category);
  });

  return Array.from(categories).sort();
}
