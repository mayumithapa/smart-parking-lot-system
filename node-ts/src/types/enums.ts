/**
 * Domain enums + size-compatibility helpers.
 *
 * Vehicles and spots share a single ordinal scale so the allocator can
 * fall back from a smaller-preferred size up to a larger one.
 */

export const VehicleType = {
  MOTORCYCLE: "MOTORCYCLE",
  CAR: "CAR",
  BUS: "BUS",
} as const;
export type VehicleType = (typeof VehicleType)[keyof typeof VehicleType];

export const SpotType = {
  MOTORCYCLE: "MOTORCYCLE",
  COMPACT: "COMPACT",
  LARGE: "LARGE",
} as const;
export type SpotType = (typeof SpotType)[keyof typeof SpotType];

export const SpotStatus = {
  AVAILABLE: "AVAILABLE",
  OCCUPIED: "OCCUPIED",
  DISABLED: "DISABLED",
} as const;
export type SpotStatus = (typeof SpotStatus)[keyof typeof SpotStatus];

export const TicketStatus = {
  ACTIVE: "ACTIVE",
  COMPLETED: "COMPLETED",
  LOST: "LOST",
} as const;
export type TicketStatus = (typeof TicketStatus)[keyof typeof TicketStatus];

/** Ordering used by the allocation algorithm. */
const SPOT_SIZE_ORDER: Record<SpotType, number> = {
  MOTORCYCLE: 0,
  COMPACT: 1,
  LARGE: 2,
};

/** Smallest spot a vehicle is allowed to occupy. */
const VEHICLE_MIN_SPOT: Record<VehicleType, SpotType> = {
  MOTORCYCLE: SpotType.MOTORCYCLE,
  CAR: SpotType.COMPACT,
  BUS: SpotType.LARGE,
};

/**
 * Spot sizes a vehicle is allowed to use, smallest-first.
 *
 * A vehicle may park in any spot at least as large as its minimum.
 * Smaller spots are preferred so larger spots remain available for
 * vehicles that genuinely need them.
 */
export function compatibleSpotTypes(vehicleType: VehicleType): SpotType[] {
  const minimum = VEHICLE_MIN_SPOT[vehicleType];
  const minRank = SPOT_SIZE_ORDER[minimum];
  return (Object.keys(SPOT_SIZE_ORDER) as SpotType[])
    .filter((s) => SPOT_SIZE_ORDER[s] >= minRank)
    .sort((a, b) => SPOT_SIZE_ORDER[a] - SPOT_SIZE_ORDER[b]);
}
