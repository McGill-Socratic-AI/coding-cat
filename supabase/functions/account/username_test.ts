import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeUsername, validateUsername } from "./username.ts";
import { validatePassword } from "./password.ts";

// The same table of cases is asserted on the browser side, in
// src/utils/username.test.ts. Keep the two in step: they are two copies of one
// policy, and a case that passes here and fails there is the drift this guards.

const ACCEPTED = [
  "kitty",
  "cat",
  "a_b-c",
  "purrmachine2026",
  "x9y9z9",
  "the-quick-brown-fox-jum",
  "the-quick-brown-fox-jump",
];

const REJECTED_AS_EMAIL = [
  "jane.doe@mail.mcgill.ca",
  "jane@mcgill",
  "@kitty",
  "kitty.ca",
  "kitty.com",
];

const REJECTED_AS_STUDENT_NUMBER = [
  "260123456",
  "sn260123456",
  "kitty260123456",
  "a1b2c3d4e5f6g7",
];

const REJECTED_AS_SHAPE = [
  "ab",
  "1kitty",
  "_kitty",
  "kitty cat",
  "kitty!",
  "the-quick-brown-fox-jumps",
  "kittyKÄTZCHEN",
];

Deno.test("normalizeUsername trims and lower-cases", () => {
  assertEquals(normalizeUsername("  KiTTy \n"), "kitty");
  assertEquals(normalizeUsername(undefined), "");
  assertEquals(normalizeUsername(42), "");
});

Deno.test("a nickname is accepted and stored normalized", () => {
  for (const name of ACCEPTED) {
    const result = validateUsername(` ${name.toUpperCase()} `);
    assert(result.ok, `expected ${name} to be accepted, got ${JSON.stringify(result)}`);
    assertEquals(result.username, name);
  }
});

Deno.test("an email address is refused as an email address", () => {
  for (const name of REJECTED_AS_EMAIL) {
    const result = validateUsername(name);
    assert(!result.ok, `expected ${name} to be refused`);
    assert(
      result.error.includes("email"),
      `expected an email-specific message for ${name}, got: ${result.error}`,
    );
  }
});

Deno.test("a student number is refused as a student number", () => {
  for (const name of REJECTED_AS_STUDENT_NUMBER) {
    const result = validateUsername(name);
    assert(!result.ok, `expected ${name} to be refused`);
    assert(
      result.error.includes("student number"),
      `expected a student-number message for ${name}, got: ${result.error}`,
    );
  }
});

Deno.test("anything outside the character set or length is refused", () => {
  for (const name of REJECTED_AS_SHAPE) {
    const result = validateUsername(name);
    assert(!result.ok, `expected ${name} to be refused`);
  }
});

Deno.test("an empty username asks for one", () => {
  const result = validateUsername("   ");
  assert(!result.ok);
  assertEquals(result.error, "Choose a username.");
});

Deno.test("password policy: length floor, byte ceiling, and not the username", () => {
  assert(validatePassword("correct horse battery", "kitty").ok);

  const short = validatePassword("short1", "kitty");
  assert(!short.ok);
  assert(short.error.includes("8"), short.error);

  const empty = validatePassword("", "kitty");
  assert(!empty.ok);

  const missing = validatePassword(undefined, "kitty");
  assert(!missing.ok);

  // 73 ASCII bytes is one past what bcrypt will look at.
  const tooLong = validatePassword("a".repeat(73), "kitty");
  assert(!tooLong.ok);
  assert(tooLong.error.includes("72"), tooLong.error);

  // 25 emoji are 100 bytes, so the byte ceiling catches a "short" password too.
  assert(!validatePassword("\u{1F408}".repeat(25), "kitty").ok);

  const sameAsName = validatePassword("KittyKitty", "kittykitty");
  assert(!sameAsName.ok);
  assert(sameAsName.error.includes("username"), sameAsName.error);
});
