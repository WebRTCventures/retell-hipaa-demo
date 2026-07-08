import { describe, it, expect, beforeEach } from "vitest";
import { CallSession } from "./call-session.js";
import type { PatientRecord, TranscriptEntry } from "./types.js";

describe("CallSession", () => {
  let session: CallSession;

  beforeEach(() => {
    session = new CallSession("test-call-123");
  });

  describe("constructor", () => {
    it("initializes with correct defaults", () => {
      expect(session.callId).toBe("test-call-123");
      expect(session.turnCount).toBe(0);
      expect(session.disclosureDelivered).toBe(false);
      expect(session.transcript).toEqual([]);
      expect(session.patientContext).toBeNull();
      expect(session.startTime).toBeInstanceOf(Date);
      expect(session.endTime).toBeNull();
    });
  });

  describe("updateTranscript", () => {
    it("appends entries to the transcript array", () => {
      const entries: TranscriptEntry[] = [
        { role: "user", content: "Hello" },
        { role: "agent", content: "Hi there" },
      ];

      session.updateTranscript(entries);

      expect(session.transcript).toHaveLength(2);
      expect(session.transcript[0]).toEqual({ role: "user", content: "Hello" });
      expect(session.transcript[1]).toEqual({ role: "agent", content: "Hi there" });
    });

    it("accumulates entries across multiple calls", () => {
      session.updateTranscript([{ role: "user", content: "First" }]);
      session.updateTranscript([{ role: "agent", content: "Second" }]);

      expect(session.transcript).toHaveLength(2);
      expect(session.transcript[0].content).toBe("First");
      expect(session.transcript[1].content).toBe("Second");
    });
  });

  describe("incrementTurn", () => {
    it("increments turnCount by 1", () => {
      session.incrementTurn();
      expect(session.turnCount).toBe(1);

      session.incrementTurn();
      expect(session.turnCount).toBe(2);
    });
  });

  describe("setPatientContext", () => {
    it("maps PatientRecord to PatientContext", () => {
      const patient: PatientRecord = {
        id: "P001",
        name: "Maria Garcia",
        dob: "1985-03-15",
        nextAppointment: "2026-07-15T10:00",
      };

      session.setPatientContext(patient);

      expect(session.patientContext).toEqual({
        fullName: "Maria Garcia",
        dob: "1985-03-15",
        patientId: "P001",
      });
    });
  });

  describe("end", () => {
    it("records endTime", () => {
      expect(session.endTime).toBeNull();

      session.end();

      expect(session.endTime).toBeInstanceOf(Date);
    });
  });

  describe("getDuration", () => {
    it("returns 0 if session has not ended", () => {
      expect(session.getDuration()).toBe(0);
    });

    it("returns duration in milliseconds after end() is called", () => {
      // Override startTime to a known value for predictable testing
      session.startTime = new Date("2026-01-01T00:00:00.000Z");
      session.endTime = new Date("2026-01-01T00:00:05.000Z");

      expect(session.getDuration()).toBe(5000);
    });
  });
});
