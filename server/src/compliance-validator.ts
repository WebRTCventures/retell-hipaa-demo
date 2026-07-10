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
  // If the response contains both the patient's full name AND date of birth,
  // remove the sentence containing the PHI and replace with a generic confirmation.
  if (session.patientContext) {
    const { fullName, dob } = session.patientContext;

    // Check for DOB in both ISO format and natural language variants
    const dobFormats = getDobFormats(dob);
    const matchedDob = dobFormats.find((format) =>
      currentResponse.toLowerCase().includes(format.toLowerCase())
    );
    const responseContainsFullName = currentResponse
      .toLowerCase()
      .includes(fullName.toLowerCase());

    if (responseContainsFullName && matchedDob) {
      // Split into sentences and remove any sentence containing both name and DOB
      const sentences = currentResponse.split(/(?<=[.!?])\s+/);
      const filtered = sentences.filter((sentence) => {
        const lower = sentence.toLowerCase();
        const hasDob = dobFormats.some((f) => lower.includes(f.toLowerCase()));
        const hasName = lower.includes(fullName.toLowerCase());
        return !(hasDob && hasName);
      });

      // Prepend a generic identity confirmation
      currentResponse = "I've verified your identity. " + filtered.join(" ");
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

/**
 * Generates multiple date format strings from an ISO date (YYYY-MM-DD)
 * to match how an LLM might naturally say a date in conversation.
 */
function getDobFormats(isoDob: string): string[] {
  const [year, month, day] = isoDob.split("-").map(Number);

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const monthName = monthNames[month - 1];

  return [
    isoDob, // 1985-03-15
    `${monthName} ${day}, ${year}`, // March 15, 1985
    `${monthName} ${day} ${year}`, // March 15 1985
    `${month}/${day}/${year}`, // 3/15/1985
    `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}/${year}`, // 03/15/1985
  ];
}
