import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Auth from './Auth';
import { supabase } from '../supabaseClient';

// The sign-in, registration and recovery flows of a pseudonymous account, with
// the Edge Function stubbed at the `functions.invoke` boundary — so what these
// tests pin down is what the browser SENDS (three actions, a username, a
// password, a code; never an email address) and what it does with the reply.
// The server-side rules behind those replies — one-time codes, username
// uniqueness, indistinguishable failures — are covered by the Deno tests in
// supabase/functions/account/handlers_test.ts.

jest.mock('../supabaseClient', () => ({
  supabase: {
    functions: { invoke: jest.fn() },
    auth: { setSession: jest.fn() },
  },
}));

jest.mock('react-router-dom', () => ({
  useOutletContext: () => ({ session: null }),
  Navigate: ({ to }: { to: string }) => <div>navigated to {to}</div>,
}));

const mockInvoke = supabase.functions.invoke as jest.Mock;
const mockSetSession = supabase.auth.setSession as jest.Mock;

const CODE = 'A1B2C-D3E4F-G5H6J-K7M8N';
const SESSION = { access_token: 'access-1', refresh_token: 'refresh-1' };
const PASSWORD = 'correct horse battery';

beforeEach(() => {
  mockInvoke.mockReset();
  mockSetSession.mockReset();
  mockSetSession.mockResolvedValue({ error: null });
});

function ok(body: Record<string, unknown>) {
  return { data: { ok: true, ...body }, error: null };
}

function failure(body: Record<string, unknown>, status: number) {
  return {
    data: null,
    error: { message: String(status), context: new Response(JSON.stringify(body), { status }) },
  };
}

function type(label: RegExp | string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function click(name: RegExp | string) {
  fireEvent.click(screen.getByRole('button', { name }));
}

/** Fill in the registration form without submitting it. */
function fillSignUp(username: string, password = PASSWORD, confirm = password) {
  click('Create an account');
  type('Username', username);
  type('New password', password);
  type('Confirm password', confirm);
}

test('the page asks for a username and a password, and never for an email', () => {
  render(<Auth />);
  expect(screen.getByLabelText('Username')).not.toBeNull();
  expect(screen.getByLabelText('Password')).not.toBeNull();
  expect(screen.queryByLabelText(/e-?mail/i)).toBeNull();
  expect(screen.queryByText(/confirmation link/i)).toBeNull();
  expect(screen.getByText(/we never ask for your name/i)).not.toBeNull();
});

test('signing up sends only the username and password, then shows the recovery code once', async () => {
  mockInvoke.mockResolvedValue(ok({ username: 'kitty', recoveryCode: CODE, session: SESSION }));
  render(<Auth />);

  fillSignUp('Kitty');
  click('Create account');

  await waitFor(() => expect(mockInvoke).toHaveBeenCalled());
  expect(mockInvoke).toHaveBeenCalledWith('account', {
    body: { action: 'signup', username: 'Kitty', password: PASSWORD },
  });

  const code = await screen.findByTestId('recovery-code');
  expect(code.textContent).toBe(CODE);

  // The session is deliberately NOT installed yet: the app redirects away from
  // this route as soon as it is, which would take the code off the screen.
  expect(mockSetSession).not.toHaveBeenCalled();

  // Continue is gated on the student confirming they wrote the code down.
  const continueButton = screen.getByRole<HTMLButtonElement>('button', { name: 'Continue' });
  expect(continueButton.disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

  await waitFor(() => expect(mockSetSession).toHaveBeenCalledWith(SESSION));
});

test('a username that is an email address is refused in the browser', async () => {
  render(<Auth />);
  fillSignUp('jane.doe@mail.mcgill.ca');
  click('Create account');

  expect(await screen.findByText(/cannot be an email address/i)).not.toBeNull();
  expect(mockInvoke).not.toHaveBeenCalled();
});

test('a username that is a student number is refused in the browser', async () => {
  render(<Auth />);
  fillSignUp('260123456');
  click('Create account');

  expect(await screen.findByText(/looks like a student number/i)).not.toBeNull();
  expect(mockInvoke).not.toHaveBeenCalled();
});

test('a short password and a mismatched confirmation are refused in the browser', async () => {
  render(<Auth />);

  fillSignUp('kitty', 'short');
  click('Create account');
  expect(await screen.findByText(/at least 8 characters/i)).not.toBeNull();

  type('Confirm password', 'something else entirely');
  type('New password', PASSWORD);
  click('Create account');
  expect(await screen.findByText(/do not match/i)).not.toBeNull();

  expect(mockInvoke).not.toHaveBeenCalled();
});

test('a taken username is reported from the server', async () => {
  mockInvoke.mockResolvedValue(
    failure({ ok: false, kind: 'username_taken', message: 'That username is already taken.' }, 409),
  );
  render(<Auth />);

  fillSignUp('kitty');
  click('Create account');

  expect(await screen.findByText('That username is already taken.')).not.toBeNull();
  expect(screen.queryByTestId('recovery-code')).toBeNull();
});

test('signing up still shows the code when no session came back', async () => {
  mockInvoke.mockResolvedValue(ok({ username: 'kitty', recoveryCode: CODE, session: null }));
  render(<Auth />);

  fillSignUp('kitty');
  click('Create account');

  expect((await screen.findByTestId('recovery-code')).textContent).toBe(CODE);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

  // Nothing to install: the student is sent to the sign-in form instead.
  await waitFor(() =>
    expect(screen.getByText(/your account is ready/i)).not.toBeNull(),
  );
  expect(mockSetSession).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Sign in' })).not.toBeNull();
});

test('signing in installs the session the function hands back', async () => {
  mockInvoke.mockResolvedValue(ok({ username: 'kitty', session: SESSION }));
  render(<Auth />);

  type('Username', 'kitty');
  type('Password', PASSWORD);
  click('Sign in');

  await waitFor(() => expect(mockSetSession).toHaveBeenCalledWith(SESSION));
  expect(mockInvoke).toHaveBeenCalledWith('account', {
    body: { action: 'signin', username: 'kitty', password: PASSWORD },
  });
  // Signing in issues no new recovery code.
  expect(screen.queryByTestId('recovery-code')).toBeNull();
});

test('a rejected sign-in surfaces the server message and no session', async () => {
  mockInvoke.mockResolvedValue(
    failure({ ok: false, kind: 'invalid_credentials', message: 'Incorrect username or password.' }, 401),
  );
  render(<Auth />);

  type('Username', 'kitty');
  type('Password', 'not the password');
  click('Sign in');

  expect(await screen.findByText('Incorrect username or password.')).not.toBeNull();
  expect(mockSetSession).not.toHaveBeenCalled();
});

test('signing in asks for both fields before calling anything', async () => {
  render(<Auth />);
  click('Sign in');
  expect(await screen.findByText('Enter your username.')).not.toBeNull();

  type('Username', 'kitty');
  click('Sign in');
  expect(await screen.findByText('Enter your password.')).not.toBeNull();
  expect(mockInvoke).not.toHaveBeenCalled();
});

test('recovery needs only the username and the code, and issues a replacement', async () => {
  const nextCode = 'Z9Y8X-W7V6T-S5R4Q-P3N2M';
  mockInvoke.mockResolvedValue(ok({ username: 'kitty', recoveryCode: nextCode, session: SESSION }));
  render(<Auth />);

  click('I forgot my password');
  // No email field and no old password: the code is the whole proof.
  expect(screen.queryByLabelText(/e-?mail/i)).toBeNull();
  type('Username', 'kitty');
  type('Recovery code', CODE);
  type('New password', PASSWORD);
  type('Confirm password', PASSWORD);
  click('Reset my password');

  await waitFor(() => expect(mockInvoke).toHaveBeenCalled());
  expect(mockInvoke).toHaveBeenCalledWith('account', {
    body: { action: 'recover', username: 'kitty', recoveryCode: CODE, password: PASSWORD },
  });

  expect((await screen.findByTestId('recovery-code')).textContent).toBe(nextCode);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(mockSetSession).toHaveBeenCalledWith(SESSION));
});

test('a recovery that could not issue a new code says to keep the old one', async () => {
  mockInvoke.mockResolvedValue(ok({ username: 'kitty', session: SESSION }));
  render(<Auth />);

  click('I forgot my password');
  type('Username', 'kitty');
  type('Recovery code', CODE);
  type('New password', PASSWORD);
  type('Confirm password', PASSWORD);
  click('Reset my password');

  expect(await screen.findByText(/keep the recovery code you just used/i)).not.toBeNull();
  expect(screen.queryByTestId('recovery-code')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(mockSetSession).toHaveBeenCalledWith(SESSION));
});

test('a wrong recovery code surfaces the server message', async () => {
  mockInvoke.mockResolvedValue(
    failure(
      { ok: false, kind: 'invalid_recovery_code', message: 'That username and recovery code do not match.' },
      401,
    ),
  );
  render(<Auth />);

  click('I forgot my password');
  type('Username', 'kitty');
  type('Recovery code', 'AAAAA-BBBBB-CCCCC-DDDDD');
  type('New password', PASSWORD);
  type('Confirm password', PASSWORD);
  click('Reset my password');

  expect(
    await screen.findByText('That username and recovery code do not match.'),
  ).not.toBeNull();
  expect(mockSetSession).not.toHaveBeenCalled();
});

test('recovery asks for the code before calling anything', async () => {
  render(<Auth />);
  click('I forgot my password');
  type('Username', 'kitty');
  type('New password', PASSWORD);
  type('Confirm password', PASSWORD);
  click('Reset my password');

  expect(await screen.findByText('Enter your recovery code.')).not.toBeNull();
  expect(mockInvoke).not.toHaveBeenCalled();
});
