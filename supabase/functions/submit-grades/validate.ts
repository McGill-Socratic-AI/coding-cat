import {
  GRADE_ITEMS,
  type GradeItem,
  type GradeMap,
  type GradesRequest,
  isGradeItem,
} from "./types.ts";

export type Validated<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

const MAX_CONSENT_VERSION_LEN = 100;

// NUMERIC(5,2) in the schema. We round here rather than letting Postgres do it
// so that the value we validated is exactly the value we store — otherwise a
// score could pass a range check and land as something slightly different.
export function normaliseScore(n: number): number {
  return Math.round(n * 100) / 100;
}

export function validateGrades(raw: unknown): Validated<GradeMap> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "grades must be an object" };
  }

  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) {
    return { ok: false, message: "grades must contain at least one item" };
  }
  // Can't exceed the number of distinct items; anything more is a malformed or
  // hostile payload rather than a real submission.
  if (entries.length > GRADE_ITEMS.length) {
    return {
      ok: false,
      message: `grades may contain at most ${GRADE_ITEMS.length} items`,
    };
  }

  const out: GradeMap = {};
  for (const [key, value] of entries) {
    if (!isGradeItem(key)) {
      return { ok: false, message: `unknown grade item: ${key}` };
    }

    if (value === null) {
      out[key as GradeItem] = null;
      continue;
    }

    if (typeof value !== "number" || !Number.isFinite(value)) {
      return {
        ok: false,
        message:
          `${key} must be a number between 0 and 100, or null to clear it`,
      };
    }
    if (value < 0 || value > 100) {
      return { ok: false, message: `${key} must be between 0 and 100` };
    }

    out[key as GradeItem] = normaliseScore(value);
  }

  return { ok: true, value: out };
}

export function parseRequest(body: unknown): Validated<GradesRequest> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "request body must be a JSON object" };
  }

  const { action } = body as Record<string, unknown>;

  switch (action) {
    case "status":
      return { ok: true, value: { action: "status" } };

    case "withdraw":
      return { ok: true, value: { action: "withdraw" } };

    case "consent": {
      const version = (body as Record<string, unknown>).consentVersion;
      if (typeof version !== "string" || version.length === 0) {
        return { ok: false, message: "consentVersion (string) is required" };
      }
      if (version.length > MAX_CONSENT_VERSION_LEN) {
        return {
          ok: false,
          message:
            `consentVersion exceeds ${MAX_CONSENT_VERSION_LEN} characters`,
        };
      }
      return {
        ok: true,
        value: { action: "consent", consentVersion: version },
      };
    }

    case "submit": {
      const grades = validateGrades((body as Record<string, unknown>).grades);
      if (!grades.ok) return grades;
      return { ok: true, value: { action: "submit", grades: grades.value } };
    }

    default:
      return {
        ok: false,
        message: "action must be one of: status, consent, submit, withdraw",
      };
  }
}
