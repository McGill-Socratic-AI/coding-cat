# Welcome to Coding Cat

In browser IDE with auto-tested problems in Python. Problems are organized around categories that denote their difficulty. This project is inspired by [CodingBat](https://www.codingbat.com).

The site can be found at https://coding-cat.onrender.com/.

## Run Locally

To run a local instance of Coding Cat, follow these steps.

First, you will need to install [jq](https://jqlang.org/). It is recommended to install it using a package manager, like apt for Linux or scoop for Windows. If you simply install the binary, you might have to place it in the usr/bin/ directory in your Git installation folder for it to work.

Then, clone the repo using `--recurse-submodules` to clone all the submodules as well. If you don't have access to the private-problems repository, clone the repo normally, and run `git submodule sync` and `git -c submodule.src/private-problems.update=none submodule update --init --recursive`. This will clone the public-problems submodule, while ignoring private-problems.

Coding Cat uses Supabase as its back-end database, so you will need valid `REACT_APP_SUPABASE_URL` and `REACT_APP_SUPABASE_ANON_KEY` environment variables defined in a `.env.local` file, which needs to be located in the project root.

Run `npm install` to install the dependencies, then run `npm run build` in the project root to set up the list of problems.

Finally, run `npm run start` to run the app locally.

### Run Unit Tests

To run the tests, use the `npm run test` command in the project root.

### Load different problem sets

To switch the problem set from the public-problems repository to the private-problems one, define an environment variable called `REACT_APP_PROBLEM_SET` and set it to either `public-problems` or `private_problems`. You will have to rebuild the problem list using `npm run build-problems`. If this variable is not defined, it will use `public-problems` by default.

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
supabase login                                # interactive (browser)
supabase link --project-ref <prod_or_staging> # interactive (db password)
supabase secrets set ANTHROPIC_API_KEY=sk-... # function secret
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

The `analyze` function (AI Analysis feature) requires `ANTHROPIC_API_KEY` and is gated by the `AIAnalysis` row in the existing `activated` table — defaults OFF. 
