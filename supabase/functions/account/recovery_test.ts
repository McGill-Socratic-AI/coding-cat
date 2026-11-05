import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  generateRecoveryCode,
  hashRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_LEN,
  verifyRecoveryCode,
} from "./recovery.ts";
import { generatePlaceholderEmail, PLACEHOLDER_DOMAIN } from "./placeholder.ts";

Deno.test("a generated code is grouped base32 with no ambiguous letters", () => {
  const code = generateRecoveryCode();
  assertEquals(code, code.toUpperCase());
  assertEquals(code.split("-").length, 4);
  assertEquals(code.replace(/-/g, "").length, RECOVERY_CODE_LEN);
  // I, L, O and U are left out so a hand-copied code cannot be misread.
  assertEquals(/[ILOU]/.test(code), false);
});

Deno.test("two generated codes differ", () => {
  assertNotEquals(generateRecoveryCode(), generateRecoveryCode());
});

Deno.test("a code verifies against its own hash", async () => {
  const code = generateRecoveryCode();
  const stored = await hashRecoveryCode(code);
  assert(await verifyRecoveryCode(code, stored));
});

Deno.test("the stored hash is salted, so the same code hashes differently", async () => {
  const code = generateRecoveryCode();
  const a = await hashRecoveryCode(code);
  const b = await hashRecoveryCode(code);
  assertNotEquals(a, b);
  // Both still verify: the salt travels in the stored value.
  assert(await verifyRecoveryCode(code, a));
  assert(await verifyRecoveryCode(code, b));
});

Deno.test("the hash does not contain the code", async () => {
  const code = generateRecoveryCode();
  const stored = await hashRecoveryCode(code);
  assertEquals(stored.includes(code), false);
  assertEquals(stored.includes(code.replace(/-/g, "")), false);
  assertEquals(stored.split("$")[0], "s256");
});

Deno.test("a code is accepted however it was typed back", async () => {
  const stored = await hashRecoveryCode("01B2C-D3E4F-G5H6J-K7M8N");
  for (
    const typed of [
      "01B2C-D3E4F-G5H6J-K7M8N",
      "01b2c-d3e4f-g5h6j-k7m8n",
      "01b2c d3e4f g5h6j k7m8n",
      "01B2CD3E4FG5H6JK7M8N",
      // Crockford aliases, for a code copied off a screen by hand:
      // O reads as 0, and I and L both read as 1.
      "OIB2C-D3E4F-G5H6J-K7M8N",
      "olb2c-d3e4f-g5h6j-k7m8n",
    ]
  ) {
    assert(await verifyRecoveryCode(typed, stored), `rejected: ${typed}`);
  }
});

Deno.test("a wrong, empty or malformed code does not verify", async () => {
  const stored = await hashRecoveryCode(generateRecoveryCode());
  assertEquals(await verifyRecoveryCode(generateRecoveryCode(), stored), false);
  assertEquals(await verifyRecoveryCode("", stored), false);
  assertEquals(await verifyRecoveryCode("-----", stored), false);
  assertEquals(await verifyRecoveryCode(undefined, stored), false);
  assertEquals(await verifyRecoveryCode(42, stored), false);
});

Deno.test("a missing or corrupt stored hash verifies as false, never throws", async () => {
  const code = generateRecoveryCode();
  assertEquals(await verifyRecoveryCode(code, null), false);
  assertEquals(await verifyRecoveryCode(code, undefined), false);
  assertEquals(await verifyRecoveryCode(code, ""), false);
  assertEquals(await verifyRecoveryCode(code, "garbage"), false);
  assertEquals(await verifyRecoveryCode(code, "md5$aa$bb"), false);
  assertEquals(await verifyRecoveryCode(code, "s256$notahexsalt$bb"), false);
  assertEquals(await verifyRecoveryCode(code, "s256$aabb"), false);
});

Deno.test("the placeholder address is random and undeliverable", () => {
  const a = generatePlaceholderEmail();
  const b = generatePlaceholderEmail();
  assertNotEquals(a, b);
  assert(a.endsWith(`@${PLACEHOLDER_DOMAIN}`), a);
  // 128 bits of hex plus the leading 'u': nothing derived from the student.
  assertEquals(a.split("@")[0].length, 33);
  // RFC 2606's reserved `.invalid` TLD: no mail can ever be delivered here.
  assert(a.endsWith(".invalid"), a);
});
