# Implementation Plan: Custom LLM Server

## Overview

Build a Node.js/TypeScript WebSocket server implementing the Retell AI Custom LLM protocol with HIPAA compliance enforcement. The implementation follows an incremental approach: project setup → types and constants → core modules (session, EHR, compliance, audit) → LLM integration → WebSocket handling and wiring → testing.

## Tasks

- [x] 1. Set up project structure and configuration
  - [x] 1.1 Initialize the TypeScript/Node.js project
    - Create `server/package.json` with name, scripts (`dev`: `tsx src/server.ts`, `test`: `vitest --run`, `test:watch`: `vitest`), and runtime dependencies (`ws`, `express`, `openai`)
    - Add dev dependencies: `tsx`, `typescript`, `@types/ws`, `@types/express`, `vitest`, `fast-check`
    - Create `server/tsconfig.json` targeting ES2022, module NodeNext, moduleResolution NodeNext, strict mode enabled
    - Create `server/src/` directory structure
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 1.2 Define TypeScript interfaces and types
    - Create `server/src/types.ts` with interfaces for: `TranscriptEntry`, `BaseRetellEvent`, `ResponseRequiredEvent`, `ReminderRequiredEvent`, `UpdateOnlyEvent`, `PingPongEvent`, `RetellEvent` union type
    - Define outgoing event interfaces: `ResponseEvent`, `PingPongResponse`, `ToolCallInvocationEvent`, `ToolCallResultEvent`
    - Define internal model interfaces: `PatientRecord`, `AppointmentSlot`, `BookingResult`, `PatientContext`, `AuditEntry`, `CallSummaryEntry`, `ToolCallRecord`
    - Define `ComplianceResult` interface with fields: `approved`, `originalResponse`, `finalResponse`, `action`, `reason`
    - Define `LlmResult` interface with fields: `content`, `toolCallsMade`
    - _Requirements: 16.1, 16.2, 16.3, 16.4_

  - [x] 1.3 Create constants and prompts module
    - Create `server/src/constants.ts` exporting `SYSTEM_PROMPT` (patient intake assistant for Valley Health Clinic with function references to lookup_patient, get_available_slots, book_appointment, transfer_to_nurse)
    - Export `HIPAA_DISCLOSURE` constant (AI interaction disclosure, recording notice, transfer policy)
    - Export `TRANSFER_MESSAGE` constant (nursing staff connection message)
    - Export `MEDICAL_ADVICE_KEYWORDS` array: "diagnosis", "prescribe", "medication", "treatment", "you should take", "it could be", "sounds like you have", "try taking", "symptoms suggest"
    - Export `REMINDER_MESSAGE` constant for gentle reminders
    - _Requirements: 15.1, 15.2, 15.3, 15.4_

- [x] 2. Implement core modules
  - [x] 2.1 Implement CallSession module
    - Create `server/src/call-session.ts` implementing the `CallSession` class
    - Initialize with `callId`, `turnCount: 0`, `disclosureDelivered: false`, empty `transcript` array, `patientContext: null`, `startTime: new Date()`
    - Implement `updateTranscript(entries)` to append entries to the transcript array
    - Implement `incrementTurn()` to increment `turnCount` by 1
    - Implement `setPatientContext(patient)` to store patient name, DOB, and ID
    - Implement `end()` to record `endTime` and calculate duration
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 17.3_

  - [ ]* 2.2 Write property test for CallSession state accumulation
    - **Property 13: Session state accumulation across turns**
    - Use `fast-check` to generate arbitrary sequences of transcript entries and turn increments
    - Verify that all entries are retained in order, turnCount equals number of increments, and patient context persists until `end()` is called
    - **Validates: Requirements 4.3, 4.4, 17.3, 17.4**

  - [x] 2.3 Implement Mock EHR module
    - Create `server/src/mock-ehr.ts` with in-memory patient records: Maria Garcia (P001, DOB 1985-03-15, next appt 2026-07-15T10:00), James Wilson (P002, DOB 1972-11-02, no appt), Sarah Chen (P003, DOB 1990-07-22, next appt 2026-07-12T14:30)
    - Store 5 available appointment slots: 2026-07-14T09:00, 2026-07-14T11:00, 2026-07-15T14:00, 2026-07-16T10:00, 2026-07-16T15:30
    - Implement `lookupPatient(name, dob)` with case-insensitive name matching, return patient record or null
    - Implement `getAvailableSlots()` returning all current available slots
    - Implement `bookAppointment(patientId, slotTime)` that removes slot from available, updates patient record, or returns error for invalid ID/slot
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 14.1, 14.2, 14.3, 14.4_

  - [ ]* 2.4 Write property tests for Mock EHR
    - **Property 9: Non-matching patient lookup returns null** — generate random name/DOB pairs avoiding the 3 known patients, verify `lookupPatient` returns null
    - **Property 10: Case-insensitive patient name matching** — use known patient names with random casing transformations, verify lookup succeeds with correct DOB
    - **Property 11: Booking removes slot and updates patient** — pick from available slots and valid patient IDs, verify slot removed and patient updated
    - **Property 12: Invalid booking returns error** — generate invalid patient IDs or unavailable slot times, verify `success: false` with non-empty message
    - **Validates: Requirements 13.3, 13.4, 14.3, 14.4**

  - [x] 2.5 Implement Compliance Validator module
    - Create `server/src/compliance-validator.ts` implementing the `validate(response, session)` function
    - Rule 1 — Disclosure injection: if `turnCount === 0 && !disclosureDelivered`, prepend `HIPAA_DISCLOSURE` to response, set `disclosureDelivered = true`, action `"modify"`
    - Rule 2 — Medical advice detection: case-insensitive check against `MEDICAL_ADVICE_KEYWORDS`, if found replace response with `TRANSFER_MESSAGE`, action `"block_and_transfer"`, short-circuit (skip rule 3)
    - Rule 3 — PHI redaction: if `patientContext` exists and response contains both full name and DOB, remove DOB from response, preserve first name, action `"modify"`
    - If no rule fires, return action `"pass"` with `approved: true`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 8.3, 9.1, 9.2, 9.3, 9.4, 10.1, 10.2, 10.3_

  - [ ]* 2.6 Write property tests for Compliance Validator
    - **Property 1: Disclosure injection on first turn** — generate arbitrary response strings with session at turn 0, verify finalResponse starts with HIPAA_DISCLOSURE and action is "modify"
    - **Property 2: No disclosure after first turn** — generate response strings with turnCount > 0, verify finalResponse does NOT start with disclosure
    - **Property 3: Medical advice keyword detection and blocking** — inject random keyword from list in random case into response, verify action is "block_and_transfer" and finalResponse equals TRANSFER_MESSAGE
    - **Property 4: PHI redaction removes DOB but preserves first name** — generate responses containing full name + DOB with patient context set, verify DOB removed and first name preserved
    - **Property 5: Medical advice blocking short-circuits subsequent rules** — response with keyword AND PHI present, verify action is "block_and_transfer" and PHI redaction not applied
    - **Property 6: Disclosure rule chains with subsequent rules** — turn 0 response with PHI, verify disclosure prepended AND DOB removed
    - **Validates: Requirements 7.1-7.4, 8.1-8.3, 9.1-9.4, 10.1-10.3**

  - [x] 2.7 Implement Audit Logger module
    - Create `server/src/audit-logger.ts` implementing `logTurn(entry: AuditEntry)` that writes a single-line JSON to stdout
    - Implement `logCallSummary(session: CallSession)` that writes a summary entry with callId, totalTurns, durationMs, and event "call_ended"
    - Ensure each entry is newline-delimited JSON (NDJSON format)
    - All entries include ISO 8601 timestamps
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [ ]* 2.8 Write property test for Audit Logger
    - **Property 8: Audit entry completeness and NDJSON format** — generate arbitrary AuditEntry records (including strings with newlines, quotes, special characters), verify output is single-line valid JSON with all required fields
    - **Validates: Requirements 12.2, 12.4**

- [x] 3. Checkpoint - Core modules verification
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement LLM integration and WebSocket handling
  - [x] 4.1 Implement LLM Client module
    - Create `server/src/llm-client.ts` wrapping the OpenAI SDK
    - Implement `generateResponse(session: CallSession)` that sends system prompt + full transcript to GPT-4.1-mini (model configurable via `OPENAI_MODEL` env var, default `gpt-4.1-mini`)
    - Handle OpenAI function calling (tools): define `lookup_patient`, `get_available_slots`, `book_appointment`, `transfer_to_nurse` as tool definitions
    - When tool_calls are returned, execute them against Mock EHR, append results to conversation, and make follow-up API call until no more tool_calls
    - On API failure: catch error, return graceful error message for the caller
    - When `lookup_patient` succeeds, call `session.setPatientContext()` with the patient data
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 17.1, 17.2_

  - [x] 4.2 Implement WebSocket handler and event router
    - Create `server/src/websocket-handler.ts` that upgrades HTTP connections on `/llm-websocket/:call_id` to WebSocket
    - On connection: extract `call_id` from URL path, create new `CallSession`
    - On message: parse JSON, route by `interaction_type`
    - `response_required`: update transcript, increment turn, generate LLM response, run compliance validation, send response event, log audit entry
    - `reminder_required`: send `REMINDER_MESSAGE` as response event
    - `update_only`: update session transcript only
    - `ping_pong`: echo back with matching timestamp
    - Unrecognized `interaction_type`: log warning, take no action
    - On close: call `session.end()`, log call summary
    - Handle malformed JSON: log warning, ignore message
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 5.1, 5.2, 5.3, 5.4, 11.1, 11.2, 11.3, 11.4, 17.4_

  - [ ]* 4.3 Write property test for Response Event wire format
    - **Property 7: Response event wire format** — generate random valid ComplianceResults, verify outgoing JSON contains exactly: response_type "response", response_id (number), content (string), content_complete (boolean), end_call (boolean)
    - **Validates: Requirements 11.1**

  - [ ]* 4.4 Write unit tests for event routing and integration
    - Test event routing dispatches to correct handler for each interaction_type (5.1-5.4)
    - Test health check endpoint returns 200 with correct JSON body (2.2-2.3)
    - Test full WebSocket flow: connect → send response_required → receive validated response
    - Test OpenAI failure path: mock SDK to throw, verify graceful degradation
    - Test multi-turn conversation: verify state accumulates correctly
    - _Requirements: 2.2, 2.3, 5.1, 5.2, 5.3, 5.4_

- [x] 5. Wire everything together in the server entry point
  - [x] 5.1 Create the main server entry point
    - Create `server/src/server.ts` that creates Express app, mounts GET `/` health check returning `{ status: "healthy", timestamp: string }`
    - Create HTTP server from Express app
    - Attach WebSocket server (from `websocket-handler.ts`) to the HTTP server
    - Start listening on port 8080
    - Log startup message to stdout
    - _Requirements: 1.5, 2.1, 2.2, 2.3, 3.1_

  - [x] 5.2 Add environment configuration
    - Update the root `.env.local.example` to add `OPENAI_API_KEY` and `OPENAI_MODEL=gpt-4.1-mini` entries (below the existing `AWS_PROFILE`)
    - Document in a `server/README.md`: setup instructions, how to run with `npm run dev`, note that env vars are loaded via direnv from `.env.local`, ngrok usage for exposing to Retell
    - _Requirements: 1.4, 1.5, 6.5_

- [x] 6. Final checkpoint - Full integration verification
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The server runs locally and is exposed to Retell via ngrok for the demo
- GPT-4.1-mini is the default model for lower latency in voice applications

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "2.3", "2.7"] },
    { "id": 3, "tasks": ["2.2", "2.4", "2.5", "2.8"] },
    { "id": 4, "tasks": ["2.6"] },
    { "id": 5, "tasks": ["4.1"] },
    { "id": 6, "tasks": ["4.2"] },
    { "id": 7, "tasks": ["4.3", "4.4"] },
    { "id": 8, "tasks": ["5.1", "5.2"] }
  ]
}
```
