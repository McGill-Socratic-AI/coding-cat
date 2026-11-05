import { normalizeUsername, validatePassword, validateUsername } from './username';

// The same table of cases is asserted server-side, in
// supabase/functions/account/username_test.ts. These are two copies of one
// policy (CRA and Deno cannot share a file); a case that passes in one suite
// and fails in the other is the drift these tests exist to catch.

const ACCEPTED = [
  'kitty',
  'cat',
  'a_b-c',
  'purrmachine2026',
  'x9y9z9',
  'the-quick-brown-fox-jum',
  'the-quick-brown-fox-jump',
];

const REJECTED_AS_EMAIL = [
  'jane.doe@mail.mcgill.ca',
  'jane@mcgill',
  '@kitty',
  'kitty.ca',
  'kitty.com',
];

const REJECTED_AS_STUDENT_NUMBER = [
  '260123456',
  'sn260123456',
  'kitty260123456',
  'a1b2c3d4e5f6g7',
];

const REJECTED_AS_SHAPE = [
  'ab',
  '1kitty',
  '_kitty',
  'kitty cat',
  'kitty!',
  'the-quick-brown-fox-jumps',
  'kittyKÄTZCHEN',
];

test('normalizeUsername trims and lower-cases', () => {
  expect(normalizeUsername('  KiTTy \n')).toBe('kitty');
  expect(normalizeUsername(undefined)).toBe('');
  expect(normalizeUsername(42)).toBe('');
});

test.each(ACCEPTED)('%s is accepted and stored normalized', (name) => {
  const result = validateUsername(` ${name.toUpperCase()} `);
  expect(result).toEqual({ ok: true, username: name });
});

test.each(REJECTED_AS_EMAIL)('%s is refused as an email address', (name) => {
  const result = validateUsername(name);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toContain('email');
});

test.each(REJECTED_AS_STUDENT_NUMBER)('%s is refused as a student number', (name) => {
  const result = validateUsername(name);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toContain('student number');
});

test.each(REJECTED_AS_SHAPE)('%s is outside the allowed shape', (name) => {
  expect(validateUsername(name).ok).toBe(false);
});

test('an empty username asks for one', () => {
  expect(validateUsername('   ')).toEqual({ ok: false, error: 'Choose a username.' });
});

describe('validatePassword', () => {
  test('accepts a long enough password', () => {
    expect(validatePassword('correct horse battery', 'kitty')).toEqual({ ok: true });
  });

  test('refuses a missing or short password', () => {
    expect(validatePassword(undefined).ok).toBe(false);
    expect(validatePassword('').ok).toBe(false);
    expect(validatePassword('short1')).toEqual({
      ok: false,
      error: expect.stringContaining('8'),
    });
  });

  test('refuses more than 72 bytes, counting UTF-8 and not characters', () => {
    expect(validatePassword('a'.repeat(72)).ok).toBe(true);
    expect(validatePassword('a'.repeat(73))).toEqual({
      ok: false,
      error: expect.stringContaining('72'),
    });
    // 19 four-byte emoji are 76 bytes, so this is over the limit even though
    // it looks like a 19-character password.
    expect(validatePassword('\u{1F408}'.repeat(19)).ok).toBe(false);
    expect(validatePassword('\u{1F408}'.repeat(18)).ok).toBe(true);
  });

  test('refuses a password that is just the username', () => {
    expect(validatePassword('KittyKitty', 'kittykitty')).toEqual({
      ok: false,
      error: expect.stringContaining('username'),
    });
  });
});
