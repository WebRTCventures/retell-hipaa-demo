import type { ComplianceResult } from "./types.js";
import type { CallSession } from "./call-session.js";
import {
  HIPAA_DISCLOSURE,
  TRANSFER_MESSAGE,
  MEDICAL_ADVICE_KEYWORDS,
} from "./constants.js";

/**
 * Validates an LLM-generated response against three sequential compliance rules:
 * 1. Disclosure injection (first turn only)
 * 2. Medical advice detection (blocks and short-circuits)
 * 3. PHI redaction (removes DOB when full name + DOB are both present)
 *
 * Returns a ComplianceResult describing what action was taken.
 */
export function validate(response: string, session: CallSession): ComplianceResult {
  const originalResponse = response;
  let currentResponse = response;
  let action: ComplianceResult["action"] = "pass";
  let reason = "";

  // Rule 1 — Disclosure injection
  if (session.turnCount === 0 && !session.disclosureDelivered) {
    currentResponse = HIPAA_DISCLOSURE + currentResponse;
    session.disclosureDelivered = true;
    action = "modify";
    reason = "Mandatory HIPAA disclosure prepended";
  }

  // Rule 2 — Medical advice detection (case-insensitive)
  const lowerResponse = currentResponse.toLowerCase();
  for (const keyword of MEDICAL_ADVICE_KEYWORDS) {
    if (lowerResponse.includes(keyword.toLowerCase())) {
      return {
        approved: false,
        originalResponse,
        finalResponse: TRANSFER_MESSAGE,
        action: "block_and_transfer",
        reason: `Medical advice detected: ${keyword}`,
      };
    }
  }

  // Rule 3 — PHI redaction
  if (session.patientContext) {
    const { fullName, dob } = session.patientContext;
    const responseContainsFullName = currentResponse
      .toLowerCase()
      .includes(fullName.toLowerCase());
    const responseContainsDob = currentResponse.includes(dob);

    if (responseContainsFullName && responseContainsDob) {
      // Remove all occurrences of the DOB string
      currentResponse = currentResponse.split(dob).join("");
      action = "modify";
      reason = reason
        ? `${reason}; Unnecessary PHI repetition redacted`
        : "Unnecessary PHI repetition redacted";
    }
  }

  return {
    approved: true,
    originalResponse,
    finalResponse: currentResponse,
    action,
    reason: reason || "Response passed compliance checks",
  };
}
