# Deploying Coding Cat for COMP 204, Fall 2026

A standalone instance for one course, backed by our own Socratic Assistant
tenant, with self-reported grade collection for the study.

Everything in this document that can be done in code has been. What remains
needs credentials or a dashboard, so it is written as a runbook rather than a
script.

---

## Before you start: three things to check

**1. Is the existing coding-cat Supabase project still alive?**

```bash
dig +short wafaxqzaofzyrlxxorom.supabase.co
```

At the time of writing this returns nothing from any public resolver, while the
socratic project (`ssqtelmhmywzhygkbbgv.supabase.co`) resolves normally.
Supabase does not wildcard its subdomains, so no record means the project is
paused or deleted. If it is gone, then:

- the current deployment has no backend,
- the e2e suite in `coding-cat-e2e` cannot run,
- and any historical `profiles` / `submissions` data may be unrecoverable.

None of that blocks COMP204 — we are creating a fresh project regardless — but
it changes what "restore the old setup" means, and it is worth knowing before
you promise anyone continuity.

**2. What region is the socratic project in?**

Student data should stay in Canada. That constraint applies to the *database*,
not to the static site, which contains no student data at all.

Check the region in the Supabase dashboard for `ssqtelmhmywzhygkbbgv`. It cannot
be determined from outside — the API is fronted by Cloudflare, so a `cf-ray`
suffix tells you which edge PoP served *you*, not where the data lives.

- **`ca-central-1`** → share it. Follow step 3a.
- **Anything else** → COMP204 tutoring conversations (`turns` holds the full text
  of student messages and model replies) would sit outside Canada. Stand up a
  separate socratic project in `ca-central-1`. Follow step 3b.

**3. Anthropic is outside Canada, and that cannot be fixed here.**

Every tutoring turn sends the student's code and message to Anthropic's US
infrastructure. `claude-haiku-4-5` is a hosted model; no database region changes
this. The current system already does it. It must appear in the REB submission,
and it is stated plainly in the consent text
(`supabase/functions/submit-grades/consent.ts`).

A related nuance worth disclosing: Supabase Edge Functions run on a globally
distributed runtime, so function *execution* may occur outside Canada even when
the data at rest does not.

---

## 1. Create the coding-cat project

New Supabase project, region **`ca-central-1` (Montréal)**. Suggested name
`coding-cat-comp204`.

Keep `wafaxqzaofzyrlxxorom` (named `coding-cat-mcgill-staging`) as staging if it
comes back. Real student and research data should not share a database with
smoke-test accounts.

```bash
cd coding-cat
git checkout feat/comp204-fall-2026
supabase link --project-ref <NEW_REF>
supabase db push
```

> `supabase/migrations/00000000000000_seed_existing_schema.sql` was
> reverse-engineered from the frontend and is normally pre-marked as applied on
> projects that already had the tables. On a genuinely fresh project it should
> apply cleanly, but as far as the repo shows this has never actually been done.
> Check the tables exist afterwards:
>
> ```sql
> \dt public.*
> -- expect: activated, profiles, submissions, contracts, analyze_calls,
> --         research_consent, self_reported_grades
> ```

Then restrict sign-up to McGill addresses in **Authentication → Providers →
Email**. Any email domain works by default, which is not what you want for a
course cohort feeding a study.

## 2. Generate the research salt

This is the secret the entire grade-privacy design rests on. It never goes in
the repo, a table, a log, or the browser.

```bash
openssl rand -hex 32
```

Store it somewhere you can retrieve it exactly once more (to run the export) and
then destroy. A password manager entry owned by the PI is appropriate; a Slack
message is not.

## 3. Socratic Assistant tenant

### 3a. Sharing the existing project (if it is in ca-central-1)

```bash
PLATFORM_KEY=$(openssl rand -hex 32)
PLATFORM_HASH=$(printf '%s' "$PLATFORM_KEY" | shasum -a 256 | awk '{print $1}')
echo "key (share out of band, store in coding-cat secrets): $PLATFORM_KEY"
```

Against the socratic project:

```sql
INSERT INTO platforms (id, api_key_hash, active)
VALUES ('coding-cat-comp204', '<PLATFORM_HASH>', true);
```

Then grant the instructor access to the course offering:

```bash
cd ../socratic-assistant
npx tsx scripts/admin/create-teacher.ts \
  --email <instructor@mcgill.ca> \
  --platform coding-cat-comp204 \
  --course-offering comp204-f2026
```

Tenancy is enforced on `(platform_id, course_offering_id)` across `sessions`,
`documents`, `chunks` and `teacher_grants`, and `supabase/tests/06_match_chunks_test.sql`
pins retrieval isolation, so COMP204 data stays separate from anything else in
that project.

### 3b. A separate socratic project (if the existing one is not in Canada)

Create a second Supabase project in `ca-central-1`, then:

```bash
cd ../socratic-assistant
supabase link --project-ref <SOCRATIC_REF>
supabase db push
supabase secrets set ANTHROPIC_API_KEY=<...> INTERNAL_FUNCTION_SECRET=<...>
supabase functions deploy socratic
supabase functions deploy process-document
```

Then run `scripts/admin/setup-hosted.sql` against it. It creates the vault
secrets `project_url` and `internal_function_secret` — **the latter must be
byte-identical to the `INTERNAL_FUNCTION_SECRET` function secret above** — plus
the `course-material` storage bucket. Then do the `platforms` insert and
`create-teacher.ts` from 3a.

The teacher portal is a separate manual deploy (Cloudflare Pages, root
`portal/`, output `dist`, `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`); add
its URL to Supabase Auth → URL Configuration.

Note `.github/workflows/deploy.yml` uses repo-level
`secrets.SUPABASE_PROJECT_REF` with no environment matrix, so it can only target
one project. Deploying two from one repo needs GitHub Environments or a second
workflow. Until then, deploy the second project manually.

## 4. Edge function secrets

Against the **coding-cat** project:

```bash
supabase secrets set \
  SOCRATIC_URL=https://<SOCRATIC_REF>.supabase.co/functions/v1/socratic \
  SOCRATIC_PLATFORM_KEY=<PLATFORM_KEY from step 3> \
  SOCRATIC_COURSE_OFFERING=comp204-f2026 \
  RESEARCH_SALT=<the salt from step 2>
```

**Set `SOCRATIC_COURSE_OFFERING` explicitly.** Its default in
`supabase/functions/analyze/socratic.ts` is the literal string
`"rag-smoke-test"`; if it is unset, every COMP204 student's tutoring history
lands in a smoke-test tenant. `SOCRATIC_URL` likewise defaults to a hardcoded
project ref.

## 5. Deploy the functions

There is no CI for edge functions in this repo. Both are manual:

```bash
supabase functions deploy analyze
supabase functions deploy submit-grades
```

## 6. The COMP204 problem set

Already wired, as a third submodule alongside the two upstream ones:

```
src/public-problems   -> coding-cat-official/coding-cat-public    (public, upstream)
src/private-problems  -> coding-cat-official/coding-cat-private   (private, no access)
src/comp204-problems  -> McGill-Socratic-AI/coding-cat-comp204-problems  (private, ours)
```

This follows upstream's own pattern: questions live in their own repository and
are compiled into the bundle at build time. Upstream does have a Supabase
backend and still keeps the question bank in the front end, which is a
reasonable call for read-only content that git can review and CI can validate.

`coding-cat-comp204-problems` is **private** and must stay that way: every
problem directory keeps the instructor's reference `solution.py` so `io.json` can
be verified. The build never ships it to the browser and both the validator and
CI assert that, but it is in git history.

To clone with it:

```bash
git submodule update --init src/comp204-problems   # needs org access
```

To add or change questions, see `QUESTIONS.md`, `IMPORT_FORMAT.md` and
`ED_EXPORT.md` in that repository. In short:

```bash
cd src/comp204-problems
python3 import_questions.py
python3 validate_problems.py
python3 verify_problems.py     # runs every solution against its io.json
```

### The public fork's CI does not build this set

`.github/workflows/main.yml` skips both private submodules, because this
repository is a public fork and the job's `GITHUB_TOKEN` cannot read either of
them. Giving it a credential that could would put the answer key one leaked log
away from a public repository.

So CI here verifies that the code compiles against the public problem set, and
nothing more. **Building the COMP204 bundle is the deployment pipeline's job**,
running under its own identity with access to the private repository. That is
step 7.

Then, in `coding-cat/.env.local` (and in whatever injects env at build time):

```
REACT_APP_PROBLEM_SET=comp204-problems
REACT_APP_SUPABASE_URL=https://<NEW_REF>.supabase.co
REACT_APP_SUPABASE_ANON_KEY=<anon key>
```

```bash
npm run build     # build-problems, then react-scripts build
```

These are Create React App variables, baked in at build time. **A second
instance is a second build artifact, not a runtime switch.**

> One thing to expect in the build output: `getProblemSet()` resolves its module
> through a template literal, so webpack cannot know which set is wanted and
> emits a lazy chunk for *every* `src/*/problems`. The COMP204 build therefore
> contains a chunk holding the upstream public set as well.
>
> This costs nothing at runtime — chunks are fetched on demand and only the
> configured set is ever imported — and it has been verified that no reference
> solution reaches any chunk. It is inherent to the dynamic import and cannot be
> changed without ejecting CRA, so it is documented rather than fixed.

## 7. Host the static build

The repo currently names three mutually contradictory targets and none of them
is known to be live:

| Target | State |
|---|---|
| GitHub Pages (`.github/workflows/main.yml`) | **Provably broken.** The build job injects no `REACT_APP_*` values, so the artifact ships with an empty Supabase URL and key. Also `concurrency: group "pages"` allows one Pages target per repo. |
| `coding-cat.onrender.com` (README) | No `render.yaml` anywhere in the repo. |
| `rsync` to `jerrington.me` (`package.json`) | Two roots already exist (`coding-cat`, `exam-coding-cat`), so this is the existing precedent for a second instance. Needs shell access, no CI. |

Recommended: **Cloudflare Pages**. The socratic teacher portal already deploys
there, so it is one account and one workflow; it injects build-time environment
variables properly, which is exactly what the GitHub Pages job fails to do; and
it gives preview deploys and a custom domain.

The static bundle holds no student data, so hosting region is not a residency
concern — the Canadian requirement is satisfied by the database in step 1.

## 8. Turn the features on

Both `analyze` and `submit-grades` fail closed on their feature flags, so
nothing works until you flip them.

Make yourself an admin first (there is no bootstrap path):

```sql
UPDATE profiles SET is_admin = true WHERE profile_id = '<your uuid>';
```

Then from `/#/admin`, or directly:

```sql
UPDATE activated SET activated = true WHERE topic = 'AIAnalysis';
UPDATE activated SET activated = true WHERE topic = 'GradeSelfReport';
-- plus Haystack / Mutation / CodingStage2 if the course wants them
```

Leave `GradeSelfReport` **off** until REB approval is in hand. It is a research
instrument, and the flag is the whole reason it can be built and deployed ahead
of approval.

## 9. Smoke test

1. Sign up with a McGill address; confirm a non-McGill address is refused.
2. Open a problem, run the starter code, see failing tests.
3. Solve it, see passing tests, confirm a row lands in `submissions`.
4. Click **Generate Analysis**; confirm a reply, a row in `analyze_calls`, and a
   row in the socratic project's `turns` under `course_offering_id =
   'comp204-f2026'`.
5. On `/#/profile`: the grade card appears only with the flag on; the consent
   text renders; declining leaves it collapsed.
6. Consent, enter a score, reload — the value comes back.
7. Confirm `self_reported_grades` holds a 64-hex pseudonym and **no user
   column**, and that it cannot be read with the anon key.
8. Withdraw; confirm the rows are gone and a `withdrawn` row is in
   `research_consent`.

## 10. Exporting the study data

```bash
cd coding-cat
SUPABASE_URL=https://<NEW_REF>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service role> \
RESEARCH_SALT=<the salt> \
SOCRATIC_SUPABASE_URL=https://<SOCRATIC_REF>.supabase.co \
SOCRATIC_SERVICE_ROLE_KEY=<service role> \
SOCRATIC_COURSE_OFFERING=comp204-f2026 \
node scripts/research-export.mjs --out ./export
```

Only students whose latest consent decision is a grant at the current version
are included — withdrawal deletes their grades, but their usage rows live in
ordinary application tables that nothing deletes, so the filter has to happen
here.

The script refuses to run under the publicly-known test salt, refuses a salt
under 128 bits, and scans every file for UUIDs, email addresses **and precise
timestamps** before writing.

### Then two destruction steps, not one

**1. Destroy `RESEARCH_SALT`.** This removes the direct route from a pseudonym
back to an account.

**2. Delete the operational data.** This one is easy to skip and it is what
actually makes the first step meaningful.

Destroying the salt alone does *not* make the dataset unlinkable. Every
per-student count in the export — analyses, submissions, active days, tutor
turns — also exists, keyed by real account id, in `submissions`,
`analyze_calls`, and socratic's `sessions`/`turns`. Anyone holding both could
attempt to match on the combination.

This was found by adversarially reviewing the first version of the export, which
emitted `first_activity` and `last_activity` at microsecond precision. Those
timestamps were unique per student essentially always, and a single equality
join against `submissions` re-identified every row in a test fixture with the
salt already destroyed. Dates are now reported as ISO weeks and the export
refuses to write a file containing a precise timestamp, but coarsening reduces
the risk rather than removing it: behavioural counts stay distinctive.

So: once the study data is exported and the salt is gone, delete the
account-keyed tables (or the whole project). Put a date on it in the REB
protocol. Retention is the control here, not cryptography.

---

## Still open

Things that are decisions or credentials rather than code:

- **REB approval.** Self-reported grades from identifiable students is
  human-subjects research. Nothing about the schema, consent ledger, or
  withdrawal path substitutes for approval. This likely has a longer lead time
  than the remaining engineering.
- **Which branch ships.** `feat/comp204-fall-2026` sits on top of
  `feat/analyze-via-socratic`, which is unmerged. `main` is identical to upstream
  and has no `supabase/` directory at all; `dev` still has the old
  direct-to-Anthropic implementation. Someone has to decide whether the McGill
  fork diverges permanently or these get merged down.
- **`coding-cat-e2e` is pinned to the old project.** `tests/helpers.ts` hardcodes
  the project ref, a full anon key, and the account
  `xiding.hu@mail.mcgill.ca` / `smoke-test-1234`. It cannot target the new
  environment without editing source, and it is not a git repository.
- **Confirm the consent text with the instructor and the REB** before flipping
  `GradeSelfReport`. It lives in
  `supabase/functions/submit-grades/consent.ts`; changing the wording means
  bumping `CONSENT_VERSION`, which correctly re-prompts everyone who already
  agreed.
