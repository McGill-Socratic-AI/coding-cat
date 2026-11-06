// Guards the contract that every problem-set consumer reads the SAME set:
// getProblemSet (async) and getProblemSetSync (used by getCategoryList and
// getCompletedProblems) must both resolve the directory named by
// REACT_APP_PROBLEM_SET, and default to `problems` when it is unset.
//
// getProblemSetSync is mocked throughout so these tests never need the
// GENERATED src/problems/problems.js — CI's unit-test job does not build it.

export {};

const PROBLEMS = [
  { meta: { name: "beta", category: "strings", difficulty: "easy", question_type: ["coding"] } },
  { meta: { name: "alpha", category: "arrays", difficulty: "hard", question_type: ["coding"] } },
  { meta: { name: "gamma", category: "arrays", difficulty: "easy", question_type: ["coding"] } },
  { meta: { name: "delta", category: "arrays", difficulty: "easy", question_type: ["mutation"] } },
];

const ORIGINAL_ENV = process.env.REACT_APP_PROBLEM_SET;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.REACT_APP_PROBLEM_SET;
  else process.env.REACT_APP_PROBLEM_SET = ORIGINAL_ENV;
  jest.resetModules();
});

/** Loads problemSetDir fresh, with REACT_APP_PROBLEM_SET set to `value`. */
function dirFor(value: string | undefined): string {
  jest.resetModules();
  if (value === undefined) delete process.env.REACT_APP_PROBLEM_SET;
  else process.env.REACT_APP_PROBLEM_SET = value;
  return require("./problemSetDir").PROBLEM_SET_DIR;
}

/**
 * Loads a module with getProblemSetSync stubbed to return `problems`.
 * Returns the module's exports.
 */
function withProblems<T>(modulePath: string, problems: unknown[]): T {
  let loaded: T;
  jest.isolateModules(() => {
    jest.doMock("./getProblemSetSync", () => ({
      __esModule: true,
      default: () => problems,
    }));
    loaded = require(modulePath);
  });
  return loaded!;
}

describe("PROBLEM_SET_DIR", () => {
  it("defaults to the src/problems symlink when REACT_APP_PROBLEM_SET is unset", () => {
    expect(dirFor(undefined)).toBe("problems");
  });

  it("defaults to the src/problems symlink when REACT_APP_PROBLEM_SET is empty", () => {
    expect(dirFor("")).toBe("problems");
  });

  it("follows REACT_APP_PROBLEM_SET when it is set", () => {
    expect(dirFor("comp204-problems")).toBe("comp204-problems");
  });
});

describe("the selected problem set drives every consumer", () => {
  it("getProblemSetSync reads the directory PROBLEM_SET_DIR names", () => {
    jest.isolateModules(() => {
      jest.doMock("./problemSetDir", () => ({ PROBLEM_SET_DIR: "private-problems" }));
      jest.doMock("../private-problems/problems", () => ({ default: PROBLEMS }), { virtual: true });

      const getProblemSetSync = require("./getProblemSetSync").default;
      expect(getProblemSetSync()).toBe(PROBLEMS);
    });
  });

  it("getCategoryList derives its categories from the selected set", () => {
    const { getCategoryList } = withProblems<typeof import("./getCategoryList")>(
      "./getCategoryList",
      PROBLEMS,
    );
    // Sorted, de-duplicated, and nothing from any other problem set.
    expect(getCategoryList()).toEqual(["arrays", "strings"]);
  });

  it("getCategoryList follows the selected set rather than a hard-coded path", () => {
    const { getCategoryList } = withProblems<typeof import("./getCategoryList")>(
      "./getCategoryList",
      [{ meta: { name: "only", category: "recursion", difficulty: "easy", question_type: ["coding"] } }],
    );
    expect(getCategoryList()).toEqual(["recursion"]);
  });

  it("getCompletedProblems counts totals and completions from the selected set", () => {
    const { getCompletedProblems } = withProblems<typeof import("./getCompletedProblems")>(
      "./getCompletedProblems",
      PROBLEMS,
    );

    const summary = getCompletedProblems([
      { problem_title: "alpha", passed_tests: 3, total_tests: 3 },
      { problem_title: "gamma", passed_tests: 1, total_tests: 3 },
    ] as any);

    const byCategory = Object.fromEntries(summary.map((s) => [s.category, s]));

    expect(Object.keys(byCategory).sort()).toEqual(["arrays", "mutation", "strings"]);
    expect(byCategory.arrays).toMatchObject({
      total: 2,
      completed: 1,
      question_type: "coding",
      problems: [{ title: "alpha", difficulty: "hard" }],
    });
    expect(byCategory.strings).toMatchObject({ total: 1, completed: 0, problems: [] });
    // question_type wins over category for non-coding problems.
    expect(byCategory.mutation).toMatchObject({ total: 1, completed: 0, question_type: "mutation" });
  });
});
