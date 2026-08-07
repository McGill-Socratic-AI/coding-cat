# COMP 204 Fall 2026 deployment — design

**Status:** implemented on `feat/comp204-fall-2026`
**Date:** 2026-07-24

## What was asked for

A copy of Coding Cat that COMP 204 can use this fall, backed by our own
deployment of the Socratic Assistant, carrying a set of instructor-selected
practice questions with their solutions and autograder tests, plus a way for
students to report their exam and assignment grades without being identified, so
we can relate tutor usage to course outcomes.

## What the codebase actually offered

Three findings reshaped the work before any of it was written.

**There are no autograder tests to import.** Coding Cat has no pytest, no
unittest, no doctest, no test runner. A problem's entire notion of correctness is
`io.json`: a list of `{"input": [...], "output": ...}` pairs that Brython
evaluates in the browser with `actual == expected`. "Questions with solutions and
autograder tests" therefore maps onto description + `io.json`, and the tests have
to be *translated*, not copied.

Worse, nothing checks that translation. `validate_problems.py` confirms files
exist, parse, and carry the right fields, and stops. So a single slip produces a
question that renders perfectly and cannot be solved — the student writes correct
code, sees a red test, and concludes they are wrong.

**Anonymity and correlation are mutually exclusive as stated.** Relating usage to
outcomes requires a join key; a join key that reaches usage data is a pseudonym.
And the existing database makes "the grades table has no name column" nearly
meaningless: `profiles.student_id` (a direct institutional identifier),
`profiles.username` (free-text real name) and `submissions.code` all live
alongside it.

**`REACT_APP_PROBLEM_SET` did not work.** `getProblemSet()` resolves the set
dynamically, but `getCategoryList` and `getCompletedProblems` each hardcoded
`import problems from "../problems/problems"`. Since there has only ever been one
problem set, nothing exercised the gap. COMP204 is the second.

## Architecture

One course, one deployment. That constraint — stated up front — removes most of
the difficulty: the `activated` feature flags being global booleans stops
mattering, and so does `SOCRATIC_COURSE_OFFERING` being a single environment
variable per deployed function.

```
browser
  └─ coding-cat  (CRA static build, REACT_APP_PROBLEM_SET=comp204-problems)
      ├─ problems: compiled into the bundle from the comp204-problems submodule
      ├─ execution: Brython in a web worker, against io.json — no server involved
      └─ Supabase project A′  [new, ca-central-1]
          ├─ profiles / submissions / analyze_calls / activated
          ├─ research_consent + self_reported_grades          (new)
          ├─ fn: analyze          (existing)
          └─ fn: submit-grades    (new — holds the research salt)
                     │
                     └── HTTP ──▶ Socratic Assistant
                                  platforms += 'coding-cat-comp204'
                                  course_offering_id = 'comp204-f2026'
```

**A new coding-cat Supabase project**, not the existing one. Real student and
research data should not share a database with smoke-test accounts, and a fresh
project can be created in `ca-central-1` and restricted to McGill addresses.

**A shared Socratic Assistant project**, conditional on its region. ADR-0001
makes the Course Offering the tenancy boundary, and isolation is already enforced
on `(platform_id, course_offering_id)` with a pgTAP test pinning retrieval. A
second project would mean a second RAG pipeline and teacher portal to operate for
no isolation we do not already have. The one thing that overrides this is data
residency: if the existing project is not in Canada, `turns` — which holds the
full text of student messages and model replies — would sit outside it, and a
separate Canadian project becomes necessary.

**A separate problem repository** as a third submodule. `coding-cat-public` is
shared with upstream `coding-cat-official`; a set of assessment questions for one
course at one institution does not belong there.

## The grade feature

```
pseudonym = HMAC-SHA256(RESEARCH_SALT, auth.uid())
```

`RESEARCH_SALT` is an Edge Function secret: never in the database, the repo, or
the browser. `self_reported_grades` has no `profile_id`, no `user_id`, and no
foreign key to `auth.users` — nothing in the schema links a row to a person.
Someone holding the entire database, or a leaked service-role key, sees only
opaque 64-hex strings and cannot join to `profiles.student_id`.

The research export applies the same HMAC on the other side, so grades line up
with usage without a raw UUID entering the dataset. Destroying the salt after
export converts the retained data from pseudonymous to anonymous.

Three choices inside that are worth recording:

**HMAC, not a hash.** `SHA-256(uuid)` would have been a rename, not a protection:
every user id is already in `auth.users` and trivially enumerable, so anyone with
the database could reverse it by brute force. A keyed construction is what makes
the mapping uncomputable. The minimum key length is enforced at runtime — a short
or absent salt raises rather than quietly producing weak pseudonyms.

**Whoever holds the salt can re-identify, and the consent text says so.** This is
unavoidable for any design that answers the research question. The honest move is
to state it and to make destruction of the salt a documented step, not to
describe pseudonymity as anonymity.

**RLS on, zero policies.** Not even `SELECT`. The same posture socratic-assistant
uses for `sessions` and `turns`. Students still get full view, edit and withdraw
over their own data, because the function holds the salt and can therefore read
their rows back on their behalf — read access requires proving you are that user
via a JWT, and the pseudonym itself never reaches the browser.

Supporting decisions: numeric 0–100 rather than the existing
`proficient/approaching_mastery/mastery` vocabulary, which cannot express an exam
score and would throw away the precision the correlation needs. Append-only,
because students report after each exam and a late correction must not destroy
the earlier answer. Consent recorded in the database with a version, not in
`localStorage` like the existing AI disclosure — research consent has to be
auditable and withdrawable. Consent text served by the server and echoed back by
the client, so a student cannot record consent to wording they were never shown
and a stale tab cannot consent to superseded text. Withdrawal deletes rather than
tombstones; the ledger keeps the audit trail.

## The correctness gate

This was not requested. It is the difference between importing questions and
importing questions that work.

Nobody transcribes expected answers. `import_questions.py` executes the
instructor's solution against each input and records what it returns. Where an
expected value is supplied anyway it becomes an assertion, and a disagreement
fails the import — which catches a wrong solution or a mistyped expectation
before a student sees it. `verify_problems.py` re-runs the whole set on every
build, and fails rather than skipping when a problem has no solution to check
against.

The importer also refuses several shapes that survive JSON into an assertion
nobody can satisfy. The sharp one: a returned **tuple**. JSON stores it as a
list, and in Python `(1, 2) != [1, 2]`, so a student returning exactly what the
question asked for is marked wrong every time with no way to tell why. Also
refused: sets, non-string dict keys, NaN/inf, solutions that raise or print.
Unrounded floats warn once — rounded ones do not, because a warning that fires on
every float is a warning people learn to ignore.

## Scope notes

Two things here exceed the literal request, and both are called out as such: the
correctness gate above, and storing research consent in the database. Collecting
identifiable students' grades is human-subjects research; a consent record with a
version and a withdrawal path is the minimum that makes the feature defensible,
and its absence would surface at REB rather than in code review.

Three latent bugs were fixed because the COMP204 configuration is the one that
triggers them: `enable-all-problems` writing an empty allowlist that disables
every problem, `build-all` dying on any non-problem top-level directory, and the
`REACT_APP_PROBLEM_SET` bypass. None were reachable with a single problem set and
a single deployment.

## Verification

- 40 Deno tests on `submit-grades`, including a known-answer HMAC vector
  independently reproduced by `openssl`, Python and Node — the contract between
  the function and the export script, whose silent divergence would produce an
  empty join indistinguishable from "nobody used the tutor".
- 24 Jest tests, covering error-kind propagation and the problem-set fix.
- 71 checks on the problem tooling, end to end through import, verify, validate
  and build, including an assertion that no built `problem.json` carries a
  solution.

## Open

REB approval; which branch ships (`feat/analyze-via-socratic` is still unmerged
and `main` has no `supabase/` directory at all); the hosting target, since the
repo names three and the GitHub Pages job is provably broken; and the region of
the existing socratic project, which decides whether it is shared or duplicated.
See `docs/comp204-deployment.md`.
