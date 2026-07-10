import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import { CallSession } from "./call-session.js";
import { generateResponse } from "./llm-client.js";
import { validate } from "./compliance-validator.js";
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

    // Send the begin message immediately — Retell expects the server to
    // proactively send the first response when the WebSocket connects.
    // This delivers the HIPAA disclosure + greeting without waiting for user input.
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
 * Updates transcript, increments turn, generates LLM response,
 * runs compliance validation, sends response, and logs the audit entry.
 */
async function handleResponseRequired(
  ws: WebSocket,
  session: CallSession,
  event: ResponseRequiredEvent
): Promise<void> {
  session.updateTranscript(event.transcript);

  const llmResult = await generateResponse(session);
  const complianceResult = validate(llmResult.content, session);

  session.incrementTurn();

  const responseEvent = {
    response_type: "response" as const,
    response_id: event.response_id,
    content: complianceResult.finalResponse,
    content_complete: true,
    end_call: complianceResult.action === "block_and_transfer",
  };

  ws.send(JSON.stringify(responseEvent));

  // Determine the last user message from transcript for the audit entry
  const lastUserMessage =
    event.transcript
      .filter((entry) => entry.role === "user")
      .pop()?.content ?? "";

  const auditEntry: AuditEntry = {
    timestamp: new Date().toISOString(),
    callId: session.callId,
    turnNumber: session.turnCount,
    transcriptIn: lastUserMessage,
    rawLlmResponse: llmResult.content,
    complianceAction: complianceResult.action,
    complianceReason: complianceResult.reason,
    finalResponseSpoken: complianceResult.finalResponse,
  };

  logTurn(auditEntry);
}

/**
 * Handles `reminder_required` events:
 * Sends REMINDER_MESSAGE as the response.
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
 * Handles `update_only` events:
 * Updates session transcript without generating a response.
 */
function handleUpdateOnly(session: CallSession, event: UpdateOnlyEvent): void {
  session.updateTranscript(event.transcript);
}

/**
 * Handles `ping_pong` events:
 * Echoes back with matching timestamp.
 */
function handlePingPong(ws: WebSocket, event: PingPongEvent): void {
  ws.send(JSON.stringify({ response_type: "ping_pong", timestamp: event.timestamp }));
}
