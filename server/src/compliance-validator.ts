import type { ComplianceResult } from "./types.js";
import type { CallSession } from "./call-session.js";

/**
 * Checks a single sentence for unnecessary PHI repetition.
 * If the sentence contains both the patient's full name AND date of birth,
 * it's replaced with a generic identity confirmation.
 *
 * Returns the sentence unchanged if no PHI issue is found,
 * or a redacted version if both name + DOB are present.
 */
export function redactSentence(sentence: string, session: CallSession): {
  redacted: boolean;
  output: string;
} {
  if (!session.patientContext) {
    return { redacted: false, output: sentence };
  }

  const { fullName, dob } = session.patientContext;
  const lower = sentence.toLowerCase();

  const dobFormats = getDobFormats(dob);
  const hasDob = dobFormats.some((f) => lower.includes(f.toLowerCase()));
  const hasName = lower.includes(fullName.toLowerCase());

  if (hasName && hasDob) {
    return { redacted: true, output: "I've verified your identity." };
  }

  return { redacted: false, output: sentence };
}

/**
 * Validates a complete LLM response against compliance rules.
 * Used for audit logging after the full response has been streamed.
 *
 * Rules:
 * 1. PHI redaction — sentences containing both full name and DOB are replaced
 */
export function validate(response: string, session: CallSession): ComplianceResult {
  const originalResponse = response;

  if (!session.patientContext) {
    return {
      approved: true,
      originalResponse,
      finalResponse: response,
      action: "pass",
      reason: "Response passed compliance checks",
    };
  }

  const { fullName, dob } = session.patientContext;
  const dobFormats = getDobFormats(dob);
  const sentences = response.split(/(?<=[.!?])\s+/);
  let wasRedacted = false;

  const processed = sentences.map((sentence) => {
    const lower = sentence.toLowerCase();
    const hasDob = dobFormats.some((f) => lower.includes(f.toLowerCase()));
    const hasName = lower.includes(fullName.toLowerCase());

    if (hasName && hasDob) {
      wasRedacted = true;
      return "I've verified your identity.";
    }
    return sentence;
  });

  const finalResponse = processed.join(" ");

  return {
    approved: true,
    originalResponse,
    finalResponse,
    action: wasRedacted ? "modify" : "pass",
    reason: wasRedacted
      ? "Unnecessary PHI repetition redacted"
      : "Response passed compliance checks",
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
