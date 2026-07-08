import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { CallSession } from "./call-session.js";
import { SYSTEM_PROMPT } from "./constants.js";
import { lookupPatient, getAvailableSlots, bookAppointment } from "./mock-ehr.js";
import type { LlmResult, ToolCallRecord } from "./types.js";

// =============================================================================
// OpenAI client (initialized lazily on first use)
// =============================================================================

const openai = new OpenAI();

const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

// =============================================================================
// Tool definitions for OpenAI function calling
// =============================================================================

const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "lookup_patient",
      description: "Look up a patient by name and date of birth to verify their identity.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The patient's full name" },
          dob: { type: "string", description: "The patient's date of birth in YYYY-MM-DD format" },
        },
        required: ["name", "dob"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function",
    function: {
      name: "get_available_slots",
      description: "Retrieve currently available appointment slots.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function",
    function: {
      name: "book_appointment",
      description: "Book an appointment for a verified patient at an available time slot.",
      parameters: {
        type: "object",
        properties: {
          patient_id: { type: "string", description: "The patient's unique identifier" },
          slot_time: { type: "string", description: "The appointment time in ISO format" },
        },
        required: ["patient_id", "slot_time"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
  {
    type: "function",
    function: {
      name: "transfer_to_nurse",
      description: "Transfer the caller to nursing staff for medical concerns.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "The reason for transferring to nursing staff" },
        },
        required: ["reason"],
        additionalProperties: false,
      },
      strict: true,
    },
  },
];

// =============================================================================
// Tool execution
// =============================================================================

function executeTool(
  name: string,
  args: Record<string, unknown>,
  session: CallSession
): unknown {
  switch (name) {
    case "lookup_patient": {
      const patient = lookupPatient(args.name as string, args.dob as string);
      if (patient) {
        session.setPatientContext(patient);
      }
      return patient ?? { error: "Patient not found" };
    }
    case "get_available_slots": {
      return getAvailableSlots();
    }
    case "book_appointment": {
      return bookAppointment(args.patient_id as string, args.slot_time as string);
    }
    case "transfer_to_nurse": {
      return { status: "transfer_initiated", reason: args.reason as string };
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// =============================================================================
// Main entry point
// =============================================================================

/**
 * Generate a response from the LLM for the current call session.
 * Handles tool calls in a loop until the model returns a final text response.
 */
export async function generateResponse(session: CallSession): Promise<LlmResult> {
  const toolCallsMade: ToolCallRecord[] = [];

  try {
    // Build initial messages from session transcript
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...session.transcript.map((entry) => ({
        role: (entry.role === "agent" ? "assistant" : "user") as "assistant" | "user",
        content: entry.content,
      })),
    ];

    // Loop: call OpenAI → execute tool calls → repeat until no more tool_calls
    while (true) {
      const response = await openai.chat.completions.create({
        model: MODEL,
        messages,
        tools,
      });

      const choice = response.choices[0];
      const message = choice.message;

      // If no tool calls, return the final content
      if (!message.tool_calls || message.tool_calls.length === 0) {
        return {
          content: message.content ?? "",
          toolCallsMade,
        };
      }

      // Append the assistant message with tool_calls to conversation
      messages.push({
        role: "assistant",
        content: message.content ?? null,
        tool_calls: message.tool_calls,
      } as ChatCompletionMessageParam);

      // Execute each tool call and append results
      for (const toolCall of message.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
        const result = executeTool(toolCall.function.name, args, session);

        // Track the tool call
        toolCallsMade.push({
          name: toolCall.function.name,
          arguments: args,
          result,
        });

        // Append tool result message
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
    }
  } catch (error) {
    // On any API or execution failure, return a graceful error message
    return {
      content:
        "I apologize, but I'm experiencing a technical issue. Please hold while I connect you with a staff member.",
      toolCallsMade,
    };
  }
}
