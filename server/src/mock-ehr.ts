import { PatientRecord, AppointmentSlot, BookingResult } from "./types.js";

// =============================================================================
// In-memory patient records
// =============================================================================

const patients: PatientRecord[] = [
  {
    id: "P001",
    name: "Maria Garcia",
    dob: "1985-03-15",
    nextAppointment: "2026-07-15T10:00",
  },
  {
    id: "P002",
    name: "James Wilson",
    dob: "1972-11-02",
    nextAppointment: "2026-07-12T15:30",
  },
  {
    id: "P003",
    name: "Sarah Chen",
    dob: "1990-07-22",
    nextAppointment: "2026-07-12T14:30",
  },
];

// =============================================================================
// Available appointment slots (mutable — bookings remove from this list)
// =============================================================================

const availableSlots: AppointmentSlot[] = [
  { time: "2026-07-14T09:00", provider: "Dr. Smith" },
  { time: "2026-07-14T11:00", provider: "Dr. Smith" },
  { time: "2026-07-15T14:00", provider: "Dr. Smith" },
  { time: "2026-07-16T10:00", provider: "Dr. Smith" },
  { time: "2026-07-16T15:30", provider: "Dr. Smith" },
];

// =============================================================================
// Mock EHR API
// =============================================================================

/**
 * Look up a patient by name (case-insensitive) and DOB (exact match).
 * Returns the patient record or null if not found.
 */
export function lookupPatient(
  name: string,
  dob: string
): PatientRecord | null {
  const normalizedName = name.toLowerCase().trim();
  const patient = patients.find(
    (p) => p.name.toLowerCase() === normalizedName && p.dob === dob
  );
  return patient ?? null;
}

/**
 * Returns all currently available appointment slots.
 */
export function getAvailableSlots(): AppointmentSlot[] {
  return [...availableSlots];
}

/**
 * Book an appointment for a patient at the given slot time.
 * Removes the slot from available slots and updates the patient record.
 * Returns an error if patient ID is invalid or slot is not available.
 */
export function bookAppointment(
  patientId: string,
  slotTime: string
): BookingResult {
  // Find the patient by ID
  const patient = patients.find((p) => p.id === patientId);
  if (!patient) {
    return {
      success: false,
      message: `Patient with ID "${patientId}" not found.`,
    };
  }

  // Find the slot by time
  const slotIndex = availableSlots.findIndex((s) => s.time === slotTime);
  if (slotIndex === -1) {
    return {
      success: false,
      message: `Appointment slot at "${slotTime}" is not available.`,
    };
  }

  // Remove from available slots
  availableSlots.splice(slotIndex, 1);

  // Update patient record
  patient.nextAppointment = slotTime;

  return {
    success: true,
    message: `Appointment booked for ${patient.name} on ${slotTime}.`,
    appointment: { patientId: patient.id, time: slotTime },
  };
}

/**
 * Reset state for testing purposes. Restores patients and slots to initial values.
 */
export function _resetState(): void {
  patients.length = 0;
  patients.push(
    {
      id: "P001",
      name: "Maria Garcia",
      dob: "1985-03-15",
      nextAppointment: "2026-07-15T10:00",
    },
    {
      id: "P002",
      name: "James Wilson",
      dob: "1972-11-02",
      nextAppointment: null,
    },
    {
      id: "P003",
      name: "Sarah Chen",
      dob: "1990-07-22",
      nextAppointment: "2026-07-12T14:30",
    }
  );

  availableSlots.length = 0;
  availableSlots.push(
    { time: "2026-07-14T09:00", provider: "Dr. Smith" },
    { time: "2026-07-14T11:00", provider: "Dr. Smith" },
    { time: "2026-07-15T14:00", provider: "Dr. Smith" },
    { time: "2026-07-16T10:00", provider: "Dr. Smith" },
    { time: "2026-07-16T15:30", provider: "Dr. Smith" }
  );
}
