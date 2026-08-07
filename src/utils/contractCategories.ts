/**
 * Which coding categories a contract should show.
 *
 * The contract is staged: until the `CodingStage2` flag is on, students only
 * commit to the first four categories. That list is hardcoded because it names
 * a pedagogical stage, not a property of the data.
 *
 * The subtlety is what happens when none of those names exist. Both contract
 * views used to compute the intersection and render it directly, which is fine
 * for the upstream problem set and renders an entirely empty contract for any
 * other one — COMP204's categories share no names with these, so a student
 * would open their contract and find nothing to fill in.
 *
 * So the stage filter is treated as a preference, not a constraint: when it
 * selects nothing, fall back to every category the contract actually has.
 */
const STAGE_ONE_CATEGORIES = ["Fundamentals", "Logic", "String-1", "List-1: Indexing"];

export function contractCategories(
  allCategories: string[],
  codingStage2: boolean,
): string[] {
  if (codingStage2) return allCategories;

  const staged = STAGE_ONE_CATEGORIES.filter((c) => allCategories.includes(c));
  return staged.length > 0 ? staged : allCategories;
}
