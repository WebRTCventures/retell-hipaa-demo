# Voice AI Patient Intake with HIPAA Safeguards — Retell AI + FreePBX Demo

A working demo of a voice AI agent handling patient intake calls with HIPAA compliance in mind. A patient calls in through FreePBX (on EC2), the call routes to Retell AI via SIP trunk, and a Custom LLM server validates every response against compliance rules before it's spoken.

The demo implements several layers toward that goal:

- **Response compliance enforcement** — mandatory HIPAA disclosure on every call, PHI redaction, and medical advice blocking with automatic transfer to clinical staff
- **Per-turn audit trail** — structured NDJSON logging of every interaction (input, raw LLM output, compliance action taken, final spoken response) plus call-level summaries
- **Identity verification** — patient records are only accessible after name + date of birth verification via function calling
- **Network least-privilege** — Terraform security groups restrict SIP/RTP to Retell AI IP ranges and admin access (SSH, HTTPS) to a single operator IP
- **Encryption in transit** — all data paths encrypted: SIP signaling via TLS, voice media via SRTP (both softphone↔FreePBX and FreePBX↔Retell legs), WebSocket via TLS (ngrok tunnel), and OpenAI API calls over HTTPS

> **Scope:** Full HIPAA compliance is a broad undertaking — it requires encryption at rest, comprehensive role-based access controls, workforce training, breach notification procedures, and a signed Business Associate Agreement (BAA) with every data processor. This demo focuses on the aspects listed above. The remaining requirements are out of scope here and would need to be addressed for a production deployment. See [Intentional Simplifications](#intentional-simplifications) for a full gap list.

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
│   │   ├── compliance-validator.ts # HIPAA rule enforcement
│   │   ├── call-session.ts        # Per-call state tracking
│   │   ├── mock-ehr.ts            # In-memory patient/appointment data
│   │   ├── audit-logger.ts        # Structured JSON logging
│   │   ├── constants.ts           # Prompts, disclosures, keywords
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

FreePBX 17 only enables UDP by default. To use TLS for SIP signaling (encrypting call setup between FreePBX and Retell):

1. **Install Retell's root CA certificate** — SSH into FreePBX and download it (per [Retell's custom telephony docs](https://docs.retellai.com/deploy/custom-telephony)):
   ```bash
   sudo wget https://www.amazontrust.com/repository/G2-RootCA1.pem \
     -O /etc/asterisk/keys/retell-ca.pem
   sudo chown asterisk:asterisk /etc/asterisk/keys/retell-ca.pem
   sudo chmod 644 /etc/asterisk/keys/retell-ca.pem
   ```
   This lets Asterisk verify Retell's server certificate during the TLS handshake.

2. **Create a certificate in FreePBX** (if one doesn't already exist):
   - Go to **Admin → Certificate Management**
   - FreePBX creates a default self-signed certificate on first login — confirm it's listed
   - If not, click **New Certificate → Generate Self-Signed Certificate**, give it a name, and submit

3. **Enable TLS transport:**
   - Go to **Settings → Asterisk SIP Settings → SIP Settings [chan_pjsip]**
   - Click **Show Advanced Settings** → Yes (in Misc PJSip Settings)
   - In **TLS/SSL/SRTP Settings**:
     - Certificate Manager: select your certificate
     - SSL Method: `tlsv1_2`
     - Verify Client: `No`
     - Verify Server: `Yes`
   - In **Transports**: enable `tls - 0.0.0.0 - All` → Yes
   - Click **Submit**, then **Apply Config**

4. **Restart Asterisk** (required for transport changes):
   ```bash
   sudo systemctl restart asterisk
   ```

After this, the TLS transport option will appear in the trunk dropdown.

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

This ensures voice audio between FreePBX and Retell is encrypted with SRTP. Retell supports SRTP when the transport is TLS.

### Create an Extension

1. Navigate to **Connectivity → Extensions**
2. Click **+ Add Extension → Add New SIP [chan_pjsip] Extension**
3. Set an extension number (e.g., `1001`) and a password
4. Go to the **Advanced** tab and configure encryption:

| Field | Value |
|-------|-------|
| Transport | `0.0.0.0-tls` |
| Media Encryption | `SRTP via in-SDP` |
| Allow Non-Encrypted Media | `No` |
| Direct Media | `No` |

4. Submit and apply config

This encrypts the leg between your softphone and FreePBX (both signaling via TLS and audio via SRTP).

### Create an Outbound Route

This routes calls from your softphone to Retell AI via the trunk.

1. Navigate to **Connectivity → Outbound Routes → Add Outbound Route**
2. Configure:
   - **Route Name:** `retell-outbound`
   - **Trunk Sequence:** select `retell-ai (pjsip)`
   - **Dial Patterns:** add a pattern that matches what you'll dial (e.g., `X.` to match any number)
3. Submit and apply config

### Create an Inbound Route

This tells FreePBX what to do when Retell sends a call back (or for testing).

1. Navigate to **Connectivity → Inbound Routes → Add Incoming Route**
2. Configure:
   - **Description:** `retell-inbound`
   - **DID Number:** `ANY`
   - **Set Destination:** Trunks → `retell-ai (pjsip)`
3. Submit and apply config

### Register a Softphone

Configure your softphone (Zoiper, Linphone) to register against FreePBX using the extension you created:

| Setting | Value |
|---------|-------|
| SIP Server | FreePBX Elastic IP |
| Port | `5061` |
| Transport | `TLS` |
| SRTP / Media Encryption | `Enabled` / `Required` |
| Certificate verification | Accept the self-signed certificate when prompted |

> **Note:** Since FreePBX uses a self-signed certificate, your softphone will warn you about an untrusted cert on first connection. This is expected — accept it. The connection is still encrypted, just not authenticated by a public CA. Both endpoints are under your control.

### Verify

- Check trunk status in **Reports → Asterisk Info → Peers** — it should show the retell-ai trunk
- Make a test call from your softphone — if Retell and the Custom LLM server are configured, you'll hear the AI agent

---

## 3. Retell AI Agent Configuration

1. Log in to the [Retell AI dashboard](https://www.retellai.com/)
2. Create a new agent → select **Custom LLM**
3. Set the WebSocket URL (you'll get this from ngrok in step 5):
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

In the Retell dashboard under Custom Telephony:
- Add your FreePBX Elastic IP to allowed originators
- Note the SIP URI format Retell expects for inbound calls

---

## 4. Environment Setup

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

## 5. Running the Custom LLM Server

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

Paste this URL into your Retell dashboard agent configuration.

> **Note:** The ngrok URL changes each time you restart (free tier). For a persistent URL across sessions, use a paid ngrok plan with a reserved domain.

---

## 6. Testing the Demo

### End-to-End Call Flow

1. Start the Custom LLM server (`npm run dev`)
2. Start ngrok (`ngrok http 8080`)
3. Ensure the Retell agent has the current ngrok WebSocket URL
4. Call from your softphone through FreePBX

### Test Scenario (4 turns, demonstrates all 3 compliance rules)

| Turn | Patient Says | Expected Behavior |
|------|-------------|-------------------|
| 1 | *(call connects)* | Agent delivers HIPAA disclosure + greeting |
| 2 | "I'd like to reschedule. My name is James Wilson." | Agent asks for DOB to verify identity |
| 3 | "November 2, 1972." | Agent finds record; if LLM repeats full name + DOB, PHI redaction triggers |
| 4 | "I've been having bad headaches and dizziness." | Medical advice detection triggers → transfer message → call ends |

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

## 7. Response Compliance Rules

The server enforces three rules on every LLM response before it reaches the caller. Combined with per-turn audit logging and identity verification, these guardrails demonstrate how a compliance layer can sit between the LLM and the caller to enforce privacy and safety policies in real time.

| Rule | Trigger | Action |
|------|---------|--------|
| **HIPAA Disclosure** | First turn of every call | Prepends mandatory disclosure to the response |
| **Medical Advice Blocking** | Response contains medical keywords (e.g., "diagnosis", "prescribe", "symptoms suggest") | Blocks the response entirely, substitutes a transfer message, ends the call |
| **PHI Redaction** | Response contains patient's full name AND date of birth together | Removes the DOB from the response |

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

- RTP ports (UDP 10000-20000) must be open from Retell IP ranges — check the security group
- Ensure the Elastic IP is correctly associated with the instance
- FreePBX may need NAT settings configured if behind the AWS VPC NAT

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

This demo implements several HIPAA-relevant controls (response compliance, audit logging, identity verification, network restrictions, TLS in transit) but is not a fully compliant system. Full HIPAA compliance additionally requires encryption at rest, role-based access controls, signed BAAs with all processors, workforce training, and breach notification procedures. The following table highlights the specific gaps between this demo and what production would require:

| Demo | Production |
|------|-----------|
| Server runs locally via ngrok | ECS/Fargate behind ALB with ACM cert + custom domain |
| Mock EHR (3 patients, in-memory) | Real EHR integration (Epic FHIR, Cerner) with OAuth |
| Keyword-based medical advice detection | Classifier model or structured symptom ontology |
| Audit logs to stdout | HIPAA-compliant audit system (immutable S3 + Athena, or SIEM) |
| No BAA signed | BAA required with Retell + every sub-processor |
| Single AZ, no redundancy | Multi-AZ with failover for telephony workloads |
| ngrok provides TLS | ACM certificate on your own domain |
| Hardcoded patient data | Real patient lookup with proper auth + access controls |

---

## License

Private — demo/educational use.
