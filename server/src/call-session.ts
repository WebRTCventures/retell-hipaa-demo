import type { TranscriptEntry, PatientRecord, PatientContext } from "./types.js";

export class CallSession {
  public callId: string;
  public turnCount: number;
  public disclosureDelivered: boolean;
  public transcript: TranscriptEntry[];
  public patientContext: PatientContext | null;
  public startTime: Date;
  public endTime: Date | null;

  constructor(callId: string) {
    this.callId = callId;
    this.turnCount = 0;
    this.disclosureDelivered = false;
    this.transcript = [];
    this.patientContext = null;
    this.startTime = new Date();
    this.endTime = null;
  }

  updateTranscript(entries: TranscriptEntry[]): void {
    this.transcript.push(...entries);
  }

  incrementTurn(): void {
    this.turnCount += 1;
  }

  setPatientContext(patient: PatientRecord): void {
    this.patientContext = {
      fullName: patient.name,
      dob: patient.dob,
      patientId: patient.id,
    };
  }

  end(): void {
    this.endTime = new Date();
  }

  getDuration(): number {
    if (!this.endTime) {
      return 0;
    }
    return this.endTime.getTime() - this.startTime.getTime();
  }
}
