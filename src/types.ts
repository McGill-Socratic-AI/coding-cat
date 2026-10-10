import { getCategoryList } from "./utils/getCategoryList";

export interface IOPair {
    input: any[];
    output: any;
}

export interface Report {
  input: string;
  expected: string;
  actual: string;
  equal: boolean;
  error?: string | null;
}

export type EvalResponse
    = { status: 'success'; report: Report[] }
    | { status: 'failure'; message: string }


export interface ProblemMeta {
    name: string;
    title: string;
    difficulty: string;
    author: string;
    category: string;
    question_type: Array<string>;
}

export interface Problem {
    description: string;
    starter?: string;
    meta: ProblemMeta;
    io: Array<IOPair>;
    mutations?: Array<string>;
    solution?: string;
}
export type Usage = { dailyUsed: number; problemUsed: number };

// Present only on a follow-up call: continue the conversation identified by
// threadId instead of generating a fresh review.
export type FollowUp = {
  threadId: string;
  message: string;
};

export type AnalyzeRequest = {
  meta: ProblemMeta;
  description: string;
  io: IOPair[];
  starter: string;
  code: string;
  testReport: Report[];
  followUp?: FollowUp;
};

// The follow-up limits live in src/utils/analysisLimits.ts, not here: this
// module has a runtime dependency on the generated src/problems/problems.js
// (via getCategoryList), so a runtime import from here breaks Jest runs that
// have not built the problem set.

export type ThreadRole = 'user' | 'assistant';
export type ThreadSource = 'review' | 'followup';

export type ThreadMessage = {
  id: string;
  role: ThreadRole;
  source: ThreadSource;
  content: string;
  turnIndex: number;
  createdAt: string;
};

export type AnalyzeThread = {
  threadId: string;
  messages: ThreadMessage[];
  followUpsUsed: number;
  followUpsLimit: number;
};

export type AnalyzeSuccess = { ok: true; analysis: string; usage: Usage; thread: AnalyzeThread };
export type AnalyzeError = {
  ok: false;
  kind: 'rate_limit' | 'auth' | 'flag_off' | 'upstream' | 'invalid_input' | 'turn_limit' | 'thread_not_found' | 'unknown';
  message: string;
  retryAt?: string;
  usage?: Usage;
};
export type AnalyzeResponse = AnalyzeSuccess | AnalyzeError;


export type Progress = {
    category: string;
    completed: number;
    total: number;
    question_type: string;
    problems: {
        title: string;
        difficulty: string;
    }[];
}

export type Reflection = {
    category: string;
    problem_title: string;
    code: {
        code: string;
    } | {
        Input: string[];
        Expected: string;
    }[];
    reflection: string | {
        question: string;
        answer: string;
    };
    submitted_at: Date;
}

export type Submission = {
    problem_title: string;
    passed_tests: number;
    total_tests: number;
}

export interface GenericContract {
    gradeWanted: string;
    problemsToSolve: number;
    codeDescription: string;
    reflectionPlan: string;
}

export interface CodingContract {
    gradeWanted: string;
    problemsToSolveByCategory: Record<string, number>;
    codeDescription: string;
    reflectionPlan: string;
}

export type ContractData ={
    Coding: CodingContract;
    Haystack: GenericContract;
    Mutation: GenericContract;
}

const codingCategories = getCategoryList();

export const BLANK_CONTRACT: ContractData = {
    "Coding":{
        gradeWanted: "",
        problemsToSolveByCategory: codingCategories.reduce(
          (acc, cat) => ({ ...acc, [cat]: 0 }),
          {}
        ),
        codeDescription: "",
        reflectionPlan: "",
      },
    "Mutation":  { gradeWanted: "", problemsToSolve: 0, codeDescription: '', reflectionPlan: '' },
    "Haystack":  { gradeWanted: "", problemsToSolve: 0, codeDescription: '', reflectionPlan: '' }
}

export type ContractProgress = {
    [category: string]: number;
}
