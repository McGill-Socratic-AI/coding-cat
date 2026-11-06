import { FormEvent, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormLabel,
  Input,
  Link as JoyLink,
  Stack,
  Typography,
} from '@mui/joy';
import { Navigate, useOutletContext } from 'react-router-dom';
import { Session } from '@supabase/supabase-js';
import type { AccountSession } from '../types';
import {
  activateSession,
  recoverAccount,
  signIn,
  signUp,
} from '../utils/accountClient';
import {
  MAX_USERNAME_LEN,
  MIN_PASSWORD_LEN,
  validatePassword,
  validateUsername,
} from '../utils/username';

/**
 * Sign-in, registration and account recovery.
 *
 * Coding Cat accounts are pseudonymous: a username and a password, and nothing
 * else. There is no email address anywhere in this page, which is why there is
 * also no magic link and no "email me a reset link" — a one-time recovery code,
 * shown once here at registration, takes their place.
 *
 * The code screen is the reason a successful call does not sign the student in
 * straight away: the app redirects away from this route the moment a session
 * exists, so the session the Edge Function handed back is held in state and
 * installed only once the student has confirmed they saved their code.
 */

type Mode = 'signin' | 'signup' | 'recover';

/** The one-time code screen, shown after a registration or a recovery. */
type Issued = {
  origin: 'signup' | 'recover';
  username: string;
  // null when a recovery reset the password but could not issue a replacement
  // code — the code the student just used is then still the live one.
  code: string | null;
  session: AccountSession | null;
};

const TITLES: Record<Mode, string> = {
  signin: 'Sign in',
  signup: 'Create an account',
  recover: 'Recover your account',
};

function PrivacyNotice() {
  return (
    <Alert color="primary" variant="soft" sx={{ maxWidth: '34em' }}>
      <Box>
        <Typography level="title-sm">Coding Cat does not know who you are</Typography>
        <Typography level="body-sm">
          We never ask for your name, your email address or your student number, and we do not
          keep IP addresses. Pick a username that is <strong>not</strong> your real name, and
          never put your name or student number in your code, in your questions for the AI
          tutor, or in your reflections.
        </Typography>
      </Box>
    </Alert>
  );
}

function RecoveryCodeScreen({
  issued,
  onContinue,
  busy,
}: {
  issued: Issued;
  onContinue: () => void;
  busy: boolean;
}) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(issued.code ?? '');
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the code is on screen to copy by hand.
      setCopied(false);
    }
  }

  if (!issued.code) {
    return (
      <Stack spacing={2} alignItems="center" sx={{ maxWidth: '34em' }}>
        <Typography level="h2">Password changed</Typography>
        <Alert color="warning" variant="soft">
          <Box>
            Your password has been changed, but we could not issue a new recovery code.{' '}
            <strong>Keep the recovery code you just used</strong> — it is still the one that works.
          </Box>
        </Alert>
        <Button onClick={onContinue} disabled={busy}>
          Continue
        </Button>
      </Stack>
    );
  }

  return (
    <Stack spacing={2} alignItems="center" sx={{ maxWidth: '34em' }}>
      <Typography level="h2">
        {issued.origin === 'signup' ? 'Save your recovery code' : 'Your new recovery code'}
      </Typography>
      <Typography level="body-sm">
        Signed in as <strong>{issued.username}</strong>.
      </Typography>
      <Alert color="danger" variant="soft">
        <Box>
          This code is shown <strong>once</strong>. It is the only way back into your account if
          you forget your password: there is no email address on your account, so no reset link
          can be sent, and nobody — not even the course staff — can look this code up for you.
        </Box>
      </Alert>
      <Typography
        level="h3"
        data-testid="recovery-code"
        sx={{ fontFamily: 'monospace', letterSpacing: '0.1em', userSelect: 'all' }}
      >
        {issued.code}
      </Typography>
      <Button variant="outlined" onClick={copy}>
        {copied ? 'Copied' : 'Copy code'}
      </Button>
      <Checkbox
        checked={saved}
        onChange={(event) => setSaved(event.target.checked)}
        label="I have written this code down somewhere safe."
      />
      <Button onClick={onContinue} disabled={!saved || busy}>
        {busy ? 'Loading' : 'Continue'}
      </Button>
    </Stack>
  );
}

export default function Auth() {
  const [mode, setMode] = useState<Mode>('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [issued, setIssued] = useState<Issued | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const { session } = useOutletContext<{ session: Session | null }>();

  // The code screen holds a session that has not been installed yet; leaving
  // the route now would lose the recovery code with it.
  if (session && !issued) {
    return <Navigate to="/profile" />;
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError('');
    setNotice('');
    setPassword('');
    setConfirmPassword('');
    setRecoveryCode('');
  }

  /** Local checks, so a typo does not need a round trip. The function re-checks. */
  function localProblem(): string | null {
    if (mode === 'signup') {
      const checkedName = validateUsername(username);
      if (!checkedName.ok) return checkedName.error;
    } else if (username.trim().length === 0) {
      return 'Enter your username.';
    }

    if (mode === 'recover' && recoveryCode.trim().length === 0) {
      return 'Enter your recovery code.';
    }

    if (mode === 'signin') {
      return password.length === 0 ? 'Enter your password.' : null;
    }

    const checkedPassword = validatePassword(password, username.trim().toLowerCase());
    if (!checkedPassword.ok) return checkedPassword.error;
    if (password !== confirmPassword) return 'The two passwords do not match.';
    return null;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setNotice('');

    const problem = localProblem();
    if (problem) {
      setError(problem);
      return;
    }

    setLoading(true);
    const response = mode === 'signin'
      ? await signIn(username, password)
      : mode === 'signup'
        ? await signUp(username, password)
        : await recoverAccount(username, recoveryCode, password);

    if (!response.ok) {
      setError(response.message);
      setLoading(false);
      return;
    }

    if (mode === 'signin') {
      if (!response.session) {
        setError('Could not open a session. Please try again.');
        setLoading(false);
        return;
      }
      const failure = await activateSession(response.session);
      setLoading(false);
      if (failure) setError(failure);
      // On success the session lands, the router re-renders and the redirect
      // at the top of this component takes over.
      return;
    }

    setLoading(false);
    setIssued({
      origin: mode,
      username: response.username,
      code: response.recoveryCode ?? null,
      session: response.session,
    });
  }

  /** Leave the code screen: install the session, or fall back to signing in. */
  async function handleContinue() {
    const pending = issued;
    if (!pending) return;

    if (!pending.session) {
      setIssued(null);
      switchMode('signin');
      setUsername(pending.username);
      setNotice('Your account is ready. Sign in with your username and password.');
      return;
    }

    setLoading(true);
    const failure = await activateSession(pending.session);
    setLoading(false);
    if (failure) {
      setIssued(null);
      switchMode('signin');
      setUsername(pending.username);
      setNotice('Your account is ready. Sign in with your username and password.');
      return;
    }
    // Installing the session clears `issued`, so the redirect above applies.
    setIssued(null);
  }

  if (issued) {
    return (
      <Stack
        sx={{ flex: 3, width: '100%', marginBottom: '150px' }}
        direction="column"
        spacing="20px"
        justifyContent="center"
        alignItems="center"
      >
        <RecoveryCodeScreen issued={issued} onContinue={handleContinue} busy={loading} />
      </Stack>
    );
  }

  const submitLabel = mode === 'signin'
    ? 'Sign in'
    : mode === 'signup'
      ? 'Create account'
      : 'Reset my password';

  return (
    <Stack
      sx={{ flex: 3, width: '100%', marginBottom: '150px' }}
      direction="column"
      spacing="20px"
      justifyContent="center"
      alignItems="center"
    >
      <Typography level="h2">{TITLES[mode]}</Typography>
      <PrivacyNotice />
      {!!notice && <Typography color="success">{notice}</Typography>}

      <form
        style={{
          width: 'min(25em, 90%)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
        onSubmit={handleSubmit}
      >
        <FormControl>
          <FormLabel>Username</FormLabel>
          <Input
            className="inputField"
            autoComplete="username"
            placeholder="A nickname, not your name"
            value={username}
            slotProps={{ input: { maxLength: MAX_USERNAME_LEN } }}
            onChange={(e) => setUsername(e.target.value)}
          />
        </FormControl>

        {mode === 'recover' && (
          <FormControl>
            <FormLabel>Recovery code</FormLabel>
            <Input
              className="inputField"
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
            />
          </FormControl>
        )}

        <FormControl>
          <FormLabel>{mode === 'signin' ? 'Password' : 'New password'}</FormLabel>
          <Input
            className="inputField"
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            placeholder={mode === 'signin' ? '' : `At least ${MIN_PASSWORD_LEN} characters`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </FormControl>

        {mode !== 'signin' && (
          <FormControl>
            <FormLabel>Confirm password</FormLabel>
            <Input
              className="inputField"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </FormControl>
        )}

        <Button disabled={loading} type="submit">
          {loading ? <span>Loading</span> : <span>{submitLabel}</span>}
        </Button>
      </form>

      {!!error && <Typography color="danger">{error}</Typography>}

      <Stack direction="row" spacing={2} flexWrap="wrap" justifyContent="center">
        {mode !== 'signin' && (
          <JoyLink component="button" type="button" onClick={() => switchMode('signin')}>
            Sign in instead
          </JoyLink>
        )}
        {mode !== 'signup' && (
          <JoyLink component="button" type="button" onClick={() => switchMode('signup')}>
            Create an account
          </JoyLink>
        )}
        {mode !== 'recover' && (
          <JoyLink component="button" type="button" onClick={() => switchMode('recover')}>
            I forgot my password
          </JoyLink>
        )}
      </Stack>
    </Stack>
  );
}
