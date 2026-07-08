# Custom LLM Server for Retell AI

A Node.js/TypeScript WebSocket server implementing Retell AI's Custom LLM protocol for a HIPAA-compliant patient intake voice agent. The server bridges Retell's real-time voice platform and OpenAI GPT-4.1-mini, enforcing compliance rules (HIPAA disclosure, medical advice blocking, PHI redaction) on every response before it reaches the caller.

## Prerequisites

- Node.js 20+
- direnv (environment variables are loaded automatically from `.env.local`)

## Setup

1. From the project root, copy `.env.local.example` to `.env.local` and fill in your OpenAI API key:

   ```bash
   cp .env.local.example .env.local
   # Edit .env.local and set OPENAI_API_KEY=sk-your-key-here
   ```

2. Install dependencies:

   ```bash
   cd server && npm install
   ```

## Running

Start the development server (listens on port 8080):

```bash
npm run dev
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes | — | Your OpenAI API key |
| `OPENAI_MODEL` | No | `gpt-4.1-mini` | OpenAI model to use for completions |

Environment variables are loaded via direnv from the root `.env.local` file.

## Exposing to Retell via ngrok

Retell needs a publicly accessible WebSocket URL. Use ngrok to expose your local server:

```bash
ngrok http 8080
```

Copy the HTTPS forwarding URL (e.g., `https://abc123.ngrok-free.app`) and configure it in the Retell dashboard as your Custom LLM WebSocket URL:

```
wss://abc123.ngrok-free.app/llm-websocket/{call_id}
```

Replace `{call_id}` with the actual placeholder — Retell substitutes it automatically at call time.

## Testing

Run the test suite:

```bash
npm test
```
