// The component imports the Supabase client transitively, and constructing it
// needs env that tests do not have. We are exercising a pure function.
jest.mock('../../../supabaseClient', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

// eslint-disable-next-line import/first
import { mergeDraft } from './GradeSelfReport';

// The draft/server merge is the piece that decides whether a student's typing
// survives. Replacing the draft wholesale on every reply — which is what the
// first version did — discarded anything typed while a request was in flight,
// and the "try again" path after a failed save threw away the entire form.

const empty = {
  exam_1: '',
  exam_2: '',
  exam_3: '',
  assignment_1: '',
  assignment_2: '',
  assignment_3: '',
  assignment_4: '',
};

test('adopts a server value for a field the student has not touched', () => {
  const merged = mergeDraft({ ...empty, exam_1: '50' }, { exam_1: 50 }, { exam_1: 91 });
  expect(merged.exam_1).toBe('91');
});

test('keeps what the student typed while a request was in flight', () => {
  // Showing 50, student types 88, a reply arrives still saying 50.
  const merged = mergeDraft({ ...empty, exam_1: '88' }, { exam_1: 50 }, { exam_1: 50 });
  expect(merged.exam_1).toBe('88');
});

test('keeps typing that has not been sent yet when the server still has nothing', () => {
  const merged = mergeDraft({ ...empty, exam_2: '73' }, {}, {});
  expect(merged.exam_2).toBe('73');
});

test('a field the student cleared stays cleared until the server confirms', () => {
  const merged = mergeDraft({ ...empty, exam_1: '' }, { exam_1: 50 }, { exam_1: 50 });
  expect(merged.exam_1).toBe('');
});

test('after a successful save the server value and the draft agree', () => {
  // Student typed 88 over 50 and saved; the reply now says 88.
  const merged = mergeDraft({ ...empty, exam_1: '88' }, { exam_1: 50 }, { exam_1: 88 });
  expect(merged.exam_1).toBe('88');
});

test('a withdrawal empties every field', () => {
  const merged = mergeDraft(
    { ...empty, exam_1: '88', assignment_2: '73' },
    { exam_1: 88, assignment_2: 73 },
    {},
  );
  expect(merged.exam_1).toBe('');
  expect(merged.assignment_2).toBe('');
});

test('untouched fields are unaffected by a change to another field', () => {
  const merged = mergeDraft(
    { ...empty, exam_1: '88', exam_2: '60' },
    { exam_1: 50, exam_2: 60 },
    { exam_1: 50, exam_2: 65 },
  );
  expect(merged.exam_1).toBe('88', );
  expect(merged.exam_2).toBe('65');
});

test('every item is present in the result', () => {
  const merged = mergeDraft(empty, {}, {});
  expect(Object.keys(merged).sort()).toEqual([
    'assignment_1',
    'assignment_2',
    'assignment_3',
    'assignment_4',
    'exam_1',
    'exam_2',
    'exam_3',
  ]);
});
