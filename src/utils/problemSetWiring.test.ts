import { getCategoryList } from './getCategoryList';
import { getCompletedProblems } from './getCompletedProblems';
import { blankContract } from '../types';
import { Problem, Submission } from '../types';

// Regression guard for the REACT_APP_PROBLEM_SET bypass.
//
// getCategoryList and getCompletedProblems used to `import problems from
// "../problems/problems"`, a hardcoded path that ignored REACT_APP_PROBLEM_SET.
// With a second problem set configured, the app rendered problems from the
// configured set but computed categories and progress totals from the default
// one. These tests pin the fix: both functions must derive everything from the
// set they are handed.

function problem(name: string, category: string, question_type = 'coding'): Problem {
  return {
    description: '',
    starter: '',
    meta: {
      name,
      title: name,
      difficulty: 'easy',
      author: 'test',
      category,
      question_type: [question_type],
    },
    io: [],
  };
}

const COMP204_SET: Problem[] = [
  problem('read_fasta', 'Files'),
  problem('gc_content', 'Files'),
  problem('codon_table', 'Dictionaries'),
];

const DEFAULT_SET: Problem[] = [
  problem('calculate_absolute', 'Fundamentals'),
  problem('is_even', 'Logic'),
];

describe('getCategoryList', () => {
  test('returns only the categories of the set it is given', () => {
    expect(getCategoryList(COMP204_SET)).toEqual(['Dictionaries', 'Files']);
    expect(getCategoryList(DEFAULT_SET)).toEqual(['Fundamentals', 'Logic']);
  });

  test('does not leak categories between two different sets', () => {
    // The bug: whatever set you passed, you got the default set's categories.
    expect(getCategoryList(COMP204_SET)).not.toContain('Fundamentals');
  });

  test('deduplicates and sorts', () => {
    expect(getCategoryList([...COMP204_SET, problem('extra', 'Files')]))
      .toEqual(['Dictionaries', 'Files']);
  });

  test('handles an empty set', () => {
    expect(getCategoryList([])).toEqual([]);
  });
});

describe('getCompletedProblems', () => {
  const noSubmissions: Submission[] = [];

  test('totals come from the set it is given', () => {
    const summary = getCompletedProblems(COMP204_SET, noSubmissions);
    const files = summary.find((s) => s.category === 'Files');

    expect(files?.total).toBe(2);
    expect(summary.map((s) => s.category).sort()).toEqual(['Dictionaries', 'Files']);
  });

  test('counts a problem as complete only when every test passed', () => {
    const submissions: Submission[] = [
      { problem_title: 'read_fasta', passed_tests: 5, total_tests: 5 },
      { problem_title: 'gc_content', passed_tests: 3, total_tests: 5 },
    ];

    const files = getCompletedProblems(COMP204_SET, submissions)
      .find((s) => s.category === 'Files');

    expect(files?.completed).toBe(1);
    expect(files?.total).toBe(2);
    expect(files?.problems.map((p) => p.title)).toEqual(['read_fasta']);
  });

  test('a submission for a problem outside the set does not inflate progress', () => {
    // Exactly what the bug produced: progress recorded against the other set.
    const submissions: Submission[] = [
      { problem_title: 'calculate_absolute', passed_tests: 5, total_tests: 5 },
    ];

    const summary = getCompletedProblems(COMP204_SET, submissions);
    expect(summary.every((s) => s.completed === 0)).toBe(true);
  });

  test('mutation and haystack are bucketed by question type, not category', () => {
    const set = [...COMP204_SET, problem('flip_mutation', 'Files', 'mutation')];
    const summary = getCompletedProblems(set, noSubmissions);

    expect(summary.find((s) => s.category === 'mutation')?.total).toBe(1);
    expect(summary.find((s) => s.category === 'Files')?.total).toBe(2);
  });

  test('handles an empty set', () => {
    expect(getCompletedProblems([], noSubmissions)).toEqual([]);
  });
});

describe('blankContract', () => {
  test('is keyed by the categories it is given', () => {
    const contract = blankContract(getCategoryList(COMP204_SET));
    expect(Object.keys(contract.Coding.problemsToSolveByCategory).sort())
      .toEqual(['Dictionaries', 'Files']);
  });

  test('every category starts at zero', () => {
    const contract = blankContract(['Files', 'Dictionaries']);
    expect(Object.values(contract.Coding.problemsToSolveByCategory))
      .toEqual([0, 0]);
  });

  test('tolerates no categories, for state initialised before the set loads', () => {
    const contract = blankContract([]);
    expect(contract.Coding.problemsToSolveByCategory).toEqual({});
    expect(contract.Mutation.problemsToSolve).toBe(0);
  });
});
