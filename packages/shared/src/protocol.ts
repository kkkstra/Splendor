import { BONUS_COLORS, COST_COLORS, TOKEN_COLORS } from "./constants";

export type BonusColor = (typeof BONUS_COLORS)[number];
export type TokenColor = (typeof TOKEN_COLORS)[number];
export type CostColor = (typeof COST_COLORS)[number];

export type CardLevel = 1 | 2 | 3;

export type CardAbilityType =
  | "EXTRA_TURN"
  | "OVERLAY"
  | "TAKE_SAME_COLOR_TOKEN"
  | "GAIN_PRIVILEGE"
  | "STEAL_TOKEN";

export type RoyalEffectType =
  | "GAIN_PRESTIGE"
  | "GAIN_CROWNS"
  | "GAIN_PRIVILEGE";

export type WinCondition =
  | "PRESTIGE_20"
  | "CROWNS_10"
  | "COLOR_PRESTIGE_10"
  | "OPPONENT_RESIGNED"
  | "OPPONENT_TIMEOUT";

export type TurnPhase =
  | "OPTIONAL_PRIVILEGE"
  | "OPTIONAL_REFILL"
  | "FORCED_ACTION"
  | "RESOLVE_EFFECTS"
  | "END_TURN_CHECK"
  | "FINISHED";

export interface TokenCounts {
  emerald: number;
  sapphire: number;
  ruby: number;
  diamond: number;
  onyx: number;
  pearl: number;
  gold: number;
}

export interface BonusCounts {
  emerald: number;
  sapphire: number;
  ruby: number;
  diamond: number;
  onyx: number;
}

export interface CardCost {
  emerald?: number;
  sapphire?: number;
  ruby?: number;
  diamond?: number;
  onyx?: number;
  pearl?: number;
}

export interface JewelCard {
  id: string;
  level: CardLevel;
  prestige: number;
  crowns: number;
  bonuses: BonusColor[];
  cost: CardCost;
  ability?: CardAbilityType;
}

export interface RoyalCard {
  id: string;
  prestige: number;
  crowns: number;
  effect: {
    type: RoyalEffectType;
    value: number;
  };
}

export interface PlayerState {
  id: string;
  name: string;
  tokens: TokenCounts;
  bonuses: BonusCounts;
  prestige: number;
  crowns: number;
  privileges: number;
  reservedCardIds: string[];
  ownedCardIds: string[];
  royalCardIds: string[];
  dynamicBonusByCardId: Record<string, BonusColor>;
  claimedCrownMilestones: number[];
  extraTurnPending: boolean;
  disconnectedAt?: string;
}

export interface DeckState {
  drawPiles: Record<CardLevel, string[]>;
  faceUp: Record<CardLevel, string[]>;
}

export interface GameSnapshot {
  matchId: string;
  seed: string;
  actionSeq: number;
  phase: TurnPhase;
  currentPlayerId: string;
  playerOrder: [string, string];
  boardTokens: Array<TokenColor | null>;
  bagTokens: TokenColor[];
  decks: DeckState;
  availableRoyalCardIds: string[];
  players: Record<string, PlayerState>;
  winnerId?: string;
  winCondition?: WinCondition;
  startedAt: string;
  updatedAt: string;
  turnDeadlineAt?: string;
}

export interface ProtocolError {
  code:
    | "UNAUTHORIZED"
    | "MATCH_NOT_FOUND"
    | "ROOM_NOT_FOUND"
    | "INVALID_ACTION"
    | "ACTION_SEQ_MISMATCH"
    | "NOT_YOUR_TURN"
    | "FORBIDDEN"
    | "RATE_LIMITED"
    | "SERVER_ERROR";
  message: string;
  actionSeq?: number;
}

export interface GameEvent {
  type: string;
  message: string;
  payload?: Record<string, unknown>;
}

export interface ActionResult {
  actionSeq: number;
  actorId: string;
  actionType: PlayerAction["type"];
  timestamp: string;
  events: GameEvent[];
  snapshot: GameSnapshot;
}

export interface MatchSummary {
  matchId: string;
  roomCode: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  winnerId?: string;
  winCondition?: WinCondition;
  resultForMe: "WIN" | "LOSE";
}

export interface ValidationResult {
  ok: boolean;
  error?: ProtocolError;
}

interface ActionBase {
  clientActionId: string;
  expectedActionSeq: number;
}

export interface UsePrivilegeAction extends ActionBase {
  type: "USE_PRIVILEGE";
  count: number;
  positions: number[];
}

export interface RefillBoardAction extends ActionBase {
  type: "REFILL_BOARD";
}

export interface TakeTokensLineAction extends ActionBase {
  type: "TAKE_TOKENS_LINE";
  positions: number[];
}

export interface ReserveWithGoldAction extends ActionBase {
  type: "RESERVE_WITH_GOLD";
  goldPosition: number;
  source:
    | {
        kind: "open";
        cardId: string;
      }
    | {
        kind: "deck";
        level: CardLevel;
      };
}

export interface BuyCardAction extends ActionBase {
  type: "BUY_CARD";
  source:
    | {
        kind: "open";
        cardId: string;
      }
    | {
        kind: "reserved";
        cardId: string;
      };
  overlayTargetCardId?: string;
  stealColor?: Exclude<TokenColor, "gold">;
}

export interface ResignAction extends ActionBase {
  type: "RESIGN";
  reason?: string;
}

export type PlayerAction =
  | UsePrivilegeAction
  | RefillBoardAction
  | TakeTokensLineAction
  | ReserveWithGoldAction
  | BuyCardAction
  | ResignAction;

export interface PlayerInfo {
  id: string;
  name: string;
}

export interface RoomState {
  code: string;
  status: "WAITING" | "READY" | "IN_MATCH" | "FINISHED";
  hostUserId: string;
  players: Array<{
    userId: string;
    name: string;
    ready: boolean;
    connected: boolean;
  }>;
  matchId?: string;
  createdAt: string;
}

export interface MatchEventRecord {
  actionSeq: number;
  actorId: string;
  action: PlayerAction;
  events: GameEvent[];
  createdAt: string;
}
