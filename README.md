# Voice AI Patient Intake with HIPAA Safeguards — Retell AI + FreePBX Demo

A working demo of a voice AI agent handling patient intake calls with HIPAA compliance in mind. A patient calls in through FreePBX (on EC2), the call routes to Retell AI via SIP trunk, and a Custom LLM server streams responses sentence-by-sentence with per-sentence PHI redaction and structured audit logging.

The demo implements several layers toward that goal:

- **Sentence-level PHI redaction** — responses are streamed to Retell sentence-by-sentence; any sentence containing the patient's full name and date of birth together is replaced before it's spoken
- **Mandatory HIPAA disclosure** — delivered proactively on every call before the patient speaks
- **Scope control via system prompt** — the LLM is instructed to never provide medical advice and to use the `transfer_to_nurse` function for clinical questions
- **Per-turn audit trail** — structured NDJSON logging of every interaction (input, raw LLM output, compliance action taken, final spoken response) plus call-level summaries
- **Identity verification** — patient records are only accessible after name + date of birth verification via function calling
- **Network least-privilege** — Terraform security groups restrict SIP/RTP to Retell AI IP ranges and admin access (SSH, HTTPS) to a single operator IP
- **Encryption in transit** — all data paths encrypted: SIP signaling via TLS, voice media via SRTP (both softphone↔FreePBX and FreePBX↔Retell legs), WebSocket via TLS (ngrok tunnel), and OpenAI API calls over HTTPS

```
┌──────────────┐     SIP Trunk      ┌──────────────────┐
│   FreePBX    │ ──────────────────► │   Retell AI      │
│  (Asterisk)  │  sip.retellai.com   │   Platform       │
│   on EC2     │                     │                  │
└──────────────┘                     └────────┬─────────┘
                                              │
                                     WebSocket│
                                              │
                                     ┌────────┴─────────┐
                                     │   ngrok tunnel   │
                                     └────────┬─────────┘
                                              │
                                              ▼
                                     ┌──────────────────┐
                                     │  Custom LLM      │
                                     │  Server (Node.js)│
                                     │  localhost:8080   │
                                     └────────┬─────────┘
                                              │
                              ┌───────────────┼───────────────┐
                              ▼               ▼               ▼
                     ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
                     │  Compliance  │ │  Mock EHR    │ │  Audit       │
                     │  Validator   │ │  API         │ │  Logger      │
                     └──────────────┘ └──────────────┘ └──────────────┘
```

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| AWS account | With permissions to create VPC, EC2, EIP, security groups |
| Terraform 1.0+ | `terraform` CLI installed |
| AWS CLI | Configured with a named profile |
| Retell AI account | [retellai.com](https://www.retellai.com/) — Custom LLM agent |
| OpenAI API key | GPT-4.1-mini (or GPT-4.1) |
| Node.js 20+ | For the Custom LLM server |
| ngrok | Free tier works — [ngrok.com](https://ngrok.com) |
| Softphone | Zoiper, Linphone, or similar SIP client |
| SSH key pair | An existing AWS key pair in your target region |

---

## Project Structure

```
.
├── terraform/            # FreePBX infrastructure (EC2 + VPC + security groups)
│   ├── main.tf
│   ├── security.tf
│   ├── variables.tf
│   ├── outputs.tf
│   ├── data.tf
│   └── user_data.sh
├── server/               # Custom LLM WebSocket server
│   ├── src/
│   │   ├── server.ts              # Express + WebSocket entrypoint
│   │   ├── websocket-handler.ts   # Retell event routing
│   │   ├── llm-client.ts          # OpenAI integration
│   │   ├── compliance-validator.ts # Per-sentence PHI redaction
│   │   ├── call-session.ts        # Per-call state tracking
│   │   ├── mock-ehr.ts            # In-memory patient/appointment data
│   │   ├── audit-logger.ts        # Structured JSON logging
│   │   ├── constants.ts           # Prompts, disclosures, configuration
│   │   └── types.ts               # TypeScript interfaces
│   ├── package.json
│   └── tsconfig.json
├── .env.local.example    # Environment variable template
└── README.md             # This file
```

---

## 1. Infrastructure Setup (Terraform)

The Terraform template provisions a FreePBX instance on EC2 with security groups pre-configured for Retell AI connectivity.

### Configure Variables

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars`:

```hcl
# Your public IP (restricts SSH + HTTPS access to only you)
admin_ip = "203.0.113.10/32"   # Find yours: curl -s ifconfig.me

# An existing EC2 key pair in your region
key_pair_name = "my-key-pair"

# Optional overrides
# aws_region    = "us-east-1"
# instance_type = "t3.small"
```

### Apply

```bash
terraform init
terraform plan    # Review what will be created
terraform apply   # Confirm with 'yes'
```

### Expected Outputs

```
freepbx_public_ip = "54.xx.xx.xx"
freepbx_admin_url = "https://54.xx.xx.xx"
ssh_command        = "ssh admin@54.xx.xx.xx"
```

### What Gets Created

- VPC with a single public subnet + internet gateway
- EC2 instance (Debian 12) running FreePBX 17 (installed automatically via user_data)
- Elastic IP for a stable public address
- Security group allowing:
  - SIP (TCP 5060-5061 + UDP 5060) from Retell IP ranges — TCP 5061 used for TLS transport
  - RTP (UDP 10000-20000) from Retell IP ranges
  - SIP-TLS (TCP 5061) from your IP — softphone registration
  - RTP (UDP 10000-20000) from your IP — softphone media
  - HTTPS (443) from your IP only
  - SSH (22) from your IP only

### Verify

Once `terraform apply` completes, give the instance 5-10 minutes for FreePBX to finish installing (check `/var/log/freepbx-install.log` via SSH if needed).

```bash
# Verify web admin is accessible
curl -k https://$(terraform output -raw freepbx_public_ip)

# SSH in to check install status
$(terraform output -raw ssh_command)
tail -f /var/log/freepbx-install.log
```

---

## 2. FreePBX SIP Trunk Configuration

Once FreePBX is accessible at the admin URL, configure it to route calls to Retell AI over TLS.

### Enable TLS Transport

The trunk to Retell uses TLS (port 5061), which requires enabling the TLS transport in FreePBX:

1. **Confirm a certificate exists:**
   - Go to **Admin → Certificate Management**
   - FreePBX creates a default self-signed certificate on first login — confirm it's listed
   - If not, click **New Certificate → Generate Self-Signed Certificate**, give it a name, and submit

2. **Configure TLS and NAT settings:**
   - Go to **Settings → Asterisk SIP Settings → SIP Settings [chan_pjsip]**
   - In **TLS/SSL/SRTP Settings** (click Show Advanced Settings if needed):
     - Certificate Manager: select your certificate
     - SSL Method: `tlsv1_2`
     - Verify Server: `Yes`
   - In **Transports**: enable `tls - 0.0.0.0 - All` → Yes
   - In **NAT Settings**:
     - External Address: your FreePBX Elastic IP (e.g., `34.206.232.89`)
     - Local Networks: your VPC CIDR (e.g., `10.0.0.0/16`)
   - Click **Submit**, then **Apply Config**

3. **Restart Asterisk:**
   ```bash
   sudo systemctl restart asterisk
   ```

> **Note:** The NAT settings are critical. Without them, FreePBX advertises its private IP (`10.0.x.x`) in the SDP media description, and Retell can't send audio back. The External Address tells Asterisk to advertise the public Elastic IP instead.

### Create the PJSIP Trunk

1. Navigate to **Connectivity → Trunks → Add Trunk → Add PJSIP Trunk**

#### General tab

| Field | Value |
|-------|-------|
| Trunk Name | `retell-ai` |
| Hide CallerID | No |
| CID Options | Allow Any CID |
| Continue if Busy | No |
| Disable Trunk | No |

#### pjsip Settings tab → General

| Field | Value |
|-------|-------|
| Username | *(leave blank)* |
| Auth username | *(leave blank)* |
| Secret | *(leave blank)* |
| Authentication | **None** |
| Registration | **None** |
| SIP Server | `sip.retellai.com` |
| SIP Server Port | `5061` |
| Context | `from-pstn` |
| Transport | `0.0.0.0-tls` |

> **Note:** Authentication is set to None because Retell identifies your trunk by source IP (your Elastic IP), not credentials. Registration is None because Retell doesn't require it.

#### pjsip Settings tab → Advanced

| Field | Value |
|-------|-------|
| Media Encryption | `SRTP via in-SDP` |
| Qualify Frequency | `0` |

Media Encryption ensures voice audio between FreePBX and Retell is encrypted with SRTP. Qualify Frequency is set to 0 because Retell does not respond to SIP OPTIONS keepalive requests — without this, Asterisk marks the trunk as "Unavailable" and refuses to route calls.

### Create an Extension

1. Navigate to **Connectivity → Extensions**
2. Click **+ Add Extension → Add New SIP [chan_pjsip] Extension**
3. Set an extension number (e.g., `1001`) and a password
4. Submit and apply config

### Create an Outbound Route

This routes calls from your softphone to Retell AI via the trunk.

1. Navigate to **Connectivity → Outbound Routes → Add Outbound Route**
2. Configure:
   - **Route Name:** `retell-outbound`
   - **Trunk Sequence:** select `retell-ai (pjsip)`
   - **Dial Patterns:** add a pattern that matches what you'll dial (e.g., `X.` to match any number)
3. Submit and apply config

### Register a Softphone

Configure your softphone (Zoiper, Linphone) to register against FreePBX using the extension you created:

| Setting | Value |
|---------|-------|
| SIP Server | FreePBX Elastic IP |
| Port | `5060` |
| Transport | `UDP` |
| Username | Extension number (e.g., `1001`) |
| Password | Extension password |

### Verify

- Check trunk status in **Reports → Asterisk Info → Peers** — it should show the retell-ai trunk
- Make a test call from your softphone — if Retell and the Custom LLM server are configured, you'll hear the AI agent

---

## 3. Environment Setup

From the project root:

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```bash
AWS_PROFILE=your-profile-name
OPENAI_API_KEY=sk-your-key-here
OPENAI_MODEL=gpt-4.1-mini
```

If you use [direnv](https://direnv.net/), variables load automatically. Otherwise, source them manually:

```bash
export $(grep -v '^#' .env.local | xargs)
```

---

## 4. Running the Custom LLM Server

```bash
cd server
npm install
npm run dev
```

You should see:

```
Custom LLM Server listening on port 8080
```

### Expose via ngrok

In a separate terminal:

```bash
ngrok http 8080
```

ngrok outputs a forwarding URL like:

```
Forwarding: https://a1b2c3d4.ngrok-free.app -> http://localhost:8080
```

Your Retell WebSocket URL is:

```
wss://a1b2c3d4.ngrok-free.app/llm-websocket
```

> **Note:** The ngrok URL changes each time you restart (free tier). For a persistent URL across sessions, use a paid ngrok plan with a reserved domain.

---

## 5. Retell AI Agent Configuration

Now that you have the ngrok WebSocket URL, configure the Retell agent:

1. Log in to the [Retell AI dashboard](https://www.retellai.com/)
2. Create a new agent → select **Custom LLM**
3. Set the WebSocket URL:
   ```
   wss://<your-ngrok-subdomain>.ngrok-free.app/llm-websocket
   ```
4. Choose a voice (any natural-sounding English voice)
5. Configure agent behavior:
   - **Responsiveness:** 0.5 (balanced)
   - **Interruption sensitivity:** 0.3 (let agent finish disclosures)
   - **Reminder trigger:** 8000ms
   - **Enable backchannel:** Yes

### Custom Telephony Settings

In the Retell dashboard add a test phone number (i.e. 14155550100) and add your FreePBX Elastic IP as termination endpoint.

---

## 6. Testing the Demo

### End-to-End Call Flow

1. Ensure the Custom LLM server is running (`npm run dev`)
2. Ensure ngrok is running and the Retell agent has the current WebSocket URL
3. Register your softphone against FreePBX and make a test call

### Test Scenario (demonstrates compliance controls)

| Turn | Patient Says | Expected Behavior |
|------|-------------|-------------------|
| 1 | *(call connects)* | Agent delivers HIPAA disclosure + greeting |
| 2 | "I'd like to reschedule. My name is James Wilson." | Agent asks for DOB to verify identity |
| 3 | "November 2, 1972." | Agent finds record; if LLM repeats full name + DOB, PHI redaction triggers |
| 4 | "Yes, please. July 14 at 9 AM." | Agent calls `book_appointment`, confirms booking |

### Verify Audit Logs

Watch the terminal running the Custom LLM server. Each turn produces a structured JSON audit entry:

```json
{
  "timestamp": "2026-07-10T14:32:01.123Z",
  "callId": "call_abc123",
  "turnNumber": 1,
  "transcriptIn": "",
  "rawLlmResponse": "Hi there! How can I help you today?",
  "complianceAction": "modify",
  "complianceReason": "Mandatory HIPAA disclosure prepended",
  "finalResponseSpoken": "Thank you for calling Valley Health Clinic. Before we begin, I want to let you know that you are speaking with an AI assistant. This call may be recorded for quality and training purposes. If you have any medical concerns or need clinical advice, I will connect you directly with our nursing staff. Hi there! How can I help you today?"
}
```

---

## 7. Compliance Controls

The server implements two compliance rules that run on every response during streaming.

| Control | Mechanism | Action |
|---------|-----------|--------|
| **HIPAA Disclosure** | Begin message on WebSocket connect | Prepends mandatory disclosure before the patient speaks |
| **PHI Redaction** | Per-sentence check during streaming | Replaces any sentence containing patient's full name AND date of birth with generic confirmation |
| **Medical Scope Control** | System prompt + `transfer_to_nurse` function | LLM is instructed to never provide clinical advice; uses function calling to escalate |
| **Audit Trail** | Post-turn logging | Logs raw LLM output vs. what was actually spoken, with compliance action and reason |

---

## 8. Troubleshooting

### FreePBX not accessible after terraform apply

The install takes 5-10 minutes. SSH in and check the install log:

```bash
ssh admin@<freepbx_ip>
tail -f /var/log/freepbx-install.log
```

### SIP trunk not registering

- Verify security group rules allow traffic from Retell's IP ranges on ports 5060-5061
- Confirm the trunk peer details use `host=sip.retellai.com` with `transport=tls`
- Check Asterisk peer status: `asterisk -rx "pjsip show endpoints"` or `asterisk -rx "sip show peers"`

### WebSocket not connecting

- Confirm ngrok is running and the URL hasn't changed
- Verify the Retell dashboard has the correct `wss://` URL with path `/llm-websocket`
- Check the server terminal for connection/error logs
- Test the health endpoint: `curl https://<ngrok-url>.ngrok-free.app/`

### No audio / one-way audio

- **Most likely: NAT settings missing.** FreePBX on EC2 advertises its private IP (`10.0.x.x`) in the SDP unless you configure External Address in Settings → Asterisk SIP Settings → NAT Settings. Set it to your Elastic IP.
- RTP ports (UDP 10000-20000) must be open from Retell IP ranges — check the security group
- Ensure the Elastic IP is correctly associated with the instance

### Trunk shows "Unavailable" / calls fail with "Could not create dialog"

- **TLS transport not working:** Confirm a certificate is selected in TLS/SSL settings and SSL Method is `tlsv1_2` (not `tlsv1`). Check with: `sudo /usr/sbin/asterisk -rx "pjsip show transport 0.0.0.0-tls"` — `cert_file` should not be empty and `method` should be `tlsv1_2`.
- **Qualify blocking calls:** Set Qualify Frequency to `0` in the trunk Advanced settings. Retell doesn't respond to OPTIONS requests, causing Asterisk to mark the endpoint as unreachable.
- **DNS SRV errors** (`EDNSNOANSWERREC`): These are normal — Retell doesn't publish SRV records. They don't block calls as long as qualify is disabled.

### LLM errors

- Verify `OPENAI_API_KEY` is set and valid
- Check the server terminal for OpenAI API error messages
- Ensure the model (`gpt-4.1-mini`) is available on your OpenAI account

### ngrok URL changed

If you restarted ngrok, the URL is new. Update it in the Retell dashboard and restart the call.

---

## 9. Running Tests

```bash
cd server
npm test
```

---

## Intentional Simplifications

This demo implements several HIPAA-relevant controls (PHI redaction, audit logging, identity verification, network restrictions, TLS in transit) but is not a fully compliant system. Full HIPAA compliance additionally requires encryption at rest, role-based access controls, signed BAAs with all processors, workforce training, and breach notification procedures. The following table highlights the specific gaps between this demo and what production would require:

| Demo | Production |
|------|-----------|
| Server runs locally via ngrok | Containerized deployment behind load balancer with WebSocket support |
| Mock EHR (3 patients, in-memory) | Real EHR integration (Epic FHIR, Cerner) with OAuth |
| Scope control via system prompt only | Fine-tuned classifier as safety net + structured symptom ontology |
| Audit logs to stdout | HIPAA-compliant audit system (immutable S3 + Athena, or SIEM) |
| No BAA signed | BAA required with Retell, OpenAI, and every sub-processor |
| Single AZ, no redundancy | Multi-AZ with failover for telephony workloads |
| ngrok provides TLS | ACM certificate on your own domain |
| Hardcoded patient data | Real patient lookup with proper auth + access controls |
| Hand-rolled tool loop | Agent framework (LangGraph, Strands) or MCP for standardized tool interfaces |

---

## License

Private — demo/educational use.
