import { describe, expect, it } from "vitest";
import { COST_COLORS, JEWEL_CARD_BY_ID, type GameSnapshot } from "@splendor/shared";
import { applyAction, createInitialState, validateAction } from "../src/index";

function baseSnapshot(): GameSnapshot {
  const state = createInitialState("spec-seed", [
    { id: "u1", name: "P1" },
    { id: "u2", name: "P2" },
  ]);
  state.matchId = "m_test";
  return state;
}

describe("engine", () => {
  it("assigns one initial privilege to second player", () => {
    const snapshot = baseSnapshot();
    const [first, second] = snapshot.playerOrder;

    expect(snapshot.players[first].privileges).toBe(0);
    expect(snapshot.players[second].privileges).toBe(1);
  });

  it("rejects gold in TAKE_TOKENS_LINE", () => {
    const snapshot = baseSnapshot();
    snapshot.phase = "FORCED_ACTION";
    snapshot.currentPlayerId = snapshot.playerOrder[0];
    snapshot.boardTokens = Array(25).fill(null);
    snapshot.boardTokens[0] = "gold";

    const result = validateAction(
      snapshot,
      {
        type: "TAKE_TOKENS_LINE",
        clientActionId: "a1",
        expectedActionSeq: snapshot.actionSeq,
        positions: [0],
      },
      snapshot.currentPlayerId,
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_ACTION");
  });

  it("buys a face-up card when player can afford it", () => {
    const snapshot = baseSnapshot();
    const actorId = snapshot.currentPlayerId;
    const cardId = snapshot.decks.faceUp[1][0];
    const card = JEWEL_CARD_BY_ID[cardId];

    for (const color of COST_COLORS) {
      snapshot.players[actorId].tokens[color] = card.cost[color] ?? 0;
    }
    snapshot.players[actorId].tokens.gold = 0;
    snapshot.phase = "FORCED_ACTION";

    const { nextState } = applyAction(
      snapshot,
      {
        type: "BUY_CARD",
        clientActionId: "a_buy",
        expectedActionSeq: snapshot.actionSeq,
        source: { kind: "open", cardId },
      },
      actorId,
    );

    expect(nextState.players[actorId].ownedCardIds).toContain(cardId);
    expect(nextState.actionSeq).toBe(snapshot.actionSeq + 1);
  });
});
