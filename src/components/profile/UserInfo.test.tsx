import { render, screen, waitFor } from '@testing-library/react';
import UserInfo from './UserInfo';
import { supabase } from '../../supabaseClient';

// The profile page used to print the account's email address and a student
// number, which is exactly what tied an account to a named student. The email
// on an account is now a random placeholder and must never be rendered: these
// tests are the regression guard for that, and for the student-number field
// being gone rather than merely hidden.

// The `mock` prefix is what lets a jest.mock factory reference this; the
// factory is hoisted above the rest of the file, so it must not reach for
// anything that is not self-contained.
const mockPlaceholderEmail = 'u0123456789abcdef0123456789abcdef@users.coding-cat.invalid';

jest.mock('../../supabaseClient', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('react-router-dom', () => ({
  useOutletContext: () => ({
    session: { user: { id: 'profile-1', email: mockPlaceholderEmail } },
  }),
}));

const mockFrom = supabase.from as unknown as jest.Mock;

/** Minimal PostgREST stand-in: records the columns asked for, answers once. */
function mockProfiles(answer: { data: unknown; error: unknown }) {
  const selected: string[] = [];
  mockFrom.mockImplementation(() => {
    const chain: any = {
      select: (columns: string) => {
        selected.push(columns);
        return chain;
      },
      eq: () => chain,
      single: () => Promise.resolve(answer),
    };
    return chain;
  });
  return selected;
}

test('shows the username and nothing that could identify the student', async () => {
  const selected = mockProfiles({ data: { username: 'kitty' }, error: null });
  render(<UserInfo />);

  expect(await screen.findByText('kitty')).not.toBeNull();
  // The placeholder address is on the session; it must not reach the page.
  expect(screen.queryByText(mockPlaceholderEmail)).toBeNull();
  expect(screen.queryByText(/@/)).toBeNull();
  expect(screen.queryByText(/student id/i)).toBeNull();
  // Nothing is editable here, so there is no field to type a real name into.
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();

  // student_id is not even asked for: the column no longer exists.
  await waitFor(() => expect(selected.length).toBe(1));
  expect(selected[0]).not.toContain('student_id');
  expect(selected[0]).toContain('username');
});

test('falls back to a placeholder name when the profile has no username', async () => {
  mockProfiles({ data: { username: null }, error: null });
  render(<UserInfo />);
  expect(await screen.findByText('Unnamed User')).not.toBeNull();
});

test('reports a failed profile read', async () => {
  mockProfiles({ data: null, error: { message: 'no such profile' } });
  render(<UserInfo />);
  expect(await screen.findByText('no such profile')).not.toBeNull();
});
