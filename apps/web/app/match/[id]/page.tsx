"use client";

import type { BonusColor, GameSnapshot, PlayerAction, ProtocolError, TokenColor } from "@splendor/shared";
import { BONUS_COLORS } from "@splendor/shared";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { getMatch } from "../../../lib/api";
import { createGameSocket } from "../../../lib/socket";
import { useGameStore } from "../../../store/game";
import { useSessionStore } from "../../../store/session";

function parsePositions(input: string): number[] {
  return input
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 24);
}

export default function MatchPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const matchId = String(params.id ?? "");

  const { token, user } = useSessionStore();
  const { snapshot, setSnapshot, protocolError, setProtocolError, events, pushEvent } = useGameStore();

  const socketRef = useRef<Socket | null>(null);

  const [takePositions, setTakePositions] = useState("0");
  const [privilegeCount, setPrivilegeCount] = useState("1");
  const [privilegePositions, setPrivilegePositions] = useState("0");
  const [goldPosition, setGoldPosition] = useState("0");
  const [reserveSourceKind, setReserveSourceKind] = useState<"open" | "deck">("open");
  const [reserveSourceValue, setReserveSourceValue] = useState("");
  const [buySourceKind, setBuySourceKind] = useState<"open" | "reserved">("open");
  const [buyCardId, setBuyCardId] = useState("");
  const [overlayTargetCardId, setOverlayTargetCardId] = useState("");
  const [stealColor, setStealColor] = useState<Exclude<TokenColor, "gold">>("emerald");
  const [loading, setLoading] = useState(true);

  const me = snapshot && user ? snapshot.players[user.id] : undefined;
  const isMyTurn = snapshot?.currentPlayerId === user?.id;

  const openCards = useMemo(() => {
    if (!snapshot) {
      return [] as string[];
    }
    return [...snapshot.decks.faceUp[1], ...snapshot.decks.faceUp[2], ...snapshot.decks.faceUp[3]];
  }, [snapshot]);

  useEffect(() => {
    if (!token) {
      router.replace("/");
      return;
    }

    let canceled = false;

    const bootstrap = async () => {
      setLoading(true);
      try {
        const detail = await getMatch(token, matchId);
        if (!canceled) {
          setSnapshot(detail.snapshot);
        }
      } catch (error) {
        if (!canceled) {
          setProtocolError({
            code: "MATCH_NOT_FOUND",
            message: error instanceof Error ? error.message : "加载对局失败",
          });
        }
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    };

    bootstrap();

    return () => {
      canceled = true;
    };
  }, [matchId, router, setProtocolError, setSnapshot, token]);

  useEffect(() => {
    if (!token) {
      return;
    }

    const socket = createGameSocket(token);
    socketRef.current = socket;

    socket.on("match.snapshot", (nextSnapshot: GameSnapshot) => {
      if (nextSnapshot.matchId !== matchId) {
        return;
      }
      setSnapshot(nextSnapshot);
    });

    socket.on("match.error", (error: ProtocolError) => {
      setProtocolError(error);
    });

    socket.on("match.event", (event) => {
      pushEvent(event as Record<string, unknown>);
    });

    socket.on("match.finished", () => {
      // snapshot will carry winner and condition
    });

    socket.emit("match.sync", { matchId });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [matchId, pushEvent, setProtocolError, setSnapshot, token]);

  const emitAction = (action: Omit<PlayerAction, "clientActionId" | "expectedActionSeq">) => {
    if (!socketRef.current || !snapshot) {
      return;
    }

    const fullAction: PlayerAction = {
      ...action,
      clientActionId: crypto.randomUUID(),
      expectedActionSeq: snapshot.actionSeq,
    } as PlayerAction;

    socketRef.current.emit("match.action", {
      matchId,
      action: fullAction,
    });
  };

  const onResign = () => {
    if (!socketRef.current || !snapshot) {
      return;
    }
    socketRef.current.emit("match.resign", {
      matchId,
      clientActionId: crypto.randomUUID(),
      expectedActionSeq: snapshot.actionSeq,
    });
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 p-4">
      <section className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
        <h1 className="text-2xl font-bold">对局 {matchId}</h1>
        <p className="text-sm text-gray-700">
          {snapshot
            ? `当前行动方：${snapshot.currentPlayerId} | 阶段：${snapshot.phase} | ActionSeq: ${snapshot.actionSeq}`
            : "正在加载对局..."}
        </p>
      </section>

      {loading ? <p>加载中...</p> : null}

      {protocolError ? (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {protocolError.code}: {protocolError.message}
        </p>
      ) : null}

      {snapshot?.phase === "FINISHED" ? (
        <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-green-800">
          对局结束，胜者：{snapshot.winnerId ?? "未知"}，条件：{snapshot.winCondition ?? "未知"}
        </div>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-2xl border border-amber-200 bg-[var(--card)] p-4">
          <h2 className="mb-3 text-lg font-semibold">棋盘（索引 0-24）</h2>
          <div className="grid grid-cols-5 gap-2">
            {snapshot?.boardTokens.map((token, index) => (
              <div key={index} className="rounded-md border border-amber-300 bg-white p-2 text-center text-sm">
                <p className="text-[11px] text-gray-500">{index}</p>
                <p className="font-medium">{token ?? "-"}</p>
              </div>
            ))}
          </div>

          <h3 className="mt-5 text-sm font-semibold">牌面</h3>
          <div className="mt-2 grid gap-1 text-sm text-gray-700">
            <p>L3: {snapshot?.decks.faceUp[3].join(", ") || "-"}</p>
            <p>L2: {snapshot?.decks.faceUp[2].join(", ") || "-"}</p>
            <p>L1: {snapshot?.decks.faceUp[1].join(", ") || "-"}</p>
          </div>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-[var(--card)] p-4">
          <h2 className="mb-2 text-lg font-semibold">玩家信息</h2>
          {snapshot?.playerOrder.map((playerId) => {
            const player = snapshot.players[playerId];
            return (
              <div key={playerId} className="mb-3 rounded-lg border border-amber-200 bg-white p-3 text-sm">
                <p className="font-semibold">{player.name}</p>
                <p className="text-xs text-gray-500">{playerId}</p>
                <p>声望: {player.prestige} | 王冠: {player.crowns} | 特权: {player.privileges}</p>
                <p>筹码: {Object.entries(player.tokens).map(([color, count]) => `${color}:${count}`).join(" ")}</p>
                <p>预留: {player.reservedCardIds.join(", ") || "-"}</p>
              </div>
            );
          })}
          <button className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" onClick={() => router.push("/")}>返回首页</button>
        </div>
      </section>

      <section className="rounded-2xl border border-amber-200 bg-[var(--card)] p-4">
        <h2 className="mb-3 text-lg font-semibold">动作面板 {isMyTurn ? "(你的回合)" : "(等待对手)"}</h2>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border border-amber-200 bg-white p-3">
            <p className="font-medium">USE_PRIVILEGE</p>
            <input
              className="mt-2 w-full rounded border border-gray-300 px-2 py-1 text-sm"
              placeholder="count"
              value={privilegeCount}
              onChange={(event) => setPrivilegeCount(event.target.value)}
            />
            <input
              className="mt-2 w-full rounded border border-gray-300 px-2 py-1 text-sm"
              placeholder="positions, e.g. 1,2"
              value={privilegePositions}
              onChange={(event) => setPrivilegePositions(event.target.value)}
            />
            <button
              className="mt-2 rounded bg-gray-800 px-3 py-1 text-sm text-white"
              onClick={() =>
                emitAction({
                  type: "USE_PRIVILEGE",
                  count: Number.parseInt(privilegeCount, 10) || 1,
                  positions: parsePositions(privilegePositions),
                })
              }
            >
              提交
            </button>
          </div>

          <div className="rounded-lg border border-amber-200 bg-white p-3">
            <p className="font-medium">REFILL_BOARD</p>
            <button className="mt-2 rounded bg-gray-800 px-3 py-1 text-sm text-white" onClick={() => emitAction({ type: "REFILL_BOARD" })}>
              提交
            </button>

            <p className="mt-4 font-medium">TAKE_TOKENS_LINE</p>
            <input
              className="mt-2 w-full rounded border border-gray-300 px-2 py-1 text-sm"
              placeholder="positions, e.g. 0,1,2"
              value={takePositions}
              onChange={(event) => setTakePositions(event.target.value)}
            />
            <button
              className="mt-2 rounded bg-gray-800 px-3 py-1 text-sm text-white"
              onClick={() =>
                emitAction({
                  type: "TAKE_TOKENS_LINE",
                  positions: parsePositions(takePositions),
                })
              }
            >
              提交
            </button>
          </div>

          <div className="rounded-lg border border-amber-200 bg-white p-3">
            <p className="font-medium">RESERVE_WITH_GOLD</p>
            <input
              className="mt-2 w-full rounded border border-gray-300 px-2 py-1 text-sm"
              placeholder="gold position"
              value={goldPosition}
              onChange={(event) => setGoldPosition(event.target.value)}
            />
            <select
              className="mt-2 w-full rounded border border-gray-300 px-2 py-1 text-sm"
              value={reserveSourceKind}
              onChange={(event) => setReserveSourceKind(event.target.value as "open" | "deck")}
            >
              <option value="open">open</option>
              <option value="deck">deck</option>
            </select>
            <input
              className="mt-2 w-full rounded border border-gray-300 px-2 py-1 text-sm"
              placeholder={reserveSourceKind === "open" ? "cardId" : "level(1/2/3)"}
              value={reserveSourceValue}
              onChange={(event) => setReserveSourceValue(event.target.value)}
            />
            <button
              className="mt-2 rounded bg-gray-800 px-3 py-1 text-sm text-white"
              onClick={() =>
                emitAction({
                  type: "RESERVE_WITH_GOLD",
                  goldPosition: Number.parseInt(goldPosition, 10) || 0,
                  source:
                    reserveSourceKind === "open"
                      ? { kind: "open", cardId: reserveSourceValue || openCards[0] || "" }
                      : {
                          kind: "deck",
                          level: (Number.parseInt(reserveSourceValue, 10) as 1 | 2 | 3) || 1,
                        },
                })
              }
            >
              提交
            </button>
          </div>

          <div className="rounded-lg border border-amber-200 bg-white p-3">
            <p className="font-medium">BUY_CARD</p>
            <select
              className="mt-2 w-full rounded border border-gray-300 px-2 py-1 text-sm"
              value={buySourceKind}
              onChange={(event) => setBuySourceKind(event.target.value as "open" | "reserved")}
            >
              <option value="open">open</option>
              <option value="reserved">reserved</option>
            </select>
            <input
              className="mt-2 w-full rounded border border-gray-300 px-2 py-1 text-sm"
              placeholder="cardId"
              value={buyCardId}
              onChange={(event) => setBuyCardId(event.target.value)}
            />
            <input
              className="mt-2 w-full rounded border border-gray-300 px-2 py-1 text-sm"
              placeholder="overlayTargetCardId(optional)"
              value={overlayTargetCardId}
              onChange={(event) => setOverlayTargetCardId(event.target.value)}
            />
            <select
              className="mt-2 w-full rounded border border-gray-300 px-2 py-1 text-sm"
              value={stealColor}
              onChange={(event) => setStealColor(event.target.value as Exclude<TokenColor, "gold">)}
            >
              {[...BONUS_COLORS, "pearl"].map((color) => (
                <option key={color} value={color}>
                  {color}
                </option>
              ))}
            </select>
            <button
              className="mt-2 rounded bg-gray-800 px-3 py-1 text-sm text-white"
              onClick={() =>
                emitAction({
                  type: "BUY_CARD",
                  source: {
                    kind: buySourceKind,
                    cardId: buyCardId || (buySourceKind === "open" ? openCards[0] : me?.reservedCardIds[0]) || "",
                  },
                  overlayTargetCardId: overlayTargetCardId || undefined,
                  stealColor,
                })
              }
            >
              提交
            </button>
          </div>

          <div className="rounded-lg border border-amber-200 bg-white p-3">
            <p className="font-medium">RESIGN</p>
            <button className="mt-2 rounded bg-red-700 px-3 py-1 text-sm text-white" onClick={onResign}>
              认输
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-amber-200 bg-[var(--card)] p-4">
        <h2 className="mb-2 text-lg font-semibold">最近事件</h2>
        <ul className="space-y-2 text-sm">
          {events.map((event, index) => (
            <li key={index} className="rounded border border-amber-200 bg-white px-3 py-2">
              <pre className="whitespace-pre-wrap break-all">{JSON.stringify(event, null, 2)}</pre>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
