import { Injectable, ForbiddenException, NotFoundException, TooManyRequestsException } from "@nestjs/common";
import { applyAction, EngineValidationError, createInitialState, toActionResult } from "@splendor/engine";
import {
  TURN_TIMEOUT_SECONDS,
  type ActionResult,
  type GameSnapshot,
  type MatchEventRecord,
  type MatchSummary,
  type PlayerAction,
  type ProtocolError,
  type RoomState,
} from "@splendor/shared";
import { randomUUID } from "node:crypto";
import type { AuthedUser } from "../common/authed-user";
import { SlidingWindowLimiter } from "./rate-limiter";

interface RoomMember {
  userId: string;
  name: string;
  ready: boolean;
  connected: boolean;
}

interface RoomRecord {
  code: string;
  hostUserId: string;
  status: RoomState["status"];
  players: RoomMember[];
  matchId?: string;
  createdAt: string;
}

interface MatchRecord {
  id: string;
  roomCode: string;
  snapshot: GameSnapshot;
  events: MatchEventRecord[];
  idempotency: Map<string, ActionResult>;
  startedAt: string;
  finishedAt?: string;
}

interface SubmitActionResponse {
  roomCode: string;
  result?: ActionResult;
  cached?: boolean;
  error?: ProtocolError;
  snapshot?: GameSnapshot;
}

@Injectable()
export class GameService {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly matches = new Map<string, MatchRecord>();
  private readonly historyByUserId = new Map<string, MatchSummary[]>();

  private readonly roomLimiter = new SlidingWindowLimiter();
  private readonly actionLimiter = new SlidingWindowLimiter();

  createRoom(user: AuthedUser): RoomState {
    this.assertRoomRate(user.id);

    const code = this.generateRoomCode();
    const now = new Date().toISOString();
    const room: RoomRecord = {
      code,
      hostUserId: user.id,
      status: "WAITING",
      players: [
        {
          userId: user.id,
          name: user.name,
          ready: false,
          connected: true,
        },
      ],
      createdAt: now,
    };

    this.rooms.set(code, room);
    return this.toRoomState(room);
  }

  joinRoom(roomCode: string, user: AuthedUser): RoomState {
    this.assertRoomRate(user.id);
    const room = this.getRoomOrThrow(roomCode);

    const existing = room.players.find((player) => player.userId === user.id);
    if (existing) {
      existing.connected = true;
      return this.toRoomState(room);
    }

    if (room.players.length >= 2) {
      throw new ForbiddenException("Room is full");
    }

    room.players.push({
      userId: user.id,
      name: user.name,
      ready: false,
      connected: true,
    });

    room.status = room.players.length === 2 ? "READY" : "WAITING";
    return this.toRoomState(room);
  }

  getRoomState(roomCode: string, requesterUserId: string): RoomState {
    const room = this.getRoomOrThrow(roomCode);
    this.assertRoomMember(room, requesterUserId);
    return this.toRoomState(room);
  }

  setReady(roomCode: string, userId: string, ready: boolean): { roomState: RoomState; startedMatchSnapshot?: GameSnapshot } {
    const room = this.getRoomOrThrow(roomCode);
    const player = room.players.find((member) => member.userId === userId);
    if (!player) {
      throw new ForbiddenException("User is not in room");
    }

    player.ready = ready;

    if (room.players.length === 2 && room.players.every((member) => member.ready) && !room.matchId) {
      const match = this.startMatch(room);
      return {
        roomState: this.toRoomState(room),
        startedMatchSnapshot: match.snapshot,
      };
    }

    room.status = room.players.length === 2 ? "READY" : "WAITING";
    return {
      roomState: this.toRoomState(room),
    };
  }

  getMatchSnapshot(matchId: string, requesterUserId: string): GameSnapshot {
    const match = this.getMatchOrThrow(matchId);
    this.assertMatchMember(match, requesterUserId);
    return match.snapshot;
  }

  getMatchDetail(matchId: string, requesterUserId: string): { snapshot: GameSnapshot; events: MatchEventRecord[] } {
    const match = this.getMatchOrThrow(matchId);
    this.assertMatchMember(match, requesterUserId);
    return {
      snapshot: match.snapshot,
      events: match.events,
    };
  }

  submitAction(matchId: string, userId: string, action: PlayerAction): SubmitActionResponse {
    const match = this.getMatchOrThrow(matchId);
    this.assertMatchMember(match, userId);

    const idempotencyKey = `${userId}:${action.clientActionId}`;
    const cached = match.idempotency.get(idempotencyKey);
    if (cached) {
      return {
        roomCode: match.roomCode,
        result: cached,
        cached: true,
      };
    }

    try {
      const previousPhase = match.snapshot.phase;
      const { nextState, events } = applyAction(match.snapshot, action, userId);

      if (nextState.phase !== "FINISHED" && this.shouldResetTurnDeadline(action.type, previousPhase, nextState.phase)) {
        nextState.turnDeadlineAt = this.turnDeadlineIso();
      }

      match.snapshot = nextState;
      const result = toActionResult(nextState, action, userId, events);

      const eventRecord: MatchEventRecord = {
        actionSeq: result.actionSeq,
        actorId: userId,
        action,
        events,
        createdAt: result.timestamp,
      };

      match.events.push(eventRecord);
      match.idempotency.set(idempotencyKey, result);

      if (nextState.phase === "FINISHED") {
        this.finalizeMatch(match);
      }

      return {
        roomCode: match.roomCode,
        result,
      };
    } catch (error) {
      if (error instanceof EngineValidationError) {
        return {
          roomCode: match.roomCode,
          error: error.protocolError,
          snapshot: match.snapshot,
        };
      }

      return {
        roomCode: match.roomCode,
        error: {
          code: "SERVER_ERROR",
          message: "Unexpected server error",
        },
        snapshot: match.snapshot,
      };
    }
  }

  forceTimeoutLoss(matchId: string, loserId: string): { roomCode: string; snapshot: GameSnapshot } | null {
    const match = this.matches.get(matchId);
    if (!match) {
      return null;
    }

    if (match.snapshot.phase === "FINISHED") {
      return {
        roomCode: match.roomCode,
        snapshot: match.snapshot,
      };
    }

    if (!match.snapshot.playerOrder.includes(loserId)) {
      return null;
    }

    const winnerId = match.snapshot.playerOrder.find((playerId) => playerId !== loserId);
    if (!winnerId) {
      return null;
    }

    const snapshot = structuredClone(match.snapshot);
    snapshot.phase = "FINISHED";
    snapshot.winnerId = winnerId;
    snapshot.winCondition = "OPPONENT_TIMEOUT";
    snapshot.turnDeadlineAt = undefined;
    snapshot.actionSeq += 1;
    snapshot.updatedAt = new Date().toISOString();

    match.snapshot = snapshot;

    const timeoutAction: PlayerAction = {
      type: "RESIGN",
      clientActionId: `timeout-${Date.now()}`,
      expectedActionSeq: snapshot.actionSeq - 1,
      reason: "turn-timeout",
    };

    match.events.push({
      actionSeq: snapshot.actionSeq,
      actorId: loserId,
      action: timeoutAction,
      createdAt: snapshot.updatedAt,
      events: [
        {
          type: "MATCH_FINISHED",
          message: `${loserId} lost by timeout`,
          payload: {
            winnerId,
          },
        },
      ],
    });

    this.finalizeMatch(match);

    return {
      roomCode: match.roomCode,
      snapshot,
    };
  }

  setUserConnection(userId: string, connected: boolean): { roomStates: RoomState[]; activeMatchIds: string[] } {
    const roomStates: RoomState[] = [];
    const activeMatchIds: string[] = [];

    for (const room of this.rooms.values()) {
      const member = room.players.find((player) => player.userId === userId);
      if (!member) {
        continue;
      }

      member.connected = connected;
      roomStates.push(this.toRoomState(room));

      if (room.matchId) {
        const match = this.matches.get(room.matchId);
        if (match && match.snapshot.phase !== "FINISHED") {
          const matchPlayer = match.snapshot.players[userId];
          if (matchPlayer) {
            matchPlayer.disconnectedAt = connected ? undefined : new Date().toISOString();
            match.snapshot.updatedAt = new Date().toISOString();
          }
          activeMatchIds.push(match.id);
        }
      }
    }

    return { roomStates, activeMatchIds };
  }

  getRoomCodeByMatchId(matchId: string): string | null {
    const match = this.matches.get(matchId);
    return match?.roomCode ?? null;
  }

  getHistory(userId: string, cursorRaw?: string): { items: MatchSummary[]; nextCursor?: string } {
    const all = this.historyByUserId.get(userId) ?? [];
    const cursor = Math.max(Number.parseInt(cursorRaw ?? "0", 10) || 0, 0);
    const pageSize = 20;
    const items = all.slice(cursor, cursor + pageSize);
    const nextCursor = cursor + pageSize < all.length ? String(cursor + pageSize) : undefined;

    return {
      items,
      nextCursor,
    };
  }

  allowActionRate(connectionId: string): boolean {
    return this.actionLimiter.allow(`action:${connectionId}`, 30, 60_000);
  }

  private shouldResetTurnDeadline(actionType: PlayerAction["type"], previousPhase: GameSnapshot["phase"], nextPhase: GameSnapshot["phase"]): boolean {
    if (actionType === "TAKE_TOKENS_LINE" || actionType === "RESERVE_WITH_GOLD" || actionType === "BUY_CARD") {
      return true;
    }

    if (previousPhase !== "OPTIONAL_PRIVILEGE" && nextPhase === "OPTIONAL_PRIVILEGE") {
      return true;
    }

    return false;
  }

  private finalizeMatch(match: MatchRecord): void {
    if (match.finishedAt) {
      return;
    }

    const endedAt = new Date().toISOString();
    match.finishedAt = endedAt;

    const room = this.rooms.get(match.roomCode);
    if (room) {
      room.status = "FINISHED";
    }

    const durationSeconds = Math.max(
      1,
      Math.floor((Date.parse(endedAt) - Date.parse(match.startedAt)) / 1000),
    );

    for (const userId of match.snapshot.playerOrder) {
      const list = this.historyByUserId.get(userId) ?? [];
      const summary: MatchSummary = {
        matchId: match.id,
        roomCode: match.roomCode,
        startedAt: match.startedAt,
        endedAt,
        durationSeconds,
        winnerId: match.snapshot.winnerId,
        winCondition: match.snapshot.winCondition,
        resultForMe: match.snapshot.winnerId === userId ? "WIN" : "LOSE",
      };

      list.unshift(summary);
      this.historyByUserId.set(userId, list.slice(0, 200));
    }
  }

  private startMatch(room: RoomRecord): MatchRecord {
    const seed = `${room.code}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    const players = room.players.slice(0, 2).map((player) => ({
      id: player.userId,
      name: player.name,
    }));

    const snapshot = createInitialState(seed, players);
    const matchId = `m_${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    snapshot.matchId = matchId;
    snapshot.turnDeadlineAt = this.turnDeadlineIso();
    snapshot.updatedAt = now;

    const match: MatchRecord = {
      id: matchId,
      roomCode: room.code,
      snapshot,
      events: [],
      idempotency: new Map(),
      startedAt: now,
    };

    this.matches.set(matchId, match);
    room.matchId = matchId;
    room.status = "IN_MATCH";

    return match;
  }

  private turnDeadlineIso(): string {
    return new Date(Date.now() + TURN_TIMEOUT_SECONDS * 1000).toISOString();
  }

  private toRoomState(room: RoomRecord): RoomState {
    return {
      code: room.code,
      status: room.status,
      hostUserId: room.hostUserId,
      players: room.players.map((player) => ({
        userId: player.userId,
        name: player.name,
        ready: player.ready,
        connected: player.connected,
      })),
      matchId: room.matchId,
      createdAt: room.createdAt,
    };
  }

  private getRoomOrThrow(roomCode: string): RoomRecord {
    const normalizedCode = roomCode.trim().toUpperCase();
    const room = this.rooms.get(normalizedCode);
    if (!room) {
      throw new NotFoundException("Room not found");
    }
    return room;
  }

  private getMatchOrThrow(matchId: string): MatchRecord {
    const match = this.matches.get(matchId);
    if (!match) {
      throw new NotFoundException("Match not found");
    }
    return match;
  }

  private assertRoomMember(room: RoomRecord, userId: string): void {
    const isMember = room.players.some((player) => player.userId === userId);
    if (!isMember) {
      throw new ForbiddenException("User is not a room member");
    }
  }

  private assertMatchMember(match: MatchRecord, userId: string): void {
    const isMember = match.snapshot.playerOrder.includes(userId);
    if (!isMember) {
      throw new ForbiddenException("User is not in match");
    }
  }

  private assertRoomRate(userId: string): void {
    if (!this.roomLimiter.allow(`room:${userId}`, 10, 60_000)) {
      throw new TooManyRequestsException("Too many room operations");
    }
  }

  private generateRoomCode(): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      let code = "";
      for (let index = 0; index < 6; index += 1) {
        const pick = Math.floor(Math.random() * alphabet.length);
        code += alphabet[pick];
      }

      if (!this.rooms.has(code)) {
        return code;
      }
    }

    throw new Error("Failed to generate unique room code");
  }
}
