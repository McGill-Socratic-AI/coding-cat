// What the contract page knows about contracts: which per-category targets it
// offers, and how a stored row becomes a renderable contract.
//
// Note the runtime dependency: getCategoryList loads the SELECTED problem set's
// generated problems.js, so a test that imports this module must stub
// ./getProblemSetSync the way src/utils/problemSet.test.ts does, or it will
// need `npm run build-problems` (CI's unit-test job does not run it).
import type { CodingContract, ContractData, GenericContract } from "../types";
import { getCategoryList } from "./getCategoryList";

// The categories the public problem set's first coding stage covers. They are a
// property of that one set — the four names only exist in `public-problems` —
// so they apply only to a set that has all four, and any other problem set
// (COMP 204's, for instance) offers every category it defines instead.
const PUBLIC_PROBLEMS_STAGE_1_CATEGORIES = ["Fundamentals", "Logic", "String-1", "List-1: Indexing"];

/**
 * The categories the contract page shows and edits, in display order.
 *
 * Derived from the selected problem set rather than from the stored contract:
 * a freshly seeded row carries an empty `problemsToSolveByCategory` map (see
 * `handle_new_user`), so reading the keys off the contract showed a student no
 * targets at all.
 *
 * `codingStage2` is the `CodingStage2` feature flag: with it off, a set that
 * defines the public stage-1 categories is narrowed to those four, which is
 * what `public-problems` has always shown.
 */
export function getContractCategories(codingStage2: boolean): string[] {
  const all = getCategoryList();
  if (codingStage2) return all;

  const stage1 = PUBLIC_PROBLEMS_STAGE_1_CATEGORIES.filter((c) => all.includes(c));
  return stage1.length === PUBLIC_PROBLEMS_STAGE_1_CATEGORIES.length ? stage1 : all;
}

/** A stored `contracts.data` row: any part of it may be missing or empty. */
type StoredContract = {
  Coding?: Partial<CodingContract>;
  Haystack?: Partial<GenericContract>;
  Mutation?: Partial<GenericContract>;
};

/**
 * Overlays a stored `contracts.data` row on `blank` (BLANK_CONTRACT).
 *
 * The page must never render straight from the row: `handle_new_user` seeds
 * `problemsToSolveByCategory` as `{}`, so replacing the blank contract with the
 * row wholesale left the per-category targets with no keys to render. The merge
 * floors that map at zero for every category of the SELECTED problem set — read
 * here rather than taken from `blank`, whose map was fixed when `types.ts` was
 * first evaluated — and lets the row override the targets the student has
 * actually set. Categories the row carries but the set no longer defines are
 * kept, so saving one section never silently drops a target.
 */
export function mergeContract(blank: ContractData, stored: unknown): ContractData {
  const row = (stored ?? {}) as StoredContract;
  const noTargets = Object.fromEntries(getCategoryList().map((c) => [c, 0]));

  return {
    Coding: {
      ...blank.Coding,
      ...row.Coding,
      problemsToSolveByCategory: {
        ...noTargets,
        ...row.Coding?.problemsToSolveByCategory,
      },
    },
    Haystack: { ...blank.Haystack, ...row.Haystack },
    Mutation: { ...blank.Mutation, ...row.Mutation },
  };
}
