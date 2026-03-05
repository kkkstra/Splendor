import { z } from "zod";

const actionBaseSchema = z.object({
  clientActionId: z.string().min(1),
  expectedActionSeq: z.number().int().min(0),
});

export const usePrivilegeActionSchema = actionBaseSchema.extend({
  type: z.literal("USE_PRIVILEGE"),
  count: z.number().int().min(1).max(3),
  positions: z.array(z.number().int().min(0).max(24)).min(1).max(3),
});

export const refillBoardActionSchema = actionBaseSchema.extend({
  type: z.literal("REFILL_BOARD"),
});

export const takeTokensLineActionSchema = actionBaseSchema.extend({
  type: z.literal("TAKE_TOKENS_LINE"),
  positions: z.array(z.number().int().min(0).max(24)).min(1).max(3),
});

export const reserveWithGoldActionSchema = actionBaseSchema.extend({
  type: z.literal("RESERVE_WITH_GOLD"),
  goldPosition: z.number().int().min(0).max(24),
  source: z.union([
    z.object({
      kind: z.literal("open"),
      cardId: z.string().min(1),
    }),
    z.object({
      kind: z.literal("deck"),
      level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    }),
  ]),
});

export const buyCardActionSchema = actionBaseSchema.extend({
  type: z.literal("BUY_CARD"),
  source: z.union([
    z.object({
      kind: z.literal("open"),
      cardId: z.string().min(1),
    }),
    z.object({
      kind: z.literal("reserved"),
      cardId: z.string().min(1),
    }),
  ]),
  overlayTargetCardId: z.string().min(1).optional(),
  stealColor: z
    .union([
      z.literal("emerald"),
      z.literal("sapphire"),
      z.literal("ruby"),
      z.literal("diamond"),
      z.literal("onyx"),
      z.literal("pearl"),
    ])
    .optional(),
});

export const resignActionSchema = actionBaseSchema.extend({
  type: z.literal("RESIGN"),
  reason: z.string().max(200).optional(),
});

export const playerActionSchema = z.discriminatedUnion("type", [
  usePrivilegeActionSchema,
  refillBoardActionSchema,
  takeTokensLineActionSchema,
  reserveWithGoldActionSchema,
  buyCardActionSchema,
  resignActionSchema,
]);

export const roomSubscribeSchema = z.object({
  roomCode: z.string().min(4).max(8),
});

export const roomReadySchema = z.object({
  roomCode: z.string().min(4).max(8),
  ready: z.boolean(),
});

export const matchSyncSchema = z.object({
  matchId: z.string().min(1),
});

export const matchActionSchema = z.object({
  matchId: z.string().min(1),
  action: playerActionSchema,
});

export const matchResignSchema = z.object({
  matchId: z.string().min(1),
  clientActionId: z.string().min(1),
  expectedActionSeq: z.number().int().min(0),
});
