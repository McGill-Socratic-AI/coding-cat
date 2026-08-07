import {
  assertEquals,
  assertMatch,
  assertNotEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  __resetKeyCacheForTests,
  computePseudonym,
  PseudonymConfigError,
} from "./pseudonym.ts";

// Known-answer vector, independently produced by both
//   printf '%s' "$UID" | openssl dgst -sha256 -hmac "$SALT"
//   python3 -c "import hmac,hashlib; ..."
//
// This is the contract between this function and scripts/research-export.mjs.
// The export applies the same HMAC on the other side of the join, so if these
// two implementations ever disagree the study data silently fails to match up
// and nobody finds out until analysis. Both sides assert this same vector.
const KAT_SALT = "0123456789abcdef0123456789abcdef";
const KAT_USER = "97ca89f6-ca97-49d8-99ac-b7cbc1324616";
const KAT_EXPECTED =
  "2d835d79088ff7335bc58ad516666a5c2b8403fba704b13f1ba282a536a84b50";

function withSalt(
  salt: string | null,
  fn: () => Promise<void>,
): () => Promise<void> {
  return async () => {
    const previous = Deno.env.get("RESEARCH_SALT");
    __resetKeyCacheForTests();
    if (salt === null) Deno.env.delete("RESEARCH_SALT");
    else Deno.env.set("RESEARCH_SALT", salt);
    try {
      await fn();
    } finally {
      __resetKeyCacheForTests();
      if (previous === undefined) Deno.env.delete("RESEARCH_SALT");
      else Deno.env.set("RESEARCH_SALT", previous);
    }
  };
}

Deno.test(
  "computePseudonym matches the cross-implementation known-answer vector",
  withSalt(KAT_SALT, async () => {
    assertEquals(await computePseudonym(KAT_USER), KAT_EXPECTED);
  }),
);

Deno.test(
  "computePseudonym is deterministic across calls",
  withSalt(KAT_SALT, async () => {
    const a = await computePseudonym(KAT_USER);
    const b = await computePseudonym(KAT_USER);
    assertEquals(a, b);
  }),
);

Deno.test(
  "computePseudonym returns 64 lowercase hex chars, matching the CHECK constraint",
  withSalt(KAT_SALT, async () => {
    const p = await computePseudonym("some-other-user-id");
    // Mirrors self_reported_grades_pseudonym_shape in the migration.
    assertMatch(p, /^[0-9a-f]{64}$/);
  }),
);

Deno.test(
  "different users get different pseudonyms under the same salt",
  withSalt(KAT_SALT, async () => {
    const a = await computePseudonym("user-a");
    const b = await computePseudonym("user-b");
    assertNotEquals(a, b);
  }),
);

Deno.test("changing the salt changes the pseudonym for the same user", async () => {
  const previous = Deno.env.get("RESEARCH_SALT");
  try {
    __resetKeyCacheForTests();
    Deno.env.set("RESEARCH_SALT", KAT_SALT);
    const underFirst = await computePseudonym(KAT_USER);

    __resetKeyCacheForTests();
    Deno.env.set("RESEARCH_SALT", "ffffffffffffffffffffffffffffffff");
    const underSecond = await computePseudonym(KAT_USER);

    assertNotEquals(
      underFirst,
      underSecond,
      "salt rotation must orphan old rows rather than silently collide",
    );
  } finally {
    __resetKeyCacheForTests();
    if (previous === undefined) Deno.env.delete("RESEARCH_SALT");
    else Deno.env.set("RESEARCH_SALT", previous);
  }
});

Deno.test(
  "missing salt is refused rather than defaulted",
  withSalt(null, async () => {
    await assertRejects(
      () => computePseudonym(KAT_USER),
      PseudonymConfigError,
      "RESEARCH_SALT is not set",
    );
  }),
);

Deno.test(
  "a salt shorter than 128 bits is refused",
  withSalt("tooshort", async () => {
    await assertRejects(
      () => computePseudonym(KAT_USER),
      PseudonymConfigError,
      "at least 32 characters",
    );
  }),
);

Deno.test(
  "an empty user id is refused",
  withSalt(KAT_SALT, async () => {
    await assertRejects(
      () => computePseudonym(""),
      PseudonymConfigError,
    );
  }),
);

Deno.test(
  "the pseudonym does not leak the salt",
  withSalt(KAT_SALT, async () => {
    const p = await computePseudonym(KAT_USER);
    assertEquals(
      p.includes(KAT_SALT),
      false,
      "output must not contain the key material",
    );
  }),
);
