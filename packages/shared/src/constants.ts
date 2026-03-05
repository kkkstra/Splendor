export const BONUS_COLORS = ["emerald", "sapphire", "ruby", "diamond", "onyx"] as const;
export const TOKEN_COLORS = [...BONUS_COLORS, "pearl", "gold"] as const;
export const COST_COLORS = [...BONUS_COLORS, "pearl"] as const;

export const BOARD_SIZE = 5;
export const BOARD_CELL_COUNT = BOARD_SIZE * BOARD_SIZE;

export const BOARD_SPIRAL_ORDER: readonly number[] = [
  12, 13, 18, 17, 16,
  11, 6, 7, 8, 9,
  14, 19, 24, 23, 22,
  21, 20, 15, 10, 5,
  0, 1, 2, 3, 4,
] as const;

export const FACE_UP_COUNT_BY_LEVEL = {
  1: 5,
  2: 4,
  3: 3,
} as const;

export const TOKEN_POOL = {
  emerald: 4,
  sapphire: 4,
  ruby: 4,
  diamond: 4,
  onyx: 4,
  pearl: 2,
  gold: 3,
} as const;

export const TOTAL_PRIVILEGES = 3;

export const TURN_TIMEOUT_SECONDS = 120;
export const RECONNECT_GRACE_SECONDS = 180;
