// IMPORTANT: This file straddles two roles. CRA + Deno cannot share a file,
// so we duplicate types deliberately.
//
//   FE-mirroring half (must stay in sync with src/types.ts on the FE):
//     - ProblemMeta, IOPair, Report
//
//   Analyze-specific half (single source of truth — copy into FE if needed):
//     - AnalyzeRequest, AnalyzeSuccess, AnalyzeError, AnalyzeResponse,
//       AnalyzeKind, Usage
//
// Note: Report.error?: string | null is added here for future-proofing
// (worker.py emits it). The FE Report shape may not have it yet — that
// is intentional and resolved when F1 (issue #14) lands on the FE side.

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
