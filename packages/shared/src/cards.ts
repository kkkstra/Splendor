import { BONUS_COLORS } from "./constants";
import type { BonusColor, CardCost, CardLevel, JewelCard, RoyalCard } from "./protocol";

const LEVEL_COUNTS: Record<CardLevel, number> = {
  1: 30,
  2: 24,
  3: 13,
};

const ABILITY_CYCLE = [
  undefined,
  undefined,
  "GAIN_PRIVILEGE",
  undefined,
  "TAKE_SAME_COLOR_TOKEN",
  undefined,
  "STEAL_TOKEN",
  undefined,
  "OVERLAY",
  undefined,
  "EXTRA_TURN",
] as const;

function makeCost(level: CardLevel, index: number): CardCost {
  const colorA = BONUS_COLORS[index % BONUS_COLORS.length];
  const colorB = BONUS_COLORS[(index + 2) % BONUS_COLORS.length];
  const base = level === 1 ? 1 : level === 2 ? 2 : 3;

  if (index % 7 === 0) {
    return {
      [colorA]: base + 1,
      pearl: level === 1 ? 0 : 1,
    };
  }

  return {
    [colorA]: base,
    [colorB]: base - 1,
    pearl: level === 3 && index % 2 === 0 ? 1 : 0,
  };
}

function cleanCost(cost: CardCost): CardCost {
  const entries = Object.entries(cost).filter(([, value]) => (value ?? 0) > 0);
  return Object.fromEntries(entries) as CardCost;
}

function makeBonuses(level: CardLevel, index: number): BonusColor[] {
  const base = BONUS_COLORS[index % BONUS_COLORS.length];
  if (level >= 2 && index % 9 === 0) {
    return [base, BONUS_COLORS[(index + 1) % BONUS_COLORS.length]];
  }
  return [base];
}

export function createJewelCards(): JewelCard[] {
  const cards: JewelCard[] = [];

  for (const level of [1, 2, 3] as const) {
    const count = LEVEL_COUNTS[level];
    for (let index = 0; index < count; index += 1) {
      const id = `L${level}-${String(index + 1).padStart(2, "0")}`;
      const prestige = level === 1 ? (index % 8 === 0 ? 1 : 0) : level === 2 ? (index % 3 === 0 ? 2 : 1) : 3 + (index % 2);
      const crowns = level === 1 ? (index % 10 === 0 ? 1 : 0) : level === 2 ? (index % 4 === 0 ? 1 : 0) : 1 + (index % 3 === 0 ? 1 : 0);
      const ability = ABILITY_CYCLE[(index + level) % ABILITY_CYCLE.length];

      cards.push({
        id,
        level,
        prestige,
        crowns,
        bonuses: makeBonuses(level, index),
        cost: cleanCost(makeCost(level, index)),
        ability,
      });
    }
  }

  return cards;
}

export function createRoyalCards(): RoyalCard[] {
  return [
    {
      id: "R-01",
      prestige: 2,
      crowns: 1,
      effect: { type: "GAIN_PRIVILEGE", value: 1 },
    },
    {
      id: "R-02",
      prestige: 3,
      crowns: 0,
      effect: { type: "GAIN_PRESTIGE", value: 1 },
    },
    {
      id: "R-03",
      prestige: 1,
      crowns: 2,
      effect: { type: "GAIN_CROWNS", value: 1 },
    },
    {
      id: "R-04",
      prestige: 2,
      crowns: 1,
      effect: { type: "GAIN_PRESTIGE", value: 2 },
    },
  ];
}

export const JEWEL_CARDS = createJewelCards();
export const JEWEL_CARD_BY_ID = Object.fromEntries(JEWEL_CARDS.map((card) => [card.id, card])) as Record<string, JewelCard>;

export const ROYAL_CARDS = createRoyalCards();
export const ROYAL_CARD_BY_ID = Object.fromEntries(ROYAL_CARDS.map((card) => [card.id, card])) as Record<string, RoyalCard>;
