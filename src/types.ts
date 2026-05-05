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
}

export type EvalResponse
    = { status: 'success'; report: Report[] }
    | { status: 'failure'; message: string }

export interface Problem {
    description: string;
    starter?: string;
    meta: {
        name: string;
        title: string;
        difficulty: string;
        author: string;
        category: string;
        question_type: Array<string>;
    };
    io: Array<IOPair>;
    mutations?: Array<string>;
    solution?: string;
}

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

export interface QuestionOption {
  label: string;
  value: string;
}

export interface Question {
  id: string;
  text: string;
  type: "radio" | "checkbox" | "number" | "textarea";
  options?: QuestionOption[];
  category: string;
  placeholder?: string;
  min?: number;
  max?: number;
  randomizeable?: boolean;
  relies_on?: string;
}

export interface FormAnswers {
  [questionId: string]: string | string[] | number;
}

export interface Session {
  session_id: string;
  profile_id: string;
  started_at: Date;
  ended_at?: Date;
  planned_duration_minutes: number;
  planned_exercise_count: number;
  planned_categories: string[];
  created_at: Date;
  updated_at: Date;
}

export interface SessionReflection {
  reflection_id: string;
  session_id: string;
  reflection_type: "pre" | "post";
  form_data: FormAnswers;
  created_at: Date;
}

export interface ProblemLog {
  problem_title: string;
  session_id: string;
  profile_id: string;
  problem_category: string;
  question_type: string;
  attempt_count: number;
  successful: boolean;
  passed_tests: number;
  total_tests: number;
  time_spent_seconds: number;
  first_attempt_at: string;
  last_attempt_at: string;
  code: unknown;
}