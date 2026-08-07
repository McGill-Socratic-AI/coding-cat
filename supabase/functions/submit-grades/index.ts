// submit-grades — self-reported grade collection for the COMP204 study.
//
// Everything a student can do to their own research record goes through this
// one endpoint: see what they have entered, consent, submit or clear scores,
// and withdraw. It exists (rather than the browser writing the table directly)
// for one reason: the HMAC salt that turns a user id into a research pseudonym
// must never leave the server. See pseudonym.ts.

import { corsHeaders, handleOptions } from "./cors.ts";
import { clientFromAuthHeader, getUserId, makeServiceClient } from "./auth.ts";
import { isFlagOn } from "./flag.ts";
import { computePseudonym, PseudonymConfigError } from "./pseudonym.ts";
import { CONSENT_TEXT, CONSENT_VERSION } from "./consent.ts";
import { parseRequest } from "./validate.ts";
import {
  applyGrades,
  countRecentRows,
  DAILY_ROW_CAP,
  deleteAllGrades,
  readGrades,
  readLatestConsent,
  recordConsent,
} from "./store.ts";
import type { GradesError, GradesErrorKind, GradesOk } from "./types.ts";

const FEATURE_FLAG = "GradeSelfReport";

// Guards against an oversized body being parsed at all. Grade payloads are a
// few hundred bytes; anything approaching this is not a real submission.
const MAX_BODY_BYTES = 16 * 1024;

function jsonError(
  kind: GradesErrorKind,
  message: string,
  status: number,
): Response {
  const body: GradesError = { ok: false, kind, message };
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

function jsonOk(body: GradesOk): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") {
    return jsonError("invalid_input", "Method not allowed", 405);
  }

  // --- Authentication ------------------------------------------------------
  const client = clientFromAuthHeader(req.headers.get("Authorization"));
  const userId = await getUserId(client);
  if (!userId) {
    return jsonError("auth", "Authentication required", 401);
  }

  // --- Feature flag (fail-closed) ------------------------------------------
  if (!(await isFlagOn(client, FEATURE_FLAG))) {
    return jsonError("flag_off", "Grade reporting is currently disabled", 403);
  }

  // --- Body ----------------------------------------------------------------
  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return jsonError("invalid_input", "Request body too large", 413);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return jsonError("invalid_input", "Invalid JSON body", 400);
  }

  const parsed = parseRequest(parsedJson);
  if (!parsed.ok) {
    return jsonError("invalid_input", parsed.message, 400);
  }
  const request = parsed.value;

  // --- Pseudonym -----------------------------------------------------------
  // A misconfigured salt is a deployment error, not a user error. Fail loudly
  // with a 500 rather than silently writing rows under a weak pseudonym.
  let pseudonym: string;
  try {
    pseudonym = await computePseudonym(userId);
  } catch (e) {
    if (e instanceof PseudonymConfigError) {
      console.error("[submit-grades] pseudonym misconfiguration:", e.message);
      return jsonError(
        "config",
        "Grade reporting is misconfigured on the server",
        500,
      );
    }
    throw e;
  }

  const service = makeServiceClient();

  try {
    switch (request.action) {
      case "status":
        break;

      case "consent": {
        // Reject anything but the current version, so a stale tab cannot record
        // consent against superseded wording.
        if (request.consentVersion !== CONSENT_VERSION) {
          return jsonError(
            "invalid_input",
            "The consent form has been updated. Please reload and read it again.",
            409,
          );
        }
        await recordConsent(service, userId, CONSENT_VERSION, "granted");
        break;
      }

      case "withdraw": {
        // Record first, then delete. If the delete fails we are left with a
        // withdrawal on record and data still present, which is visible and
        // fixable; the reverse order could delete data with no audit trail.
        await recordConsent(service, userId, CONSENT_VERSION, "withdrawn");
        await deleteAllGrades(service, pseudonym);
        break;
      }

      case "submit": {
        const consent = await readLatestConsent(service, userId);
        if (!consent || consent.action !== "granted") {
          return jsonError(
            "consent_required",
            "Please read and accept the research consent form first",
            403,
          );
        }
        if (consent.consent_version !== CONSENT_VERSION) {
          return jsonError(
            "consent_required",
            "The consent form has been updated. Please read and accept it again.",
            403,
          );
        }

        const recent = await countRecentRows(service, pseudonym);
        if (recent >= DAILY_ROW_CAP) {
          return jsonError(
            "rate_limit",
            "Too many changes today. Please try again tomorrow.",
            429,
          );
        }

        await applyGrades(service, pseudonym, request.grades, CONSENT_VERSION);
        break;
      }
    }

    // Every action answers with the same freshly-read view, so the client never
    // has to guess what the server now believes.
    const latest = await readLatestConsent(service, userId);
    const granted = latest?.action === "granted" &&
      latest.consent_version === CONSENT_VERSION;

    return jsonOk({
      ok: true,
      consent: {
        version: CONSENT_VERSION,
        text: CONSENT_TEXT,
        granted,
        grantedAt: granted ? (latest?.created_at ?? null) : null,
      },
      // No point reading rows back for someone who has not consented; they
      // cannot have any.
      grades: granted ? await readGrades(service, pseudonym) : {},
    });
  } catch (e) {
    console.error("[submit-grades] unexpected error:", e);
    return jsonError("unknown", "Something went wrong. Please try again.", 500);
  }
});
