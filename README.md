# Welcome to Coding Cat

In browser IDE with auto-tested problems in Python. Problems are organized around categories that denote their difficulty. This project is inspired by [CodingBat](https://www.codingbat.com).

The site can be found at https://coding-cat.onrender.com/.

## Run Locally

To run a local instance of Coding Cat, follow these steps.

First, you will need to install [jq](https://jqlang.org/). It is recommended to install it using a package manager, like apt for Linux or scoop for Windows. If you simply install the binary, you might have to place it in the usr/bin/ directory in your Git installation folder for it to work.

Then, clone the repo using `--recurse-submodules` to clone all the submodules as well. If you don't have access to the private-problems repository, clone the repo normally, and run `git submodule sync` and `git -c submodule.src/private-problems.update=none submodule update --init --recursive`. This will clone the public-problems submodule, while ignoring private-problems.

Coding Cat uses Supabase as its back-end database, so you will need valid `REACT_APP_SUPABASE_URL` and `REACT_APP_SUPABASE_ANON_KEY` environment variables defined in a `.env.local` file, which needs to be located in the project root.

Signing in needs the `account` Edge Function deployed (or served locally) as well as the database, because accounts are pseudonymous and the browser never talks to Supabase Auth directly — see [Accounts and privacy](#accounts-and-privacy).

Run `npm install` to install the dependencies, then run `npm run build` in the project root to set up the list of problems.

Finally, run `npm run start` to run the app locally.

### Run Unit Tests

To run the tests, use the `npm run test` command in the project root.

### Load different problem sets

To switch the problem set from the public-problems repository to the private-problems one, define an environment variable called `REACT_APP_PROBLEM_SET` and set it to either `public-problems` or `private_problems`. You will have to rebuild the problem list using `npm run build-problems`. If this variable is not defined, it will use `public-problems` by default.

## Accounts and privacy

Coding Cat is self-hosted for one course and reached from the school network, so
an account must let us recognise that a user is always the same person **without**
letting anyone tie that person to a named student. Accounts are therefore
pseudonymous, and the app collects no personal information at all:

| What a student gives us | What is stored |
| --- | --- |
| a username they choose | `profiles.username`, lower-cased. Also the login name. |
| a password | only GoTrue's bcrypt hash, in `auth.users`. |
| nothing else | — |

* **No email address.** GoTrue will not create a user without one, so each
  account gets a random 128-bit placeholder at a domain in RFC 2606's reserved
  `.invalid` TLD (`supabase/functions/account/placeholder.ts`). It is
  undeliverable, identifies nobody, and is never shown: the browser sends a
  username and the Edge Function resolves it. There is no magic link and no
  "email me a reset link", and email confirmation must stay off. GoTrue's public
  signup is disabled, so the Edge Function is the only way to create an account,
  and a trigger on `auth.users` refuses any change to an account's email or
  phone, so the placeholder can never be swapped for a real address.
* **No name and no student number.** The old profile editor collected both;
  `profiles.student_id` has been dropped, the editor is gone, and
  `profiles_username_policy` refuses a username that is an email address or a
  student number (3-24 characters, starts with a letter, letters/digits/`-`/`_`
  only, no digit run longer than 4 and no more than 6 digits in all). The
  sign-up page and the AI Analysis panel both say not to type a name or student
  number into code, questions or reflections — the one leak the app cannot
  prevent on its own.
* **No IP addresses.** Nothing the app writes or forwards carries one, and
  triggers blank the IP GoTrue would record in `auth.audit_log_entries` and
  `auth.sessions` (`20261105000001_scrub_auth_ip_addresses.sql`). School
  WiFi, VPN and lab logins can map an IP and a timestamp back to a student, so
  rate limits key on the Supabase user id instead (`analyze_calls.user_id`, see
  `supabase/functions/analyze/rate_limit.ts`), and the Socratic API is sent that
  same uuid as its `student_id` and nothing else.

### Registration, sign-in and recovery

All three go through the `account` Edge Function
(`supabase/functions/account/`), which runs with `verify_jwt = false` because
every one of its actions is something a signed-out visitor does. It is the only
place that holds the service-role key for accounts, and the only place that
knows an account's placeholder address.

| Action | Request | Reply |
| --- | --- | --- |
| `signup` | username, password | username, **recovery code**, session tokens |
| `signin` | username, password | username, session tokens |
| `recover` | username, recovery code, new password | username, **new recovery code**, session tokens |

With no email there is no reset link, so a **one-time recovery code** — 100 bits
of Crockford base32, shown once at registration — takes its place. Only a salted
SHA-256 of it is stored, in `account_recovery`, a table with RLS on and no
policies at all: a student can neither read their own hash nor write one.
Redeeming a code replaces it with a freshly issued one, so it works once and an
account is never left without a way back in. A lost code cannot be recovered by
anyone, course staff included; the sign-up screen says so and will not continue
until the student confirms they wrote it down.

A wrong password and an unknown username give the same answer, as do a wrong
code and an unknown username. A GoTrue rate limit or outage is reported as a
failure to retry, never as a wrong password. Signing in is proxied rather than
done in the browser (the placeholder address must not leave the server), which
means GoTrue's per-IP `sign_in_sign_ups` limit sees the function rather than the
student, so one bucket is shared by the whole class; `supabase/config.toml` sets
it to 500 per 5 minutes, and the deployment must match. Redeeming a recovery
code ends every other session on the account, so it takes an account back from
anyone else who knew the password. We deliberately do **not** lock
an account after failed attempts — knowing a classmate's username would then be
enough to lock them out of a lab or an exam, which is the worse failure here.

Existing cloud accounts are not migrated. Their whole problem is the real email
address in `auth.users`, and the VM starts with no users.

### Deploying the accounts function

See [Edge Functions](#edge-functions) for the CLI setup, then:

```bash
supabase functions deploy account
supabase db push                  # applies the migrations, including account_recovery
```

Server-side settings this code assumes, which live in the Supabase project and
not in this repo:

| Setting | Required value | Why |
| --- | --- | --- |
| Email confirmations | off | the placeholder address can never receive one |
| SMTP | not configured | nothing should ever try to send mail |
| Public signup | disabled (`GOTRUE_DISABLE_SIGNUP=true`) | accounts are created only by the `account` function |
| Sign-in / sign-up rate limit | 500 per 5 minutes, as in `config.toml` | every sign-in arrives from the function's address |

## Modifying the App

### Modify Contract

- To modify the contract there are two files which needs to be modified the `ContractEdit.tsx` and the `ContractText.tsx`.
- `ContractText.tsx` is used to display the contract information fetched from the database.
- `ContractEdit.tsx` is used to get the user information and update the database with what the users wrote in the input boxes.

### Omitting certain categories
- Currently there is a way to lock the categories until a certain number of problems have been solved of the previous category (category locked but still visible to the user). And there is a way to completely omit the categories(categories are not visible to the users on the problem list)
- `CategoryLock.ts` file needs to be modified to change the rules of what problems are locked and how many problems from the previous category needs to be completed.
- The file `enabled-problems` (inside the coding cat public problems repo) controls which problems actually get build into `problems.js`. It is a list of problem names, or entire categories, i.e. strings that appear under the `name` or `category` key in `meta.json`

## To Do
- Enhancing the admin menu so that it allows problem categories to be omitted with the contract sections. ( Currently the admin menu can set topics as true or false and according to that information the contract data would be displayed. We have a separate way to omit problems, the idea is to merge both so that when the admin decides to remove mutation from the menu it stops displaying mutation data in the contract and mutation problems in the problem list ) 
- Refactor to remove duplicate code in `ContractEdit` and `ContractText`.
- Finding all problems that rely on problem type and replace them with objects. (Ex: `problem.question_type[0] == "mutation"`). The code will be redundant if we add another problem type like debugging problems.
- Isolate `Drawer` in `root.tsx` into a separate component.
- There is a crazy amount of re-renders and useEffect. 
- Rethink the problem type / category nesting. `CategoryList`'s first half is problems in categories and the second half is problems in question types mutation and haystack. The categories organized by question type have category tabs. Very complicated :D
    - #### Ideas
        - coding/mutation/haystack > category > problem?
        - make mutation/haystack be categories
        - or something else completely :D
- Implement SN1 course textbook into coding-cat
- Improve reflection questions (Right now they are random)
- Add higher quality problems to the public repo
- Add color schemes to the application (like darkmode)
- Add more problem types (ex. debugging/spot the bug)

## Project History and Timeline

### Summer 2024
A bare, front-end only version of this application was developed by Eric Mayhew and Jacob Errington in Summer of 2024. 

### Fall 2024
During the school year, dozens of students in Eric's introduction to Python course at Dawson added dozens of problems to the problem set. Thank you to these students for enhancing the application.

### Spring 2025 
During April to May of 2025, 3 student interns (Emmanuelle Lin, Ahmed Sobh, and Kristian Garkov) implemented a number of key features that make Coding Cat what it is today, such as: a backend with persistent user accounts, the ability for users to set individualized goals for number of problems completed, new problem types (like mutation testing problems), and reflections.  Thank you to these students for implementing these key features.

## Edge Functions

Edge Functions live under `supabase/functions/<name>/` and run on Supabase's Deno runtime. The CLI is required for local dev and deployment:

```bash
brew install supabase
brew install deno   # for local function tests
```

One-time setup (per developer):

```bash
supabase login                                     # interactive (browser)
supabase link --project-ref <prod_or_staging>      # interactive (db password)
supabase secrets set SOCRATIC_PLATFORM_KEY=...     # function secret
```

Local dev (runs the function on `http://localhost:54321/functions/v1/<name>`):

```bash
supabase functions serve <name> --env-file ./supabase/functions/.env.local
```

Deploy:

```bash
npm run deploy:functions          # deploys all functions in supabase/functions/
supabase functions deploy <name>  # deploy a single function
```

Per-function unit tests use Deno's built-in runner:

```bash
cd supabase/functions/<name>
deno test --allow-env --allow-net
```

### AI Analysis

The `analyze` function is gated by the `AIAnalysis` row in the existing `activated` table — defaults OFF — and is hidden from signed-out visitors.

It does not call an LLM itself: it forwards the submission to the Socratic API (`supabase/functions/analyze/socratic.ts`), which owns the prompt and the conversation history. Secrets stay server-side:

| Secret / env var           | Required | Purpose                                                    |
| -------------------------- | -------- | ---------------------------------------------------------- |
| `SOCRATIC_PLATFORM_KEY`    | yes      | Platform bearer token for the Socratic API. Never reaches the browser. |
| `SOCRATIC_URL`             | no       | Override the Socratic endpoint (defaults to the hosted one). |
| `SOCRATIC_COURSE_OFFERING` | no       | Course offering id sent with every call.                   |

**Follow-up conversations.** After the first review a signed-in student can ask follow-up questions about the same submission. A thread is one conversation per (user, problem), stored in `analyze_threads` / `analyze_messages` (see `supabase/migrations/20261009000000_analyze_threads.sql`); RLS lets a student read only their own, and there is no student write policy — every write goes through the Edge Function's service-role client. The earlier exchange is carried by `analyze_threads.socratic_session_id` — the Socratic API keeps the authoritative turn history and replays it into the prompt, so the transcript never travels in our request. Reviews keep the existing daily (20) and per-problem (5) caps from `analyze_calls`; follow-ups have their own budget (`thread.ts`: 10 per review — a new analysis starts a fresh allowance — and 30 per day, 2000 characters per question) so asking questions never consumes a student's review budget. 
