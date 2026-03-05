import {
  BOARD_SPIRAL_ORDER,
  BONUS_COLORS,
  COST_COLORS,
  FACE_UP_COUNT_BY_LEVEL,
  JEWEL_CARD_BY_ID,
  JEWEL_CARDS,
  ROYAL_CARD_BY_ID,
  ROYAL_CARDS,
  TOKEN_POOL,
  TOTAL_PRIVILEGES,
  type ActionResult,
  type BonusColor,
  type BuyCardAction,
  type CardLevel,
  type GameEvent,
  type GameSnapshot,
  type JewelCard,
  type PlayerAction,
  type PlayerInfo,
  type PlayerState,
  type ProtocolError,
  type ReserveWithGoldAction,
  type TakeTokensLineAction,
  type TokenColor,
  type TokenCounts,
  type ValidationResult,
  type WinCondition,
} from "@splendor/shared";

export class EngineValidationError extends Error {
  public readonly protocolError: ProtocolError;

  constructor(protocolError: ProtocolError) {
    super(protocolError.message);
    this.protocolError = protocolError;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function hashString(input: string): number {
  let h = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    h ^= input.charCodeAt(index);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(input: T[], rng: () => number): T[] {
  const arr = [...input];
  for (let index = arr.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [arr[index], arr[swapIndex]] = [arr[swapIndex], arr[index]];
  }
  return arr;
}

function emptyTokenCounts(): TokenCounts {
  return {
    emerald: 0,
    sapphire: 0,
    ruby: 0,
    diamond: 0,
    onyx: 0,
    pearl: 0,
    gold: 0,
  };
}

function emptyBonusCounts(): PlayerState["bonuses"] {
  return {
    emerald: 0,
    sapphire: 0,
    ruby: 0,
    diamond: 0,
    onyx: 0,
  };
}

function sumTokenCounts(tokens: TokenCounts): number {
  return Object.values(tokens).reduce((acc, current) => acc + current, 0);
}

function playerIds(snapshot: GameSnapshot): [string, string] {
  return snapshot.playerOrder;
}

function getOpponentId(snapshot: GameSnapshot, playerId: string): string {
  const [first, second] = playerIds(snapshot);
  return first === playerId ? second : first;
}

function publicPrivileges(snapshot: GameSnapshot): number {
  const totalHeld = snapshot.playerOrder.reduce((acc, playerId) => acc + snapshot.players[playerId].privileges, 0);
  return Math.max(TOTAL_PRIVILEGES - totalHeld, 0);
}

function pushEvent(events: GameEvent[], type: string, message: string, payload?: Record<string, unknown>): void {
  events.push({ type, message, payload });
}

function cloneSnapshot(snapshot: GameSnapshot): GameSnapshot {
  return structuredClone(snapshot);
}

function normalizeSeed(seed: string): string {
  if (!seed.trim()) {
    return String(Date.now());
  }
  return seed;
}

function createDeckState(seed: string): GameSnapshot["decks"] {
  const grouped: Record<CardLevel, string[]> = {
    1: [],
    2: [],
    3: [],
  };

  for (const card of JEWEL_CARDS) {
    grouped[card.level].push(card.id);
  }

  const rng = mulberry32(hashString(`decks:${seed}`));
  const drawPiles: Record<CardLevel, string[]> = {
    1: shuffle(grouped[1], rng),
    2: shuffle(grouped[2], rng),
    3: shuffle(grouped[3], rng),
  };

  const faceUp: Record<CardLevel, string[]> = {
    1: [],
    2: [],
    3: [],
  };

  for (const level of [1, 2, 3] as const) {
    while (faceUp[level].length < FACE_UP_COUNT_BY_LEVEL[level] && drawPiles[level].length > 0) {
      const cardId = drawPiles[level].shift();
      if (!cardId) {
        break;
      }
      faceUp[level].push(cardId);
    }
  }

  return {
    drawPiles,
    faceUp,
  };
}

function createBoardTokens(seed: string): Array<TokenColor | null> {
  const pool: TokenColor[] = [];
  for (const [color, count] of Object.entries(TOKEN_POOL) as Array<[TokenColor, number]>) {
    for (let index = 0; index < count; index += 1) {
      pool.push(color);
    }
  }

  const rng = mulberry32(hashString(`board:${seed}`));
  return shuffle(pool, rng);
}

function createRoyalDeck(seed: string): string[] {
  const rng = mulberry32(hashString(`royal:${seed}`));
  return shuffle(ROYAL_CARDS.map((card) => card.id), rng);
}

function initPlayer(player: PlayerInfo): PlayerState {
  return {
    id: player.id,
    name: player.name,
    tokens: emptyTokenCounts(),
    bonuses: emptyBonusCounts(),
    prestige: 0,
    crowns: 0,
    privileges: 0,
    reservedCardIds: [],
    ownedCardIds: [],
    royalCardIds: [],
    dynamicBonusByCardId: {},
    claimedCrownMilestones: [],
    extraTurnPending: false,
  };
}

function error(code: ProtocolError["code"], message: string, actionSeq?: number): ValidationResult {
  return {
    ok: false,
    error: {
      code,
      message,
      actionSeq,
    },
  };
}

function success(): ValidationResult {
  return { ok: true };
}

function isOptionalOrForcedPhase(phase: GameSnapshot["phase"]): boolean {
  return phase === "OPTIONAL_PRIVILEGE" || phase === "OPTIONAL_REFILL" || phase === "FORCED_ACTION";
}

function hasEmptyBoardSlot(snapshot: GameSnapshot): boolean {
  return snapshot.boardTokens.some((token) => token === null);
}

function hasGoldOnBoard(snapshot: GameSnapshot): boolean {
  return snapshot.boardTokens.some((token) => token === "gold");
}

function canRefillBoard(snapshot: GameSnapshot): boolean {
  return snapshot.bagTokens.length > 0 && hasEmptyBoardSlot(snapshot);
}

function isBoardIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < snapshotBoardCellCount();
}

function snapshotBoardCellCount(): number {
  return 25;
}

function uniquePositions(positions: number[]): boolean {
  return new Set(positions).size === positions.length;
}

function coord(index: number): { x: number; y: number } {
  return {
    x: index % 5,
    y: Math.floor(index / 5),
  };
}

function isValidLineStep(from: number, to: number): { dx: number; dy: number } | null {
  const a = coord(from);
  const b = coord(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  if (Math.max(absX, absY) !== 1) {
    return null;
  }
  if (!(dx === 0 || dy === 0 || absX === absY)) {
    return null;
  }

  return { dx, dy };
}

function permutations(input: number[]): number[][] {
  if (input.length <= 1) {
    return [input];
  }
  const output: number[][] = [];
  for (let index = 0; index < input.length; index += 1) {
    const current = input[index];
    const rest = [...input.slice(0, index), ...input.slice(index + 1)];
    for (const perm of permutations(rest)) {
      output.push([current, ...perm]);
    }
  }
  return output;
}

function positionsFormStraightLine(positions: number[]): boolean {
  if (positions.length <= 1) {
    return true;
  }
  if (positions.length === 2) {
    return isValidLineStep(positions[0], positions[1]) !== null;
  }

  for (const ordered of permutations(positions)) {
    const first = isValidLineStep(ordered[0], ordered[1]);
    const second = isValidLineStep(ordered[1], ordered[2]);
    if (!first || !second) {
      continue;
    }
    if (first.dx === second.dx && first.dy === second.dy) {
      return true;
    }
  }

  return false;
}

function getCardById(cardId: string): JewelCard {
  const card = JEWEL_CARD_BY_ID[cardId];
  if (!card) {
    throw new Error(`Unknown card id: ${cardId}`);
  }
  return card;
}

function cardLevelFromId(cardId: string): CardLevel {
  const levelRaw = Number(cardId[1]);
  if (levelRaw === 1 || levelRaw === 2 || levelRaw === 3) {
    return levelRaw;
  }
  throw new Error(`Cannot infer card level from id: ${cardId}`);
}

function findFaceUpCard(snapshot: GameSnapshot, cardId: string): { level: CardLevel; index: number } | null {
  for (const level of [1, 2, 3] as const) {
    const index = snapshot.decks.faceUp[level].indexOf(cardId);
    if (index >= 0) {
      return { level, index };
    }
  }
  return null;
}

function refillFaceUp(snapshot: GameSnapshot, level: CardLevel): void {
  while (
    snapshot.decks.faceUp[level].length < FACE_UP_COUNT_BY_LEVEL[level] &&
    snapshot.decks.drawPiles[level].length > 0
  ) {
    const drawn = snapshot.decks.drawPiles[level].shift();
    if (!drawn) {
      break;
    }
    snapshot.decks.faceUp[level].push(drawn);
  }
}

function removeFaceUpCard(snapshot: GameSnapshot, cardId: string): CardLevel {
  const found = findFaceUpCard(snapshot, cardId);
  if (!found) {
    throw new Error(`Face-up card not found: ${cardId}`);
  }
  snapshot.decks.faceUp[found.level].splice(found.index, 1);
  return found.level;
}

function computeSpendPlan(player: PlayerState, card: JewelCard): TokenCounts | null {
  const plan = emptyTokenCounts();
  let remainingGold = player.tokens.gold;

  for (const color of COST_COLORS) {
    const listedCost = card.cost[color] ?? 0;
    const discount = color === "pearl" ? 0 : player.bonuses[color as BonusColor];
    let remaining = Math.max(listedCost - discount, 0);

    const spendColor = Math.min(player.tokens[color], remaining);
    plan[color] += spendColor;
    remaining -= spendColor;

    if (remaining > 0) {
      if (remainingGold < remaining) {
        return null;
      }
      plan.gold += remaining;
      remainingGold -= remaining;
    }
  }

  return plan;
}

function canAffordCard(player: PlayerState, card: JewelCard): boolean {
  return computeSpendPlan(player, card) !== null;
}

function canTakeAnyTokens(snapshot: GameSnapshot): boolean {
  return snapshot.boardTokens.some((token) => token !== null && token !== "gold");
}

function canReserveWithGold(snapshot: GameSnapshot, playerId: string): boolean {
  if (!hasGoldOnBoard(snapshot)) {
    return false;
  }
  const player = snapshot.players[playerId];
  if (player.reservedCardIds.length >= 3) {
    return false;
  }
  const hasVisible = snapshot.decks.faceUp[1].length + snapshot.decks.faceUp[2].length + snapshot.decks.faceUp[3].length > 0;
  const hasDeck =
    snapshot.decks.drawPiles[1].length + snapshot.decks.drawPiles[2].length + snapshot.decks.drawPiles[3].length > 0;
  return hasVisible || hasDeck;
}

function canBuyAnyCard(snapshot: GameSnapshot, playerId: string): boolean {
  const player = snapshot.players[playerId];
  const candidateCardIds = [
    ...snapshot.decks.faceUp[1],
    ...snapshot.decks.faceUp[2],
    ...snapshot.decks.faceUp[3],
    ...player.reservedCardIds,
  ];

  return candidateCardIds.some((cardId) => canAffordCard(player, getCardById(cardId)));
}

function hasAnyForcedAction(snapshot: GameSnapshot, playerId: string): boolean {
  return canTakeAnyTokens(snapshot) || canReserveWithGold(snapshot, playerId) || canBuyAnyCard(snapshot, playerId);
}

function resolveCardColor(player: PlayerState, cardId: string): BonusColor {
  return player.dynamicBonusByCardId[cardId] ?? getCardById(cardId).bonuses[0];
}

function grantPrivilege(snapshot: GameSnapshot, receiverId: string, events: GameEvent[], reason: string): void {
  const receiver = snapshot.players[receiverId];
  if (receiver.privileges >= TOTAL_PRIVILEGES) {
    return;
  }

  const commonPool = publicPrivileges(snapshot);
  if (commonPool > 0) {
    receiver.privileges += 1;
    pushEvent(events, "PRIVILEGE_GAINED", `${receiverId} gained 1 privilege from public pool`, { reason });
    return;
  }

  const donorId = getOpponentId(snapshot, receiverId);
  const donor = snapshot.players[donorId];
  if (donor.privileges <= 0) {
    return;
  }

  donor.privileges -= 1;
  receiver.privileges += 1;
  pushEvent(events, "PRIVILEGE_TRANSFERRED", `${receiverId} took 1 privilege from ${donorId}`, { reason, donorId });
}

function enforceTokenLimit(snapshot: GameSnapshot, playerId: string, events: GameEvent[]): void {
  const player = snapshot.players[playerId];
  let overflow = sumTokenCounts(player.tokens) - 10;
  if (overflow <= 0) {
    return;
  }

  const discarded: Partial<Record<TokenColor, number>> = {};
  const discardOrder: TokenColor[] = ["gold", "pearl", "emerald", "sapphire", "ruby", "diamond", "onyx"];

  for (const color of discardOrder) {
    if (overflow <= 0) {
      break;
    }
    const amount = Math.min(player.tokens[color], overflow);
    if (amount <= 0) {
      continue;
    }

    player.tokens[color] -= amount;
    overflow -= amount;
    discarded[color] = amount;

    for (let index = 0; index < amount; index += 1) {
      snapshot.bagTokens.push(color);
    }
  }

  pushEvent(events, "TOKENS_DISCARDED", `${playerId} discarded tokens down to hand limit`, {
    discarded,
  });
}

function evaluateWinCondition(snapshot: GameSnapshot, playerId: string): WinCondition | undefined {
  const player = snapshot.players[playerId];

  if (player.prestige >= 20) {
    return "PRESTIGE_20";
  }

  if (player.crowns >= 10) {
    return "CROWNS_10";
  }

  const prestigeByColor: Record<BonusColor, number> = {
    emerald: 0,
    sapphire: 0,
    ruby: 0,
    diamond: 0,
    onyx: 0,
  };

  for (const cardId of player.ownedCardIds) {
    const card = getCardById(cardId);
    if (card.prestige <= 0) {
      continue;
    }
    const color = resolveCardColor(player, cardId);
    prestigeByColor[color] += card.prestige;
  }

  if (Object.values(prestigeByColor).some((value) => value >= 10)) {
    return "COLOR_PRESTIGE_10";
  }

  return undefined;
}

function awardRoyalCard(snapshot: GameSnapshot, playerId: string, milestone: number, events: GameEvent[]): void {
  const player = snapshot.players[playerId];
  if (player.claimedCrownMilestones.includes(milestone)) {
    return;
  }

  player.claimedCrownMilestones.push(milestone);
  const royalId = snapshot.availableRoyalCardIds.shift();
  if (!royalId) {
    pushEvent(events, "ROYAL_SKIPPED", `${playerId} reached crown milestone with no royal cards left`, { milestone });
    return;
  }

  const royal = ROYAL_CARD_BY_ID[royalId];
  player.royalCardIds.push(royalId);
  player.prestige += royal.prestige;
  player.crowns += royal.crowns;

  switch (royal.effect.type) {
    case "GAIN_PRESTIGE":
      player.prestige += royal.effect.value;
      break;
    case "GAIN_CROWNS":
      player.crowns += royal.effect.value;
      break;
    case "GAIN_PRIVILEGE":
      for (let index = 0; index < royal.effect.value; index += 1) {
        grantPrivilege(snapshot, playerId, events, "royal-effect");
      }
      break;
    default:
      break;
  }

  pushEvent(events, "ROYAL_CLAIMED", `${playerId} claimed royal card ${royalId}`, {
    milestone,
    royalId,
    effect: royal.effect.type,
  });
}

function checkCrownMilestones(snapshot: GameSnapshot, playerId: string, events: GameEvent[]): void {
  const player = snapshot.players[playerId];
  for (const milestone of [3, 6]) {
    if (player.crowns >= milestone && !player.claimedCrownMilestones.includes(milestone)) {
      awardRoyalCard(snapshot, playerId, milestone, events);
    }
  }
}

function refillBoardFromBag(snapshot: GameSnapshot, events: GameEvent[]): void {
  if (snapshot.bagTokens.length === 0) {
    return;
  }

  const rng = mulberry32(hashString(`${snapshot.seed}:bag:${snapshot.actionSeq + 1}`));
  snapshot.bagTokens = shuffle(snapshot.bagTokens, rng);

  let refilled = 0;
  for (const index of BOARD_SPIRAL_ORDER) {
    if (snapshot.bagTokens.length === 0) {
      break;
    }
    if (snapshot.boardTokens[index] !== null) {
      continue;
    }
    const token = snapshot.bagTokens.pop();
    if (!token) {
      break;
    }
    snapshot.boardTokens[index] = token;
    refilled += 1;
  }

  if (refilled > 0) {
    pushEvent(events, "BOARD_REFILLED", `Board refilled with ${refilled} token(s)`, { refilled });
  }
}

function finishTurn(snapshot: GameSnapshot, actorId: string, events: GameEvent[]): void {
  snapshot.phase = "END_TURN_CHECK";
  enforceTokenLimit(snapshot, actorId, events);

  const winCondition = evaluateWinCondition(snapshot, actorId);
  if (winCondition) {
    snapshot.phase = "FINISHED";
    snapshot.winnerId = actorId;
    snapshot.winCondition = winCondition;
    pushEvent(events, "MATCH_FINISHED", `${actorId} won the match`, { winCondition });
    return;
  }

  const actor = snapshot.players[actorId];
  if (actor.extraTurnPending) {
    actor.extraTurnPending = false;
    snapshot.currentPlayerId = actorId;
    pushEvent(events, "EXTRA_TURN", `${actorId} takes an extra turn`);
  } else {
    snapshot.currentPlayerId = getOpponentId(snapshot, actorId);
  }

  snapshot.phase = "OPTIONAL_PRIVILEGE";
}

function applyReserveWithGold(snapshot: GameSnapshot, actorId: string, action: ReserveWithGoldAction, events: GameEvent[]): void {
  const actor = snapshot.players[actorId];

  snapshot.boardTokens[action.goldPosition] = null;
  actor.tokens.gold += 1;

  let reservedCardId: string;
  if (action.source.kind === "open") {
    const level = removeFaceUpCard(snapshot, action.source.cardId);
    reservedCardId = action.source.cardId;
    refillFaceUp(snapshot, level);
  } else {
    const drawn = snapshot.decks.drawPiles[action.source.level].shift();
    if (!drawn) {
      throw new Error("Deck unexpectedly empty while reserving");
    }
    reservedCardId = drawn;
  }

  actor.reservedCardIds.push(reservedCardId);

  pushEvent(events, "CARD_RESERVED", `${actorId} reserved a card`, {
    source: action.source.kind,
    cardId: reservedCardId,
  });
}

function applyBuyCard(snapshot: GameSnapshot, actorId: string, action: BuyCardAction, events: GameEvent[]): void {
  const actor = snapshot.players[actorId];
  const opponent = snapshot.players[getOpponentId(snapshot, actorId)];

  let boughtCardId: string;
  if (action.source.kind === "open") {
    boughtCardId = action.source.cardId;
    const level = removeFaceUpCard(snapshot, boughtCardId);
    refillFaceUp(snapshot, level);
  } else {
    boughtCardId = action.source.cardId;
    const index = actor.reservedCardIds.indexOf(boughtCardId);
    if (index < 0) {
      throw new Error("Reserved card missing while buying");
    }
    actor.reservedCardIds.splice(index, 1);
  }

  const card = getCardById(boughtCardId);
  const spendPlan = computeSpendPlan(actor, card);
  if (!spendPlan) {
    throw new Error("Spend plan missing for buy action");
  }

  for (const color of COST_COLORS) {
    const spent = spendPlan[color];
    if (spent > 0) {
      actor.tokens[color] -= spent;
      for (let index = 0; index < spent; index += 1) {
        snapshot.bagTokens.push(color);
      }
    }
  }
  if (spendPlan.gold > 0) {
    actor.tokens.gold -= spendPlan.gold;
    for (let index = 0; index < spendPlan.gold; index += 1) {
      snapshot.bagTokens.push("gold");
    }
  }

  actor.ownedCardIds.push(boughtCardId);
  for (const bonus of card.bonuses) {
    actor.bonuses[bonus] += 1;
  }
  actor.prestige += card.prestige;
  actor.crowns += card.crowns;

  pushEvent(events, "CARD_BOUGHT", `${actorId} bought card ${boughtCardId}`, {
    cardId: boughtCardId,
    source: action.source.kind,
  });

  switch (card.ability) {
    case "EXTRA_TURN":
      actor.extraTurnPending = true;
      pushEvent(events, "ABILITY_EXTRA_TURN", `${actorId} gained an extra turn`, { cardId: boughtCardId });
      break;
    case "OVERLAY": {
      const targetCardId = action.overlayTargetCardId;
      if (!targetCardId) {
        break;
      }
      const targetColor = resolveCardColor(actor, targetCardId);
      for (const bonus of card.bonuses) {
        actor.bonuses[bonus] -= 1;
      }
      actor.bonuses[targetColor] += card.bonuses.length;
      actor.dynamicBonusByCardId[boughtCardId] = targetColor;
      pushEvent(events, "ABILITY_OVERLAY", `${actorId} changed card color by overlay`, {
        cardId: boughtCardId,
        targetCardId,
        targetColor,
      });
      break;
    }
    case "TAKE_SAME_COLOR_TOKEN": {
      const color = resolveCardColor(actor, boughtCardId);
      const index = snapshot.boardTokens.findIndex((token) => token === color);
      if (index >= 0) {
        snapshot.boardTokens[index] = null;
        actor.tokens[color] += 1;
        pushEvent(events, "ABILITY_TAKE_TOKEN", `${actorId} took a ${color} token`, {
          cardId: boughtCardId,
          color,
        });
      }
      break;
    }
    case "GAIN_PRIVILEGE":
      grantPrivilege(snapshot, actorId, events, "ability-gain-privilege");
      break;
    case "STEAL_TOKEN": {
      const availableColors = [...BONUS_COLORS, "pearl"] as const;
      const requested = action.stealColor;
      const stealColor = requested && requested !== "gold" ? requested : availableColors.find((color) => opponent.tokens[color] > 0);
      if (stealColor && opponent.tokens[stealColor] > 0) {
        opponent.tokens[stealColor] -= 1;
        actor.tokens[stealColor] += 1;
        pushEvent(events, "ABILITY_STEAL_TOKEN", `${actorId} stole 1 ${stealColor} token`, {
          cardId: boughtCardId,
          color: stealColor,
        });
      }
      break;
    }
    default:
      break;
  }

  checkCrownMilestones(snapshot, actorId, events);
}

function validateUsePrivilege(snapshot: GameSnapshot, action: Extract<PlayerAction, { type: "USE_PRIVILEGE" }>, playerId: string): ValidationResult {
  if (snapshot.phase !== "OPTIONAL_PRIVILEGE") {
    return error("INVALID_ACTION", "Privilege action is only allowed at optional privilege phase", snapshot.actionSeq);
  }

  if (action.count !== action.positions.length) {
    return error("INVALID_ACTION", "Privilege count must match selected positions", snapshot.actionSeq);
  }

  if (!uniquePositions(action.positions)) {
    return error("INVALID_ACTION", "Positions must be unique", snapshot.actionSeq);
  }

  const player = snapshot.players[playerId];
  if (player.privileges < action.count) {
    return error("INVALID_ACTION", "Not enough privileges", snapshot.actionSeq);
  }

  for (const index of action.positions) {
    if (!isBoardIndex(index)) {
      return error("INVALID_ACTION", "Invalid board index", snapshot.actionSeq);
    }
    const token = snapshot.boardTokens[index];
    if (!token || token === "gold") {
      return error("INVALID_ACTION", "Privilege cannot take gold or empty slot", snapshot.actionSeq);
    }
  }

  return success();
}

function validateRefill(snapshot: GameSnapshot): ValidationResult {
  if (snapshot.phase !== "OPTIONAL_PRIVILEGE" && snapshot.phase !== "OPTIONAL_REFILL") {
    return error("INVALID_ACTION", "Refill can only be used in optional phases", snapshot.actionSeq);
  }

  if (!canRefillBoard(snapshot)) {
    return error("INVALID_ACTION", "Board cannot be refilled right now", snapshot.actionSeq);
  }

  return success();
}

function validateTakeTokens(
  snapshot: GameSnapshot,
  action: TakeTokensLineAction,
  playerId: string,
): ValidationResult {
  if (!isOptionalOrForcedPhase(snapshot.phase)) {
    return error("INVALID_ACTION", "Token action is not available in current phase", snapshot.actionSeq);
  }

  if (!hasAnyForcedAction(snapshot, playerId) && canRefillBoard(snapshot)) {
    return error("INVALID_ACTION", "No forced action available; refill board first", snapshot.actionSeq);
  }

  if (action.positions.length < 1 || action.positions.length > 3) {
    return error("INVALID_ACTION", "Token action requires 1 to 3 positions", snapshot.actionSeq);
  }

  if (!uniquePositions(action.positions)) {
    return error("INVALID_ACTION", "Positions must be unique", snapshot.actionSeq);
  }

  for (const index of action.positions) {
    if (!isBoardIndex(index)) {
      return error("INVALID_ACTION", "Invalid board index", snapshot.actionSeq);
    }
    const token = snapshot.boardTokens[index];
    if (!token || token === "gold") {
      return error("INVALID_ACTION", "Cannot take empty or gold token by line action", snapshot.actionSeq);
    }
  }

  if (!positionsFormStraightLine(action.positions)) {
    return error("INVALID_ACTION", "Chosen positions must form one contiguous straight line", snapshot.actionSeq);
  }

  return success();
}

function validateReserveWithGold(
  snapshot: GameSnapshot,
  action: ReserveWithGoldAction,
  playerId: string,
): ValidationResult {
  if (!isOptionalOrForcedPhase(snapshot.phase)) {
    return error("INVALID_ACTION", "Reserve action is not available in current phase", snapshot.actionSeq);
  }

  if (!hasAnyForcedAction(snapshot, playerId) && canRefillBoard(snapshot)) {
    return error("INVALID_ACTION", "No forced action available; refill board first", snapshot.actionSeq);
  }

  const player = snapshot.players[playerId];
  if (player.reservedCardIds.length >= 3) {
    return error("INVALID_ACTION", "Reserved card limit reached", snapshot.actionSeq);
  }

  if (!isBoardIndex(action.goldPosition) || snapshot.boardTokens[action.goldPosition] !== "gold") {
    return error("INVALID_ACTION", "Selected gold position does not contain gold token", snapshot.actionSeq);
  }

  if (action.source.kind === "open") {
    if (!findFaceUpCard(snapshot, action.source.cardId)) {
      return error("INVALID_ACTION", "Selected face-up card does not exist", snapshot.actionSeq);
    }
  } else if (snapshot.decks.drawPiles[action.source.level].length === 0) {
    return error("INVALID_ACTION", "Selected deck is empty", snapshot.actionSeq);
  }

  return success();
}

function validateBuyCard(snapshot: GameSnapshot, action: BuyCardAction, playerId: string): ValidationResult {
  if (!isOptionalOrForcedPhase(snapshot.phase)) {
    return error("INVALID_ACTION", "Buy action is not available in current phase", snapshot.actionSeq);
  }

  if (!hasAnyForcedAction(snapshot, playerId) && canRefillBoard(snapshot)) {
    return error("INVALID_ACTION", "No forced action available; refill board first", snapshot.actionSeq);
  }

  const player = snapshot.players[playerId];
  let cardId: string;

  if (action.source.kind === "open") {
    if (!findFaceUpCard(snapshot, action.source.cardId)) {
      return error("INVALID_ACTION", "Card is not available in face-up market", snapshot.actionSeq);
    }
    cardId = action.source.cardId;
  } else {
    if (!player.reservedCardIds.includes(action.source.cardId)) {
      return error("INVALID_ACTION", "Card is not in player's reserved area", snapshot.actionSeq);
    }
    cardId = action.source.cardId;
  }

  const card = getCardById(cardId);
  if (!canAffordCard(player, card)) {
    return error("INVALID_ACTION", "Player cannot afford this card", snapshot.actionSeq);
  }

  if (card.ability === "OVERLAY") {
    if (!action.overlayTargetCardId) {
      return error("INVALID_ACTION", "Overlay card requires overlayTargetCardId", snapshot.actionSeq);
    }
    if (!player.ownedCardIds.includes(action.overlayTargetCardId)) {
      return error("INVALID_ACTION", "Overlay target card must be owned by current player", snapshot.actionSeq);
    }
    const target = getCardById(action.overlayTargetCardId);
    if (target.bonuses.length === 0) {
      return error("INVALID_ACTION", "Overlay target card must provide bonus color", snapshot.actionSeq);
    }
  }

  if (card.ability === "STEAL_TOKEN" && action.stealColor === "gold") {
    return error("INVALID_ACTION", "Steal ability cannot target gold", snapshot.actionSeq);
  }

  return success();
}

export function createInitialState(seed: string, players: PlayerInfo[]): GameSnapshot {
  if (players.length !== 2) {
    throw new Error("Splendor Duel requires exactly 2 players");
  }
  if (players[0].id === players[1].id) {
    throw new Error("Players must have different ids");
  }

  const normalizedSeed = normalizeSeed(seed);
  const firstPickRng = mulberry32(hashString(`first:${normalizedSeed}`));
  const playerOrder: [PlayerInfo, PlayerInfo] =
    firstPickRng() >= 0.5 ? [players[0], players[1]] : [players[1], players[0]];

  const first = playerOrder[0];
  const second = playerOrder[1];

  const firstPlayer = initPlayer(first);
  const secondPlayer = initPlayer(second);
  secondPlayer.privileges = 1;

  const startedAt = nowIso();

  return {
    matchId: "",
    seed: normalizedSeed,
    actionSeq: 0,
    phase: "OPTIONAL_PRIVILEGE",
    currentPlayerId: first.id,
    playerOrder: [first.id, second.id],
    boardTokens: createBoardTokens(normalizedSeed),
    bagTokens: [],
    decks: createDeckState(normalizedSeed),
    availableRoyalCardIds: createRoyalDeck(normalizedSeed),
    players: {
      [first.id]: firstPlayer,
      [second.id]: secondPlayer,
    },
    startedAt,
    updatedAt: startedAt,
  };
}

export function validateAction(snapshot: GameSnapshot, action: PlayerAction, playerId: string): ValidationResult {
  if (snapshot.phase === "FINISHED") {
    return error("INVALID_ACTION", "Match already finished", snapshot.actionSeq);
  }

  if (action.expectedActionSeq !== snapshot.actionSeq) {
    return error("ACTION_SEQ_MISMATCH", `Expected actionSeq ${snapshot.actionSeq}`, snapshot.actionSeq);
  }

  if (action.type !== "RESIGN" && snapshot.currentPlayerId !== playerId) {
    return error("NOT_YOUR_TURN", "It is not your turn", snapshot.actionSeq);
  }

  if (!snapshot.players[playerId]) {
    return error("FORBIDDEN", "Unknown player", snapshot.actionSeq);
  }

  switch (action.type) {
    case "USE_PRIVILEGE":
      return validateUsePrivilege(snapshot, action, playerId);
    case "REFILL_BOARD":
      return validateRefill(snapshot);
    case "TAKE_TOKENS_LINE":
      return validateTakeTokens(snapshot, action, playerId);
    case "RESERVE_WITH_GOLD":
      return validateReserveWithGold(snapshot, action, playerId);
    case "BUY_CARD":
      return validateBuyCard(snapshot, action, playerId);
    case "RESIGN":
      return success();
    default:
      return error("INVALID_ACTION", "Unsupported action", snapshot.actionSeq);
  }
}

export function applyAction(snapshot: GameSnapshot, action: PlayerAction, playerId: string): { nextState: GameSnapshot; events: GameEvent[] } {
  const check = validateAction(snapshot, action, playerId);
  if (!check.ok) {
    throw new EngineValidationError(
      check.error ?? {
        code: "INVALID_ACTION",
        message: "Invalid action",
      },
    );
  }

  const next = cloneSnapshot(snapshot);
  const events: GameEvent[] = [];
  const actor = next.players[playerId];

  switch (action.type) {
    case "USE_PRIVILEGE": {
      actor.privileges -= action.count;
      for (const index of action.positions) {
        const token = next.boardTokens[index];
        if (!token || token === "gold") {
          throw new Error("Unexpected token while applying USE_PRIVILEGE");
        }
        next.boardTokens[index] = null;
        actor.tokens[token] += 1;
      }
      next.phase = "OPTIONAL_REFILL";
      pushEvent(events, "PRIVILEGE_SPENT", `${playerId} spent privileges to take tokens`, {
        count: action.count,
        positions: action.positions,
      });
      break;
    }

    case "REFILL_BOARD": {
      refillBoardFromBag(next, events);
      grantPrivilege(next, getOpponentId(next, playerId), events, "refill-board");
      next.phase = "FORCED_ACTION";
      break;
    }

    case "TAKE_TOKENS_LINE": {
      const colors: Exclude<TokenColor, "gold">[] = [];
      for (const index of action.positions) {
        const token = next.boardTokens[index];
        if (!token || token === "gold") {
          throw new Error("Unexpected token while applying TAKE_TOKENS_LINE");
        }
        next.boardTokens[index] = null;
        actor.tokens[token] += 1;
        colors.push(token);
      }

      if (colors.length === 3 && colors[0] === colors[1] && colors[1] === colors[2] && colors[0] !== "pearl") {
        grantPrivilege(next, getOpponentId(next, playerId), events, "three-same-color");
      }
      if (colors.length === 2 && colors[0] === "pearl" && colors[1] === "pearl") {
        grantPrivilege(next, getOpponentId(next, playerId), events, "two-pearls");
      }

      next.phase = "RESOLVE_EFFECTS";
      finishTurn(next, playerId, events);
      break;
    }

    case "RESERVE_WITH_GOLD": {
      applyReserveWithGold(next, playerId, action, events);
      next.phase = "RESOLVE_EFFECTS";
      finishTurn(next, playerId, events);
      break;
    }

    case "BUY_CARD": {
      applyBuyCard(next, playerId, action, events);
      next.phase = "RESOLVE_EFFECTS";
      finishTurn(next, playerId, events);
      break;
    }

    case "RESIGN": {
      const winnerId = getOpponentId(next, playerId);
      next.phase = "FINISHED";
      next.winnerId = winnerId;
      next.winCondition = "OPPONENT_RESIGNED";
      pushEvent(events, "MATCH_FINISHED", `${playerId} resigned`, {
        winnerId,
      });
      break;
    }

    default:
      throw new Error("Unknown action type");
  }

  next.actionSeq += 1;
  next.updatedAt = nowIso();

  return {
    nextState: next,
    events,
  };
}

export function toActionResult(snapshot: GameSnapshot, action: PlayerAction, actorId: string, events: GameEvent[]): ActionResult {
  return {
    actionSeq: snapshot.actionSeq,
    actorId,
    actionType: action.type,
    timestamp: snapshot.updatedAt,
    events,
    snapshot,
  };
}

export function seedMatchId(seed: string): string {
  return `m_${hashString(seed).toString(36)}`;
}

export function cardLevel(cardId: string): CardLevel {
  return cardLevelFromId(cardId);
}
