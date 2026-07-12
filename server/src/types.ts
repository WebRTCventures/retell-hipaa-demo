// =============================================================================
// Retell Incoming Events
// =============================================================================

export interface TranscriptEntry {
  role: "agent" | "user";
  content: string;
}

export interface BaseRetellEvent {
  interaction_type: string;
}

export interface ResponseRequiredEvent extends BaseRetellEvent {
  interaction_type: "response_required";
  response_id: number;
  transcript: TranscriptEntry[];
}

export interface ReminderRequiredEvent extends BaseRetellEvent {
  interaction_type: "reminder_required";
  response_id: number;
  transcript: TranscriptEntry[];
}

export interface UpdateOnlyEvent extends BaseRetellEvent {
  interaction_type: "update_only";
  transcript: TranscriptEntry[];
}

export interface PingPongEvent extends BaseRetellEvent {
  interaction_type: "ping_pong";
  timestamp: number;
}

export type RetellEvent =
  | ResponseRequiredEvent
  | ReminderRequiredEvent
  | UpdateOnlyEvent
  | PingPongEvent;

// =============================================================================
// Retell Outgoing Events
// =============================================================================

export interface ResponseEvent {
  response_type: "response";
  response_id: number;
  content: string;
  content_complete: boolean;
  end_call?: boolean;
}

export interface PingPongResponse {
  response_type: "ping_pong";
  timestamp: number;
}

export interface ToolCallInvocationEvent {
  response_type: "tool_call_invocation";
  tool_call_id: string;
  name: string;
  arguments: string;
}

export interface ToolCallResultEvent {
  response_type: "tool_call_result";
  tool_call_id: string;
  content: string;
}

// =============================================================================
// Internal Models
// =============================================================================

export interface PatientRecord {
  id: string;
  name: string;
  dob: string; // ISO date: YYYY-MM-DD
  nextAppointment: string | null; // ISO datetime or null
}

export interface AppointmentSlot {
  time: string; // ISO datetime
  provider: string;
}

export interface BookingResult {
  success: boolean;
  message: string;
  appointment?: { patientId: string; time: string };
}

export interface PatientContext {
  fullName: string;
  dob: string;
  patientId: string;
}

export interface AuditEntry {
  timestamp: string; // ISO 8601
  callId: string;
  turnNumber: number;
  transcriptIn: string;
  rawLlmResponse: string;
  complianceAction: "pass" | "modify";
  complianceReason: string;
  finalResponseSpoken: string;
}

export interface CallSummaryEntry {
  timestamp: string;
  callId: string;
  totalTurns: number;
  durationMs: number;
  event: "call_ended";
}

export interface ToolCallRecord {
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
}

// =============================================================================
// Compliance
// =============================================================================

export interface ComplianceResult {
  approved: boolean;
  originalResponse: string;
  finalResponse: string;
  action: "pass" | "modify";
  reason: string;
}

// =============================================================================
// LLM
// =============================================================================

export interface LlmResult {
  content: string;
  toolCallsMade: ToolCallRecord[];
}
