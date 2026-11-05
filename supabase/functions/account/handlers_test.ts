// The three account flows, end to end, against an in-memory store.
//
// What these tests are for: the rules a student's account depends on and that
// no browser-side test can prove — that a taken username cannot be claimed
// twice, that a half-finished signup leaves nothing behind, that a redeemed
// recovery code stops working, that a wrong username and a wrong password are
// indistinguishable, and that no response ever carries the placeholder email
// address that GoTrue needs but nobody else should see.

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleAccountRequest } from "./handlers.ts";
import { type AccountStore, UsernameTakenError } from "./store.ts";
import { verifyRecoveryCode } from "./recovery.ts";
import type { AccountResponse } from "./types.ts";

const PASSWORD = "correct horse battery";
const OTHER_PASSWORD = "a different password";

interface FakeUser {
  profileId: string;
  email: string;
  password: string;
  username: string;
}

class FakeStore implements AccountStore {
  users: FakeUser[] = [];
  recovery = new Map<string, string>();
  /** Set to make the recovery-hash write fail, as a DB hiccup would. */
  failRecoveryWrite = false;
  /** Set to make sign-in fail even with the right password. */
  failSignIn = false;
  /** Set to make setPassword fail. */
  failSetPassword = false;
  /** Pretend the username was claimed between the check and the insert. */
  raceOnCreate = false;
  deleted: string[] = [];
  private nextId = 1;

  find(username: string): FakeUser | undefined {
    return this.users.find((u) => u.username === username);
  }

  findProfileByUsername(username: string) {
    const user = this.find(username);
    return Promise.resolve(user ? { profileId: user.profileId } : null);
  }

  loginEmailFor(profileId: string) {
    const user = this.users.find((u) => u.profileId === profileId);
    return Promise.resolve(user?.email ?? null);
  }

  createUser(
    { email, password, username }: { email: string; password: string; username: string },
  ) {
    if (this.raceOnCreate || this.find(username)) {
      return Promise.reject(new UsernameTakenError(username));
    }
    const profileId = `profile-${this.nextId++}`;
    this.users.push({ profileId, email, password, username });
    return Promise.resolve({ profileId });
  }

  deleteUser(profileId: string) {
    this.deleted.push(profileId);
    this.users = this.users.filter((u) => u.profileId !== profileId);
    this.recovery.delete(profileId);
    return Promise.resolve();
  }

  putRecoveryHash(profileId: string, hash: string) {
    if (this.failRecoveryWrite) {
      return Promise.reject(new Error("account_recovery write failed"));
    }
    this.recovery.set(profileId, hash);
    return Promise.resolve();
  }

  recoveryHashFor(profileId: string) {
    return Promise.resolve(this.recovery.get(profileId) ?? null);
  }

  setPassword(profileId: string, password: string) {
    if (this.failSetPassword) return Promise.reject(new Error("password update failed"));
    const user = this.users.find((u) => u.profileId === profileId);
    if (!user) return Promise.reject(new Error("no such user"));
    user.password = password;
    return Promise.resolve();
  }

  signIn(email: string, password: string) {
    if (this.failSignIn) return Promise.resolve(null);
    const user = this.users.find((u) => u.email === email && u.password === password);
    if (!user) return Promise.resolve(null);
    return Promise.resolve({
      access_token: `access-${user.profileId}`,
      refresh_token: `refresh-${user.profileId}`,
    });
  }
}

function deps(store: FakeStore, overrides: Partial<{
  newRecoveryCode: () => string;
  newPlaceholderEmail: () => string;
}> = {}) {
  return { store, ...overrides };
}

async function call(
  store: FakeStore,
  body: unknown,
  overrides?: Parameters<typeof deps>[1],
): Promise<{ status: number; body: AccountResponse; raw: string }> {
  const req = new Request("http://localhost/functions/v1/account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await handleAccountRequest(req, deps(store, overrides));
  const raw = await res.text();
  return { status: res.status, body: JSON.parse(raw) as AccountResponse, raw };
}

function signUp(store: FakeStore, username = "kitty", password = PASSWORD, overrides?: Parameters<typeof deps>[1]) {
  return call(store, { action: "signup", username, password }, overrides);
}

Deno.test("signup creates the account and hands back a session and a recovery code", async () => {
  const store = new FakeStore();
  const { status, body, raw } = await signUp(store);

  assertEquals(status, 200);
  assert(body.ok);
  assertEquals(body.username, "kitty");
  assertEquals(body.session?.access_token, "access-profile-1");
  assert(body.recoveryCode && body.recoveryCode.length > 0);

  // The account exists under the normalized username, with a placeholder email.
  assertEquals(store.users.length, 1);
  assertEquals(store.users[0].username, "kitty");
  assert(store.users[0].email.endsWith(".invalid"), store.users[0].email);

  // Only a hash of the code is stored, and it is the hash of the code issued.
  const stored = store.recovery.get("profile-1")!;
  assertEquals(stored.includes(body.recoveryCode!), false);
  assert(await verifyRecoveryCode(body.recoveryCode!, stored));

  // Nothing identifying leaves the function — above all not the login address.
  assertEquals(raw.includes(store.users[0].email), false);
  assertEquals(raw.includes("@"), false);
});

Deno.test("signup normalizes the username it stores and reports", async () => {
  const store = new FakeStore();
  const { body } = await signUp(store, "  KiTTy  ");
  assert(body.ok);
  assertEquals(body.username, "kitty");
  assertEquals(store.users[0].username, "kitty");
});

Deno.test("signup refuses a username that is an email address or a student number", async () => {
  for (
    const [username, fragment] of [
      ["jane.doe@mail.mcgill.ca", "email"],
      ["260123456", "student number"],
    ] as const
  ) {
    const store = new FakeStore();
    const { status, body } = await signUp(store, username);
    assertEquals(status, 400);
    assert(!body.ok);
    assertEquals(body.kind, "invalid_input");
    assert(body.message.includes(fragment), body.message);
    assertEquals(store.users.length, 0);
  }
});

Deno.test("signup refuses a password shorter than the floor and creates nothing", async () => {
  const store = new FakeStore();
  const { status, body } = await signUp(store, "kitty", "short");
  assertEquals(status, 400);
  assert(!body.ok);
  assertEquals(body.kind, "invalid_input");
  assertEquals(store.users.length, 0);
});

Deno.test("signup refuses a username somebody already has", async () => {
  const store = new FakeStore();
  await signUp(store, "kitty");
  const { status, body } = await signUp(store, "KITTY", OTHER_PASSWORD);
  assertEquals(status, 409);
  assert(!body.ok);
  assertEquals(body.kind, "username_taken");
  assertEquals(store.users.length, 1);
});

Deno.test("signup loses a race for the username at the unique index, not silently", async () => {
  const store = new FakeStore();
  // Free when checked, taken by the time the insert lands — what the unique
  // index on profiles.username arbitrates in production.
  store.raceOnCreate = true;
  const { status, body } = await signUp(store);
  assertEquals(status, 409);
  assert(!body.ok);
  assertEquals(body.kind, "username_taken");
  assertEquals(store.users.length, 0);
});

Deno.test("signup rolls the account back when the recovery code cannot be stored", async () => {
  const store = new FakeStore();
  store.failRecoveryWrite = true;
  const { status, body } = await signUp(store);

  assertEquals(status, 500);
  assert(!body.ok);
  // An account with no stored code could never be recovered, and the student
  // does not know it exists: the username must be left free to try again.
  assertEquals(store.users.length, 0);
  assertEquals(store.deleted, ["profile-1"]);
});

Deno.test("signup still delivers the recovery code when no session can be opened", async () => {
  const store = new FakeStore();
  store.failSignIn = true;
  const { status, body } = await signUp(store);

  assertEquals(status, 200);
  assert(body.ok);
  assertEquals(body.session, null);
  // The code is the one thing that cannot be re-fetched later.
  assert(body.recoveryCode);
  assertEquals(store.users.length, 1);
});

Deno.test("signin returns a session for the right password", async () => {
  const store = new FakeStore();
  await signUp(store);
  const { status, body, raw } = await call(store, {
    action: "signin",
    username: "KiTTy",
    password: PASSWORD,
  });

  assertEquals(status, 200);
  assert(body.ok);
  assertEquals(body.username, "kitty");
  assertEquals(body.session?.refresh_token, "refresh-profile-1");
  // No new code is issued on an ordinary sign-in.
  assertEquals(body.recoveryCode, undefined);
  assertEquals(raw.includes("@"), false);
});

Deno.test("a wrong password and an unknown username are indistinguishable", async () => {
  const store = new FakeStore();
  await signUp(store);

  const wrongPassword = await call(store, {
    action: "signin",
    username: "kitty",
    password: OTHER_PASSWORD,
  });
  const noSuchUser = await call(store, {
    action: "signin",
    username: "nobody",
    password: PASSWORD,
  });

  assertEquals(wrongPassword.status, 401);
  assertEquals(noSuchUser.status, 401);
  assert(!wrongPassword.body.ok && !noSuchUser.body.ok);
  assertEquals(wrongPassword.body.kind, "invalid_credentials");
  assertEquals(noSuchUser.body.kind, wrongPassword.body.kind);
  assertEquals(noSuchUser.body.message, wrongPassword.body.message);
});

Deno.test("signin asks for both fields before looking anything up", async () => {
  const store = new FakeStore();
  for (
    const body of [
      { action: "signin", username: "", password: PASSWORD },
      { action: "signin", username: "kitty", password: "" },
      { action: "signin", username: "kitty" },
    ]
  ) {
    const result = await call(store, body);
    assertEquals(result.status, 400);
    assert(!result.body.ok);
    assertEquals(result.body.kind, "invalid_input");
  }
});

Deno.test("recovery resets the password, and the code used stops working", async () => {
  const store = new FakeStore();
  const created = await signUp(store);
  assert(created.body.ok);
  const firstCode = created.body.recoveryCode!;

  const { status, body } = await call(store, {
    action: "recover",
    username: "kitty",
    recoveryCode: firstCode,
    password: OTHER_PASSWORD,
  });

  assertEquals(status, 200);
  assert(body.ok);
  assertEquals(body.session?.access_token, "access-profile-1");
  // A replacement code is issued, so the account is never left without one.
  assert(body.recoveryCode);
  assertNotEquals(body.recoveryCode, firstCode);

  // The new password works and the old one does not.
  const withNew = await call(store, {
    action: "signin",
    username: "kitty",
    password: OTHER_PASSWORD,
  });
  assert(withNew.body.ok);
  const withOld = await call(store, {
    action: "signin",
    username: "kitty",
    password: PASSWORD,
  });
  assert(!withOld.body.ok);

  // One-time: the redeemed code is no longer accepted, the replacement is.
  const reuse = await call(store, {
    action: "recover",
    username: "kitty",
    recoveryCode: firstCode,
    password: "yet another password",
  });
  assertEquals(reuse.status, 401);
  assert(!reuse.body.ok);
  assertEquals(reuse.body.kind, "invalid_recovery_code");

  const withReplacement = await call(store, {
    action: "recover",
    username: "kitty",
    recoveryCode: body.recoveryCode!,
    password: "yet another password",
  });
  assert(withReplacement.body.ok);
});

Deno.test("recovery needs only the username and the code", async () => {
  const store = new FakeStore();
  const created = await signUp(store);
  assert(created.body.ok);

  // No email, no old password, nothing else the student would have to remember.
  const { body } = await call(store, {
    action: "recover",
    username: "kitty",
    recoveryCode: created.body.recoveryCode!,
    password: OTHER_PASSWORD,
  });
  assert(body.ok);
});

Deno.test("a wrong code and an unknown username are indistinguishable", async () => {
  const store = new FakeStore();
  await signUp(store);

  const wrongCode = await call(store, {
    action: "recover",
    username: "kitty",
    recoveryCode: "AAAAA-BBBBB-CCCCC-DDDDD",
    password: OTHER_PASSWORD,
  });
  const noSuchUser = await call(store, {
    action: "recover",
    username: "nobody",
    recoveryCode: "AAAAA-BBBBB-CCCCC-DDDDD",
    password: OTHER_PASSWORD,
  });

  assertEquals(wrongCode.status, 401);
  assertEquals(noSuchUser.status, 401);
  assert(!wrongCode.body.ok && !noSuchUser.body.ok);
  assertEquals(wrongCode.body.kind, "invalid_recovery_code");
  assertEquals(noSuchUser.body.kind, wrongCode.body.kind);
  assertEquals(noSuchUser.body.message, wrongCode.body.message);
  // The password was not touched.
  assertEquals(store.users[0].password, PASSWORD);
});

Deno.test("recovery refuses a new password that fails the policy", async () => {
  const store = new FakeStore();
  const created = await signUp(store);
  assert(created.body.ok);

  const { status, body } = await call(store, {
    action: "recover",
    username: "kitty",
    recoveryCode: created.body.recoveryCode!,
    password: "short",
  });
  assertEquals(status, 400);
  assert(!body.ok);
  assertEquals(body.kind, "invalid_input");
  assertEquals(store.users[0].password, PASSWORD);
  // The code was not spent on a rejected attempt.
  assert(await verifyRecoveryCode(created.body.recoveryCode!, store.recovery.get("profile-1")!));
});

Deno.test("recovery keeps the student in when the password changes but the code cannot be rotated", async () => {
  const store = new FakeStore();
  const created = await signUp(store);
  assert(created.body.ok);
  const firstCode = created.body.recoveryCode!;
  store.failRecoveryWrite = true;

  const { status, body } = await call(store, {
    action: "recover",
    username: "kitty",
    recoveryCode: firstCode,
    password: OTHER_PASSWORD,
  });

  assertEquals(status, 200);
  assert(body.ok);
  // No replacement code: the UI tells the student to keep the one they used,
  // which is still the live one.
  assertEquals(body.recoveryCode, undefined);
  assertEquals(store.users[0].password, OTHER_PASSWORD);
  assert(await verifyRecoveryCode(firstCode, store.recovery.get("profile-1")!));
});

Deno.test("recovery reports a failed password reset without retiring the code", async () => {
  const store = new FakeStore();
  const created = await signUp(store);
  assert(created.body.ok);
  const firstCode = created.body.recoveryCode!;
  store.failSetPassword = true;

  const { status, body } = await call(store, {
    action: "recover",
    username: "kitty",
    recoveryCode: firstCode,
    password: OTHER_PASSWORD,
  });

  assertEquals(status, 500);
  assert(!body.ok);
  assertEquals(body.kind, "unknown");
  assertEquals(store.users[0].password, PASSWORD);
  assert(await verifyRecoveryCode(firstCode, store.recovery.get("profile-1")!));
});

Deno.test("a malformed request is refused before anything is created", async () => {
  const store = new FakeStore();

  const unknownAction = await call(store, { action: "promote", username: "kitty" });
  assertEquals(unknownAction.status, 400);
  assert(!unknownAction.body.ok);

  const noAction = await call(store, { username: "kitty", password: PASSWORD });
  assertEquals(noAction.status, 400);

  const notAnObject = await call(store, ["signup"]);
  assertEquals(notAnObject.status, 400);

  const badJson = await handleAccountRequest(
    new Request("http://localhost/functions/v1/account", { method: "POST", body: "{" }),
    deps(store),
  );
  assertEquals(badJson.status, 400);

  const wrongMethod = await handleAccountRequest(
    new Request("http://localhost/functions/v1/account", { method: "GET" }),
    deps(store),
  );
  assertEquals(wrongMethod.status, 400);

  assertEquals(store.users.length, 0);
});

Deno.test("every response carries CORS headers", async () => {
  const store = new FakeStore();
  const res = await handleAccountRequest(
    new Request("http://localhost/functions/v1/account", {
      method: "POST",
      body: JSON.stringify({ action: "signup", username: "kitty", password: PASSWORD }),
    }),
    deps(store),
  );
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(res.headers.get("Content-Type"), "application/json");
});
