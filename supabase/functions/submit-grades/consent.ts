// The consent text is server-authoritative.
//
// The browser does not compose this copy and does not get to choose which
// version it agrees to. `status` hands the client the current version *and* the
// exact text to render; `consent` requires the client to echo back the version
// it displayed, and we reject anything other than the current one. That closes
// two holes: a student cannot fabricate a consent record for a version they
// never saw, and a tab left open across a wording change cannot record consent
// against superseded text.
//
// WHEN YOU CHANGE THE WORDING, BUMP THE VERSION. Rows already written keep the
// version that was in force when they were written, so the dataset stays
// self-describing and previously-consented students are re-prompted.

export const CONSENT_VERSION = "2026-08-comp204-v1";

export const CONSENT_TEXT = `
**Taking part is entirely voluntary, and it does not affect your grade.**

If you agree, the scores you enter here are stored under a pseudonym: a code
derived from your account with a secret key that is not kept in the database.
The research team uses it to relate how students used the Socratic AI tutor to
how they did in the course.

What this means in practice:

- Your name, email, and student number are **not** stored with your scores, and
  cannot be recovered from them by anyone who only has access to the database.
- The link is **pseudonymous, not anonymous**. The research team holds the key
  and can therefore connect your scores to your account while the study is
  running. Once the study data has been exported, the key is destroyed, after
  which the retained data is anonymous.
- Your instructor does not see your individual entries.
- Your Socratic AI conversations are processed by Anthropic (a service located
  in the United States) in order to generate replies.
- You can withdraw at any time from this page. Withdrawing deletes the scores
  you entered.

Nothing here is checked against official records, and entering nothing at all
is a perfectly fine choice.
`.trim();
