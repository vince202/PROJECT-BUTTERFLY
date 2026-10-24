/**
 * Seats placed by the town builders at the exact standing spots of the
 * simulation (City.insidePos): an inhabitant idling on a seat sits down,
 * facing the seat's heading. Purely visual; positions stay authoritative.
 */

export interface Seat {
  x: number;
  z: number;
  /** Facing direction (radians, three.js rotation.y; 0 = +z). */
  heading: number;
  /** Seat height above the ground (m). */
  height: number;
}

export const SEATS = new Map<string, Seat[]>();

export function addSeat(locationId: string, seat: Seat): void {
  if (!SEATS.has(locationId)) SEATS.set(locationId, []);
  SEATS.get(locationId)!.push(seat);
}

/** Seat at (x, z) of a location (within 0.7 m), if any. */
export function seatAt(locationId: string, x: number, z: number): Seat | null {
  const list = SEATS.get(locationId);
  if (!list) return null;
  for (const s of list) if (Math.abs(s.x - x) < 0.7 && Math.abs(s.z - z) < 0.7) return s;
  return null;
}
