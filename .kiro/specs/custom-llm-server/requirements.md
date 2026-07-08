# Requirements Document

## Introduction

This feature implements a Node.js/TypeScript WebSocket server that handles Retell AI's Custom LLM protocol for a HIPAA-compliant patient intake voice agent. The server receives live transcripts from Retell, generates responses via OpenAI GPT-4.1-mini (chosen for lower latency in voice applications — ~0.82s TTFT vs ~1.0s for GPT-4.1 full), enforces three HIPAA compliance rules (disclosure injection, medical advice blocking, PHI redaction) before any response is spoken, and produces structured audit logs for every turn. The server includes a mock EHR system for patient lookup and appointment scheduling, and runs locally exposed via ngrok for the demo.

## Glossary

- **Custom_LLM_Server**: The Node.js/TypeScript WebSocket server that handles the Retell Custom LLM protocol, running on localhost port 8080
- **Retell_Platform**: The Retell AI cloud service that connects phone calls to the Custom_LLM_Server via WebSocket, sending transcripts and receiving responses
- **CallSession**: An in-memory object tracking state for a single phone call, including callId, turnCount, disclosureDelivered flag, transcript history, patient context, and startTime
- **Compliance_Validator**: The module that checks every LLM-generated response against three HIPAA rules before the response is sent back to Retell_Platform
- **ComplianceResult**: A structured object returned by Compliance_Validator containing: approved (boolean), originalResponse, finalResponse, action (pass | modify | block_and_transfer), and reason
- **Audit_Logger**: The module that writes structured JSON entries to stdout for every turn processed by the Custom_LLM_Server
- **AuditEntry**: A structured JSON object containing: timestamp, callId, turnNumber, transcriptIn, rawLlmResponse, complianceAction, complianceReason, and finalResponseSpoken
- **Mock_EHR**: An in-memory mock Electronic Health Records system containing 3 patient records and 5 available appointment slots
- **HIPAA_Disclosure**: A mandatory opening statement informing the caller they are speaking with an AI assistant, that the call may be recorded, and that medical concerns will be transferred to clinical staff
- **Transfer_Message**: A scripted response used when the Compliance_Validator blocks a response containing medical advice, informing the caller they will be connected with nursing staff
- **Medical_Advice_Keywords**: The list of keywords used to detect medical advice in responses: "diagnosis", "prescribe", "medication", "treatment", "you should take", "it could be", "sounds like you have", "try taking", "symptoms suggest"
- **PHI_Redaction**: The process of removing unnecessary repetition of a patient's full name combined with date of birth from LLM-generated responses
- **Response_Event**: The JSON message sent from Custom_LLM_Server back to Retell_Platform containing response_id, content, content_complete, and end_call fields

## Requirements

### Requirement 1: Project Setup and Configuration

**User Story:** As a developer, I want a properly configured TypeScript/Node.js project with all necessary dependencies, so that I can run the Custom LLM Server with a single command.

#### Acceptance Criteria

1. THE Custom_LLM_Server SHALL use TypeScript with a tsconfig.json targeting ES2022 and module NodeNext
2. THE Custom_LLM_Server SHALL declare runtime dependencies: ws, express, and openai in package.json
3. THE Custom_LLM_Server SHALL declare dev dependencies: tsx, typescript, @types/ws, and @types/express in package.json
4. THE Custom_LLM_Server SHALL provide a "dev" script in package.json that starts the server using tsx
5. WHEN `npm run dev` is executed, THE Custom_LLM_Server SHALL start and listen on port 8080 without errors

### Requirement 2: HTTP Health Check Endpoint

**User Story:** As a developer, I want a health check endpoint on the server, so that I can verify the server is running and reachable through ngrok.

#### Acceptance Criteria

1. THE Custom_LLM_Server SHALL expose an Express HTTP server on port 8080
2. WHEN a GET request is received on the root path "/", THE Custom_LLM_Server SHALL respond with HTTP status 200
3. WHEN a GET request is received on the root path "/", THE Custom_LLM_Server SHALL return a JSON body indicating the server is healthy

### Requirement 3: WebSocket Connection Handling

**User Story:** As a developer, I want the server to accept WebSocket connections on the correct path, so that Retell can connect when a call starts.

#### Acceptance Criteria

1. THE Custom_LLM_Server SHALL accept WebSocket connections on the "/llm-websocket" path
2. WHEN Retell_Platform opens a WebSocket connection, THE Custom_LLM_Server SHALL create a new CallSession instance for that connection
3. WHEN a WebSocket connection is closed, THE Custom_LLM_Server SHALL invoke the CallSession end method and log a call summary via Audit_Logger
4. THE Custom_LLM_Server SHALL handle one CallSession per WebSocket connection independently

### Requirement 4: CallSession State Management

**User Story:** As a developer, I want each call to have its own session tracking state, so that compliance rules and audit logging operate correctly across multiple turns.

#### Acceptance Criteria

1. THE CallSession SHALL track: callId, turnCount, disclosureDelivered flag, transcript array, patient context, and startTime
2. WHEN a new CallSession is created, THE CallSession SHALL initialize turnCount to 0 and disclosureDelivered to false
3. WHEN updateTranscript is called, THE CallSession SHALL append the new transcript entries to the transcript array
4. WHEN incrementTurn is called, THE CallSession SHALL increment turnCount by 1
5. WHEN end is called, THE CallSession SHALL record the end time for duration calculation

### Requirement 5: Retell Event Parsing and Routing

**User Story:** As a developer, I want the server to correctly parse and route incoming Retell WebSocket events, so that each event type triggers the appropriate handler logic.

#### Acceptance Criteria

1. WHEN a message with interaction_type "response_required" is received, THE Custom_LLM_Server SHALL invoke the response generation and compliance validation pipeline
2. WHEN a message with interaction_type "reminder_required" is received, THE Custom_LLM_Server SHALL send a gentle reminder response back to Retell_Platform
3. WHEN a message with interaction_type "update_only" is received, THE Custom_LLM_Server SHALL update the CallSession transcript without generating a response
4. IF a message with an unrecognized interaction_type is received, THEN THE Custom_LLM_Server SHALL log a warning and take no further action

### Requirement 6: LLM Response Generation

**User Story:** As a developer, I want the server to generate responses using OpenAI GPT-4.1, so that the voice agent can have natural conversations with patients.

#### Acceptance Criteria

1. WHEN a response is required, THE Custom_LLM_Server SHALL send the system prompt and full transcript to the OpenAI GPT-4.1-mini API
2. THE Custom_LLM_Server SHALL wait for the complete response from OpenAI before passing it to Compliance_Validator
3. IF the OpenAI API call fails, THEN THE Custom_LLM_Server SHALL return a graceful error message to the caller and log the error via Audit_Logger
4. THE Custom_LLM_Server SHALL include the system prompt defining the agent as a patient intake assistant for Valley Health Clinic with access to lookup_patient, get_available_slots, book_appointment, and transfer_to_nurse functions
5. THE Custom_LLM_Server SHALL use GPT-4.1-mini (model identifier: gpt-4.1-mini) as the default model for lower latency, with the model name configurable via environment variable

### Requirement 7: HIPAA Disclosure Injection

**User Story:** As a compliance officer, I want every call to begin with a mandatory HIPAA disclosure, so that callers are informed they are speaking with an AI and that the call may be recorded.

#### Acceptance Criteria

1. WHEN turnCount is 0 and disclosureDelivered is false, THE Compliance_Validator SHALL prepend the HIPAA_Disclosure text to the LLM-generated response
2. WHEN the disclosure is prepended, THE Compliance_Validator SHALL set disclosureDelivered to true on the CallSession
3. WHEN the disclosure is prepended, THE Compliance_Validator SHALL return a ComplianceResult with action "modify" and reason indicating the mandatory disclosure was prepended
4. WHEN turnCount is greater than 0, THE Compliance_Validator SHALL not prepend the disclosure to the response

### Requirement 8: Medical Advice Detection and Blocking

**User Story:** As a compliance officer, I want responses containing medical advice to be blocked and the call transferred to clinical staff, so that the AI agent never provides diagnoses or treatment suggestions.

#### Acceptance Criteria

1. THE Compliance_Validator SHALL check every LLM-generated response against the Medical_Advice_Keywords list using case-insensitive matching
2. WHEN a response contains any of the Medical_Advice_Keywords, THE Compliance_Validator SHALL block the response and substitute the Transfer_Message
3. WHEN a response is blocked for medical advice, THE Compliance_Validator SHALL return a ComplianceResult with action "block_and_transfer" and a reason indicating medical advice was detected
4. WHEN a response is blocked for medical advice, THE Custom_LLM_Server SHALL include end_call set to true or trigger a transfer in the Response_Event sent to Retell_Platform

### Requirement 9: PHI Redaction

**User Story:** As a compliance officer, I want unnecessary repetition of patient name and date of birth to be stripped from responses, so that PHI is not unnecessarily spoken aloud during the call.

#### Acceptance Criteria

1. WHEN the CallSession has patient context containing full name and date of birth, THE Compliance_Validator SHALL check if the response contains both the full name and date of birth together
2. WHEN the response contains the patient's full name and date of birth repeated together, THE Compliance_Validator SHALL remove the date of birth from the response using string replacement
3. WHEN PHI is redacted, THE Compliance_Validator SHALL return a ComplianceResult with action "modify" and reason indicating unnecessary PHI repetition was redacted
4. THE Compliance_Validator SHALL preserve the patient's first name in the response for natural conversation flow

### Requirement 10: Compliance Rule Priority and Ordering

**User Story:** As a developer, I want compliance rules applied in a defined order, so that rule interactions are predictable and the most critical rules take precedence.

#### Acceptance Criteria

1. THE Compliance_Validator SHALL apply rules in this order: (1) disclosure injection, (2) medical advice detection, (3) PHI redaction
2. WHEN the medical advice rule blocks a response, THE Compliance_Validator SHALL skip subsequent rules and return the Transfer_Message immediately
3. WHEN the disclosure rule modifies a response, THE Compliance_Validator SHALL continue to apply remaining rules to the modified response

### Requirement 11: Response Format to Retell

**User Story:** As a developer, I want the server to send responses in the correct format expected by Retell, so that the voice agent speaks the validated response to the caller.

#### Acceptance Criteria

1. THE Custom_LLM_Server SHALL send Response_Events as JSON containing: response_id (number), content (string), content_complete (boolean), and end_call (boolean)
2. WHEN a validated response is ready, THE Custom_LLM_Server SHALL send the Response_Event with content_complete set to true
3. WHEN a response is blocked and transfer is required, THE Custom_LLM_Server SHALL send the Response_Event with end_call set to true
4. WHEN a normal response passes compliance, THE Custom_LLM_Server SHALL send the Response_Event with end_call set to false

### Requirement 12: Audit Logging Per Turn

**User Story:** As a compliance officer, I want every turn of every call logged as structured JSON, so that there is a complete audit trail of all AI interactions and compliance decisions.

#### Acceptance Criteria

1. WHEN a response_required event is processed, THE Audit_Logger SHALL write a structured JSON AuditEntry to stdout
2. THE AuditEntry SHALL contain: timestamp (ISO 8601), callId, turnNumber, transcriptIn (patient utterance), rawLlmResponse (LLM output before compliance), complianceAction, complianceReason, and finalResponseSpoken
3. WHEN a call ends, THE Audit_Logger SHALL write a summary log entry containing callId, total turn count, and call duration
4. THE Audit_Logger SHALL output each AuditEntry as a single line of JSON (newline-delimited JSON format)

### Requirement 13: Mock EHR Patient Lookup

**User Story:** As a developer, I want a mock EHR system with patient records, so that the voice agent can verify patient identity and look up appointment information.

#### Acceptance Criteria

1. THE Mock_EHR SHALL store 3 patient records: Maria Garcia (P001, DOB 1985-03-15, next appointment 2026-07-15T10:00), James Wilson (P002, DOB 1972-11-02, no appointment), and Sarah Chen (P003, DOB 1990-07-22, next appointment 2026-07-12T14:30)
2. WHEN lookupPatient is called with a matching name and date of birth, THE Mock_EHR SHALL return the corresponding patient record
3. WHEN lookupPatient is called with a non-matching name or date of birth, THE Mock_EHR SHALL return null
4. THE Mock_EHR SHALL perform case-insensitive name matching for patient lookups

### Requirement 14: Mock EHR Appointment Scheduling

**User Story:** As a developer, I want the mock EHR to support appointment slot queries and booking, so that the voice agent can help patients schedule appointments.

#### Acceptance Criteria

1. THE Mock_EHR SHALL maintain 5 available appointment slots: 2026-07-14T09:00, 2026-07-14T11:00, 2026-07-15T14:00, 2026-07-16T10:00, and 2026-07-16T15:30
2. WHEN getAvailableSlots is called, THE Mock_EHR SHALL return all currently available slots
3. WHEN bookAppointment is called with a valid patientId and an available slot, THE Mock_EHR SHALL remove the slot from available slots and update the patient record
4. WHEN bookAppointment is called with an invalid patientId or unavailable slot, THE Mock_EHR SHALL return an error result indicating the failure reason

### Requirement 15: System Prompt and Constants

**User Story:** As a developer, I want all prompt text and disclosure constants defined in a single module, so that they are easy to maintain and audit.

#### Acceptance Criteria

1. THE Custom_LLM_Server SHALL define a SYSTEM_PROMPT constant that instructs the agent to act as a patient intake assistant for Valley Health Clinic
2. THE Custom_LLM_Server SHALL define a HIPAA_DISCLOSURE constant that informs the caller about AI interaction, recording, and transfer policy
3. THE Custom_LLM_Server SHALL define a TRANSFER_MESSAGE constant that informs the caller they are being connected with nursing staff
4. THE SYSTEM_PROMPT SHALL reference the available functions: lookup_patient, get_available_slots, book_appointment, and transfer_to_nurse

### Requirement 16: TypeScript Type Definitions

**User Story:** As a developer, I want TypeScript interfaces for all Retell WebSocket protocol messages, so that the codebase has strong typing and compile-time safety.

#### Acceptance Criteria

1. THE Custom_LLM_Server SHALL define TypeScript interfaces for incoming Retell events: response_required, reminder_required, update_only, and call_details
2. THE Custom_LLM_Server SHALL define TypeScript interfaces for outgoing events: response, tool_call_invocation, and tool_call_result
3. THE Custom_LLM_Server SHALL define a TypeScript interface for AuditEntry matching the structured JSON fields
4. THE Custom_LLM_Server SHALL define a TypeScript interface for ComplianceResult with fields: approved, originalResponse, finalResponse, action, and reason

### Requirement 17: Conversation Context Accumulation

**User Story:** As a developer, I want the server to accumulate conversation context across turns and pass it to the LLM, so that the voice agent maintains coherent multi-turn conversations and compliance checks have the context they need.

#### Acceptance Criteria

1. WHEN generating a response, THE Custom_LLM_Server SHALL pass the full accumulated transcript history from the CallSession to the OpenAI API as conversation context
2. WHEN a patient is successfully identified via Mock_EHR lookup, THE Custom_LLM_Server SHALL store the patient's name and date of birth in the CallSession patient context for use by subsequent Compliance_Validator checks
3. THE CallSession SHALL retain all accumulated state (transcript, patient context, turnCount, disclosureDelivered) until the WebSocket connection is closed
4. WHEN multiple response_required events arrive within the same CallSession, THE Custom_LLM_Server SHALL process each one using the latest accumulated state from all prior turns
