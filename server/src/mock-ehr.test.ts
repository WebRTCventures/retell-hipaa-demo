import { describe, it, expect, beforeEach } from "vitest";
import {
  lookupPatient,
  getAvailableSlots,
  bookAppointment,
  _resetState,
} from "./mock-ehr.js";

describe("Mock EHR", () => {
  beforeEach(() => {
    _resetState();
  });

  describe("lookupPatient", () => {
    it("returns patient record for exact name and DOB match", () => {
      const result = lookupPatient("Maria Garcia", "1985-03-15");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("P001");
      expect(result!.name).toBe("Maria Garcia");
      expect(result!.dob).toBe("1985-03-15");
      expect(result!.nextAppointment).toBe("2026-07-15T10:00");
    });

    it("matches patient name case-insensitively", () => {
      expect(lookupPatient("MARIA GARCIA", "1985-03-15")).not.toBeNull();
      expect(lookupPatient("maria garcia", "1985-03-15")).not.toBeNull();
      expect(lookupPatient("Maria garcia", "1985-03-15")).not.toBeNull();
      expect(lookupPatient("mArIa GaRcIa", "1985-03-15")).not.toBeNull();
    });

    it("returns null for wrong DOB even if name matches", () => {
      const result = lookupPatient("Maria Garcia", "1990-01-01");
      expect(result).toBeNull();
    });

    it("returns null for unknown patient", () => {
      const result = lookupPatient("John Doe", "2000-01-01");
      expect(result).toBeNull();
    });

    it("handles leading/trailing whitespace in name", () => {
      const result = lookupPatient("  Maria Garcia  ", "1985-03-15");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("P001");
    });
  });

  describe("getAvailableSlots", () => {
    it("returns 5 initial appointment slots", () => {
      const slots = getAvailableSlots();
      expect(slots).toHaveLength(5);
    });

    it("each slot has a time and provider", () => {
      const slots = getAvailableSlots();
      for (const slot of slots) {
        expect(slot.time).toBeDefined();
        expect(slot.provider).toBeDefined();
        expect(slot.provider).toBe("Dr. Smith");
      }
    });

    it("returns a copy (mutations do not affect internal state)", () => {
      const slots = getAvailableSlots();
      slots.pop();
      expect(getAvailableSlots()).toHaveLength(5);
    });
  });

  describe("bookAppointment", () => {
    it("successfully books an available slot for a valid patient", () => {
      const result = bookAppointment("P002", "2026-07-14T09:00");
      expect(result.success).toBe(true);
      expect(result.appointment).toEqual({
        patientId: "P002",
        time: "2026-07-14T09:00",
      });
    });

    it("removes the booked slot from available slots", () => {
      bookAppointment("P001", "2026-07-14T09:00");
      const slots = getAvailableSlots();
      expect(slots).toHaveLength(4);
      expect(slots.find((s) => s.time === "2026-07-14T09:00")).toBeUndefined();
    });

    it("updates the patient's nextAppointment", () => {
      bookAppointment("P002", "2026-07-16T10:00");
      const patient = lookupPatient("James Wilson", "1972-11-02");
      expect(patient!.nextAppointment).toBe("2026-07-16T10:00");
    });

    it("returns error for invalid patient ID", () => {
      const result = bookAppointment("P999", "2026-07-14T09:00");
      expect(result.success).toBe(false);
      expect(result.message).toContain("P999");
      expect(result.appointment).toBeUndefined();
    });

    it("returns error for unavailable slot time", () => {
      const result = bookAppointment("P001", "2099-01-01T00:00");
      expect(result.success).toBe(false);
      expect(result.message).toContain("not available");
      expect(result.appointment).toBeUndefined();
    });

    it("cannot book the same slot twice", () => {
      bookAppointment("P001", "2026-07-14T11:00");
      const result = bookAppointment("P002", "2026-07-14T11:00");
      expect(result.success).toBe(false);
    });
  });
});
