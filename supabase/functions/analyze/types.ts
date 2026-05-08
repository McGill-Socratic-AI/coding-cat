// IMPORTANT: this file is a deliberate duplicate of src/types.ts on the FE.
// CRA + Deno cannot share a file. Keep these in sync manually.

export interface ProblemMeta {
  name: string;
  title: string;
  difficulty: string;
  author: string;
  category: string;
  question_type: Array<string>;
}

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

export interface AnalyzeRequest {
  meta: ProblemMeta;
  description: string;
  io: IOPair[];
  starter: string;
  code: string;
  testReport: Report[];
}

export interface Usage {
  dailyUsed: number;
  problemUsed: number;
}

export type AnalyzeKind =
  | "rate_limit"
  | "auth"
  | "flag_off"
  | "upstream"
  | "invalid_input"
  | "unknown";

export interface AnalyzeSuccess {
  ok: true;
  analysis: string;
  usage: Usage;
}

export interface AnalyzeError {
  ok: false;
  kind: AnalyzeKind;
  message: string;
  retryAt?: string;
  usage?: Usage;
}

export type AnalyzeResponse = AnalyzeSuccess | AnalyzeError;
