import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import { CallSession } from "./call-session.js";
import { generateResponse } from "./llm-client.js";
import { validate, redactSentence } from "./compliance-validator.js";
import { logTurn, logCallSummary } from "./audit-logger.js";
import { REMINDER_MESSAGE, HIPAA_DISCLOSURE } from "./constants.js";
import type {
  RetellEvent,
  ResponseRequiredEvent,
  ReminderRequiredEvent,
  UpdateOnlyEvent,
  PingPongEvent,
  AuditEntry,
} from "./types.js";

/**
 * Attaches a WebSocket server to the given HTTP server.
 * Handles upgrade requests on `/llm-websocket/:call_id` and routes
 * incoming Retell events to the appropriate handlers.
 */
export function attachWebSocketServer(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request: IncomingMessage, socket, head) => {
    const url = request.url ?? "";
    const match = url.match(/^\/llm-websocket\/([^/?]+)/);

    if (!match) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws: WebSocket, request: IncomingMessage) => {
    const url = request.url ?? "";
    const match = url.match(/^\/llm-websocket\/([^/?]+)/);
    const callId = match ? match[1] : "unknown";

    const session = new CallSession(callId);

    // Send the begin message immediately — delivers HIPAA disclosure + greeting
    const beginMessage = {
      response_type: "response" as const,
      response_id: 0,
      content: HIPAA_DISCLOSURE + "How can I help you today?",
      content_complete: true,
      end_call: false,
    };
    ws.send(JSON.stringify(beginMessage));
    session.disclosureDelivered = true;
    session.incrementTurn();

    logTurn({
      timestamp: new Date().toISOString(),
      callId: session.callId,
      turnNumber: session.turnCount,
      transcriptIn: "",
      rawLlmResponse: "How can I help you today?",
      complianceAction: "modify",
      complianceReason: "Mandatory HIPAA disclosure prepended (begin message)",
      finalResponseSpoken: beginMessage.content,
    });

    ws.on("message", (data) => {
      handleMessage(ws, session, data).catch((err) => {
        console.error(`[${session.callId}] Error handling message:`, err);
      });
    });

    ws.on("close", () => {
      session.end();
      logCallSummary(session);
    });

    ws.on("error", (err) => {
      console.error(`[${session.callId}] WebSocket error:`, err);
      session.end();
      logCallSummary(session);
    });
  });

  return wss;
}

/**
 * Parses an incoming WebSocket message and routes it by interaction_type.
 */
async function handleMessage(
  ws: WebSocket,
  session: CallSession,
  data: unknown
): Promise<void> {
  let event: RetellEvent;

  try {
    const raw = typeof data === "string" ? data : (data as Buffer).toString("utf-8");
    event = JSON.parse(raw) as RetellEvent;
  } catch {
    console.warn(`[${session.callId}] Malformed JSON received, ignoring message`);
    return;
  }

  switch (event.interaction_type) {
    case "response_required":
      await handleResponseRequired(ws, session, event as ResponseRequiredEvent);
      break;
    case "reminder_required":
      handleReminderRequired(ws, event as ReminderRequiredEvent);
      break;
    case "update_only":
      handleUpdateOnly(session, event as UpdateOnlyEvent);
      break;
    case "ping_pong":
      handlePingPong(ws, event as PingPongEvent);
      break;
    default:
      console.warn(
        `[${session.callId}] Unrecognized interaction_type: ${(event as { interaction_type: string }).interaction_type}`
      );
      break;
  }
}

/**
 * Handles `response_required` events:
 * Generates the LLM response, streams it sentence-by-sentence to Retell
 * with per-sentence PHI redaction, then logs the complete turn.
 */
async function handleResponseRequired(
  ws: WebSocket,
  session: CallSession,
  event: ResponseRequiredEvent
): Promise<void> {
  session.updateTranscript(event.transcript);

  // Generate the full response (includes function calling loop)
  const llmResult = await generateResponse(session);

  // Split into sentences for streaming with per-sentence PHI redaction
  const sentences = llmResult.content.split(/(?<=[.!?])\s+/).filter(Boolean);
  const spokenSentences: string[] = [];

  for (let i = 0; i < sentences.length; i++) {
    const { output } = redactSentence(sentences[i], session);
    spokenSentences.push(output);

    const isLast = i === sentences.length - 1;

    const responseEvent = {
      response_type: "response" as const,
      response_id: event.response_id,
      content: output,
      content_complete: isLast,
      end_call: false,
    };

    ws.send(JSON.stringify(responseEvent));
  }

  session.incrementTurn();

  // Log the complete turn after all sentences have been streamed
  const lastUserMessage =
    event.transcript
      .filter((entry) => entry.role === "user")
      .pop()?.content ?? "";

  const finalResponseSpoken = spokenSentences.join(" ");
  const wasRedacted = finalResponseSpoken !== llmResult.content;

  const auditEntry: AuditEntry = {
    timestamp: new Date().toISOString(),
    callId: session.callId,
    turnNumber: session.turnCount,
    transcriptIn: lastUserMessage,
    rawLlmResponse: llmResult.content,
    complianceAction: wasRedacted ? "modify" : "pass",
    complianceReason: wasRedacted
      ? "Unnecessary PHI repetition redacted"
      : "Response passed compliance checks",
    finalResponseSpoken,
  };

  logTurn(auditEntry);
}

/**
 * Handles `reminder_required` events.
 */
function handleReminderRequired(
  ws: WebSocket,
  event: ReminderRequiredEvent
): void {
  const responseEvent = {
    response_type: "response" as const,
    response_id: event.response_id,
    content: REMINDER_MESSAGE,
    content_complete: true,
    end_call: false,
  };
  ws.send(JSON.stringify(responseEvent));
}

/**
 * Handles `update_only` events.
 */
function handleUpdateOnly(session: CallSession, event: UpdateOnlyEvent): void {
  session.updateTranscript(event.transcript);
}

/**
 * Handles `ping_pong` events.
 */
function handlePingPong(ws: WebSocket, event: PingPongEvent): void {
  ws.send(JSON.stringify({ response_type: "ping_pong", timestamp: event.timestamp }));
}
