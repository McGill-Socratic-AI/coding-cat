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

export type AnalyzeRequest = {
  meta: ProblemMeta;
  description: string;
  io: IOPair[];
  starter: string;
  code: string;
  testReport: Report[];
};

export type AnalyzeSuccess = { ok: true; analysis: string; usage: Usage };
export type AnalyzeError = {
  ok: false;
  kind: 'rate_limit' | 'auth' | 'flag_off' | 'upstream' | 'invalid_input' | 'unknown';
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

/**
 * An empty contract whose coding section is keyed by the given categories.
 *
 * This used to be a module-level constant that called `getCategoryList()`,
 * which statically imported the problem set — so importing `types.ts` (which
 * nearly every module does) pulled in a hardcoded problem set and defeated
 * `REACT_APP_PROBLEM_SET`. Callers now pass the categories of the set they
 * actually loaded.
 */
export function blankContract(codingCategories: string[]): ContractData {
    return {
        "Coding": {
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
    };
}

/** Placeholder for state initialised before the problem set has loaded. */
export const BLANK_CONTRACT: ContractData = blankContract([]);

export type ContractProgress = {
    [category: string]: number;
}

// --- Self-reported grades (COMP204 research instrument) ---------------------
// Mirrors supabase/functions/submit-grades/types.ts. The order here is the
// order the form renders in.

export const GRADE_ITEMS = [
  'exam_1',
  'exam_2',
  'exam_3',
  'assignment_1',
  'assignment_2',
  'assignment_3',
  'assignment_4',
] as const;

export type GradeItem = typeof GRADE_ITEMS[number];

export const GRADE_ITEM_LABELS: Record<GradeItem, string> = {
  exam_1: 'Exam 1',
  exam_2: 'Exam 2',
  exam_3: 'Exam 3',
  assignment_1: 'Assignment 1',
  assignment_2: 'Assignment 2',
  assignment_3: 'Assignment 3',
  assignment_4: 'Assignment 4',
};

export type ConsentState = {
  version: string;
  /** Markdown, authored server-side so the client cannot vary what was agreed to. */
  text: string;
  granted: boolean;
  grantedAt: string | null;
};

export type GradesSuccess = {
  ok: true;
  consent: ConsentState;
  grades: Partial<Record<GradeItem, number>>;
};

export type GradesError = {
  ok: false;
  kind:
    | 'auth'
    | 'flag_off'
    | 'invalid_input'
    | 'consent_required'
    | 'config'
    | 'rate_limit'
    | 'unknown';
  message: string;
};

export type GradesResponse = GradesSuccess | GradesError;

export type GradesRequest =
  | { action: 'status' }
  | { action: 'consent'; consentVersion: string }
  | { action: 'withdraw' }
  | { action: 'submit'; grades: Partial<Record<GradeItem, number | null>> };
