import type { AuditEntry, CallSummaryEntry } from "./types.js";
import type { CallSession } from "./call-session.js";

/**
 * Writes an audit entry for a single turn as NDJSON to stdout.
 * Each entry is a single line of valid JSON followed by a newline.
 */
export function logTurn(entry: AuditEntry): void {
  process.stdout.write(JSON.stringify(entry) + "\n");
}

/**
 * Writes a call summary entry when a call ends as NDJSON to stdout.
 * Constructs a CallSummaryEntry from the session state.
 */
export function logCallSummary(session: CallSession): void {
  const summary: CallSummaryEntry = {
    timestamp: new Date().toISOString(),
    callId: session.callId,
    totalTurns: session.turnCount,
    durationMs: session.getDuration(),
    event: "call_ended",
  };
  process.stdout.write(JSON.stringify(summary) + "\n");
}
