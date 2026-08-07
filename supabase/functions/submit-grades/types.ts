export const GRADE_ITEMS = [
  "exam_1",
  "exam_2",
  "exam_3",
  "assignment_1",
  "assignment_2",
  "assignment_3",
  "assignment_4",
] as const;

export type GradeItem = typeof GRADE_ITEMS[number];

export function isGradeItem(value: unknown): value is GradeItem {
  return typeof value === "string" &&
    (GRADE_ITEMS as readonly string[]).includes(value);
}

/** `null` means "clear whatever I previously reported for this item". */
export type GradeMap = Partial<Record<GradeItem, number | null>>;

export type StatusRequest = { action: "status" };
export type ConsentRequest = { action: "consent"; consentVersion: string };
export type WithdrawRequest = { action: "withdraw" };
export type SubmitRequest = { action: "submit"; grades: GradeMap };

export type GradesRequest =
  | StatusRequest
  | ConsentRequest
  | WithdrawRequest
  | SubmitRequest;

export type GradesErrorKind =
  | "auth"
  | "flag_off"
  | "invalid_input"
  | "consent_required"
  | "config"
  | "rate_limit"
  | "unknown";

export interface GradesError {
  ok: false;
  kind: GradesErrorKind;
  message: string;
}

export interface ConsentState {
  version: string;
  text: string;
  granted: boolean;
  grantedAt: string | null;
}

export interface GradesOk {
  ok: true;
  consent: ConsentState;
  /** The caller's own current answers, read back through their pseudonym. */
  grades: Partial<Record<GradeItem, number>>;
}
