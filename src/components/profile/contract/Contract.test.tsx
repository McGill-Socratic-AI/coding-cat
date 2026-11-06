import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { supabase } from '../../../supabaseClient';

// The contract page used to render its per-category targets from the keys of
// the stored contract row, and to narrow them with four category names that
// only exist in `public-problems`. `handle_new_user` seeds a row whose
// `problemsToSolveByCategory` is `{}`, so a student saw NO category at all —
// on any problem set, with CodingStage2 either on or off. These tests are the
// regression guard: the categories must come from the selected problem set.

// A problem set with COMP 204's categories: only `Fundamentals` is one of the
// four names the page used to hard-code.
const mockComp204 = [
  { meta: { name: 'a', category: 'Fundamentals', difficulty: 'easy', question_type: ['coding'] } },
  { meta: { name: 'b', category: 'Loops', difficulty: 'easy', question_type: ['coding'] } },
  { meta: { name: 'c', category: 'Dictionaries', difficulty: 'hard', question_type: ['coding'] } },
];

// The public set's categories, of which the four stage-1 names are a subset.
const mockPublic = [
  { meta: { name: 'a', category: 'Fundamentals', difficulty: 'easy', question_type: ['coding'] } },
  { meta: { name: 'b', category: 'Logic', difficulty: 'easy', question_type: ['coding'] } },
  { meta: { name: 'c', category: 'String-1', difficulty: 'easy', question_type: ['coding'] } },
  { meta: { name: 'd', category: 'List-1: Indexing', difficulty: 'easy', question_type: ['coding'] } },
  { meta: { name: 'e', category: 'String-2', difficulty: 'hard', question_type: ['coding'] } },
];

// Reassigned per test, and read when the stub is CALLED, so each test can pick
// the problem set it wants. It starts EMPTY on purpose: BLANK_CONTRACT is built
// from whatever the set holds when types.ts is first imported, and an empty one
// keeps a test from passing on categories that leaked in from that first read.
let mockProblems: unknown[] = [];

jest.mock('../../../utils/getProblemSetSync', () => ({
  __esModule: true,
  default: () => mockProblems,
}));

jest.mock('../../../supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('react-router-dom', () => ({
  useOutletContext: () => ({ session: { user: { id: 'profile-1' } } }),
}));

const mockFrom = supabase.from as unknown as jest.Mock;

// `require`d rather than imported: an import of Contract runs before the stub
// data above is initialized, and types.ts reads the problem set the moment it
// is imported (it builds BLANK_CONTRACT from it).
const Contract: () => JSX.Element = require('./Contract').default;

/** Exactly the row `handle_new_user` seeds: every category target missing. */
const SEEDED_ROW = {
  Coding: { gradeWanted: '', problemsToSolveByCategory: {}, codeDescription: '', reflectionPlan: '' },
  Mutation: { gradeWanted: '', problemsToSolve: 0, codeDescription: '', reflectionPlan: '' },
  Haystack: { gradeWanted: '', problemsToSolve: 0, codeDescription: '', reflectionPlan: '' },
};

/** Answers the two queries Contract makes: `activated`, then `contracts`. */
function mockBackend(flags: Record<string, boolean>, row: unknown) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'activated') {
      const data = Object.entries(flags).map(([topic, activated]) => ({ topic, activated }));
      return { select: () => Promise.resolve({ data, error: null }) };
    }
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      upsert: () => chain,
      single: () => Promise.resolve({ data: { data: row, updated_at: '2026-01-01T00:00:00Z' }, error: null }),
    };
    return chain;
  });
}

/**
 * Renders the page against `problems` and opens the contract modal. Both the
 * category list and the merge read the problem set when they run, so swapping
 * the stub per test is enough — no module registry games, which would hand the
 * component a second copy of React.
 */
async function openContract(problems: unknown[], flags: Record<string, boolean>, row: unknown) {
  mockProblems = problems;
  mockBackend(flags, row);
  render(<Contract />);
  await userEvent.click(await screen.findByRole('button'));
}

afterEach(() => {
  jest.clearAllMocks();
  mockProblems = [];
});

test('shows the selected problem set\'s categories even when the stored row has none', async () => {
  await openContract(mockComp204, { CodingStage2: false }, SEEDED_ROW);

  for (const category of ['Dictionaries', 'Fundamentals', 'Loops']) {
    expect(await screen.findByText(new RegExp(`^${category}:`))).not.toBeNull();
  }
  // None of the hard-coded public-problems names belong to this set.
  expect(screen.queryByText(/^Logic:/)).toBeNull();
  expect(screen.queryByText(/^String-1:/)).toBeNull();
});

test('keeps the public set narrowed to its stage-1 categories while CodingStage2 is off', async () => {
  await openContract(mockPublic, { CodingStage2: false }, SEEDED_ROW);

  for (const category of ['Fundamentals', 'Logic', 'String-1', 'List-1: Indexing']) {
    expect(await screen.findByText(new RegExp(`^${category}:`))).not.toBeNull();
  }
  expect(screen.queryByText(/^String-2:/)).toBeNull();
});

test('adds the public set\'s later categories once CodingStage2 is on', async () => {
  await openContract(mockPublic, { CodingStage2: true }, SEEDED_ROW);

  expect(await screen.findByText(/^String-2:/)).not.toBeNull();
  expect(await screen.findByText(/^Fundamentals:/)).not.toBeNull();
});

test('renders the targets the student has saved, and zero for the rest', async () => {
  const row = {
    ...SEEDED_ROW,
    Coding: { ...SEEDED_ROW.Coding, gradeWanted: 'mastery', problemsToSolveByCategory: { Loops: 7 } },
  };
  await openContract(mockComp204, { CodingStage2: false }, row);

  // waitFor, not findBy: the category renders at zero from BLANK_CONTRACT
  // before the fetch resolves, and the saved target is what must land.
  await waitFor(() => expect(screen.getByText(/^Loops:/).textContent).toBe('Loops: 7'));
  expect(screen.getByText(/^Dictionaries:/).textContent).toBe('Dictionaries: 0');
  // The rest of the row still survives the merge.
  expect(screen.getByText('mastery')).not.toBeNull();
});

test('the edit view offers an input for every category of the selected set', async () => {
  await openContract(mockComp204, { CodingStage2: false }, SEEDED_ROW);
  await userEvent.click(await screen.findByRole('button', { name: /edit/i }));

  expect(await screen.findByText('Dictionaries:')).not.toBeNull();
  expect(screen.getAllByRole('spinbutton').length).toBe(3);
});
