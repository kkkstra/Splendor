import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import {
  RECONNECT_GRACE_SECONDS,
  TURN_TIMEOUT_SECONDS,
  matchActionSchema,
  matchResignSchema,
  matchSyncSchema,
  roomReadySchema,
  roomSubscribeSchema,
  type MatchSummary,
  type PlayerAction,
  type ProtocolError,
} from "@splendor/shared";
import type { Server, Socket } from "socket.io";
import { AuthService } from "../auth/auth.service";
import type { AuthedUser } from "../common/authed-user";
import { GameService } from "./game.service";

@WebSocketGateway({
  namespace: "/ws/game",
  cors: {
    origin: true,
    credentials: true,
  },
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly socketUserMap = new Map<string, AuthedUser>();
  private readonly userConnectionCount = new Map<string, number>();

  private readonly reconnectTimers = new Map<string, NodeJS.Timeout>();
  private readonly turnTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly authService: AuthService,
    private readonly gameService: GameService,
  ) {}

  handleConnection(client: Socket): void {
    const token = this.extractToken(client);
    if (!token) {
      client.disconnect(true);
      return;
    }

    const user = this.authService.verifyToken(token);
    if (!user) {
      client.disconnect(true);
      return;
    }

    this.socketUserMap.set(client.id, user);

    const previousCount = this.userConnectionCount.get(user.id) ?? 0;
    this.userConnectionCount.set(user.id, previousCount + 1);

    if (previousCount === 0) {
      const updates = this.gameService.setUserConnection(user.id, true);
      for (const roomState of updates.roomStates) {
        this.server.to(this.roomChannel(roomState.code)).emit("room.state", roomState);
      }

      for (const matchId of updates.activeMatchIds) {
        const key = this.reconnectTimerKey(matchId, user.id);
        const timer = this.reconnectTimers.get(key);
        if (timer) {
          clearTimeout(timer);
          this.reconnectTimers.delete(key);
        }
      }
    }
  }

  handleDisconnect(client: Socket): void {
    const user = this.socketUserMap.get(client.id);
    this.socketUserMap.delete(client.id);
    if (!user) {
      return;
    }

    const previousCount = this.userConnectionCount.get(user.id) ?? 0;
    const nextCount = Math.max(0, previousCount - 1);
    if (nextCount > 0) {
      this.userConnectionCount.set(user.id, nextCount);
      return;
    }
    this.userConnectionCount.delete(user.id);

    const updates = this.gameService.setUserConnection(user.id, false);
    for (const roomState of updates.roomStates) {
      this.server.to(this.roomChannel(roomState.code)).emit("room.state", roomState);
    }

    for (const matchId of updates.activeMatchIds) {
      const key = this.reconnectTimerKey(matchId, user.id);
      const timer = setTimeout(() => {
        this.reconnectTimers.delete(key);
        const outcome = this.gameService.forceTimeoutLoss(matchId, user.id);
        if (!outcome) {
          return;
        }

        this.clearTurnTimer(matchId);
        const roomChannel = this.roomChannel(outcome.roomCode);
        this.server.to(roomChannel).emit("match.snapshot", outcome.snapshot);
        this.server.to(roomChannel).emit("match.finished", {
          matchId,
          winnerId: outcome.snapshot.winnerId,
          winCondition: outcome.snapshot.winCondition,
        } satisfies Partial<MatchSummary>);
      }, RECONNECT_GRACE_SECONDS * 1000);

      this.reconnectTimers.set(key, timer);
    }
  }

  @SubscribeMessage("room.subscribe")
  onRoomSubscribe(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown): void {
    const parsed = roomSubscribeSchema.safeParse(payload);
    if (!parsed.success) {
      this.emitProtocolError(client, {
        code: "INVALID_ACTION",
        message: parsed.error.issues[0]?.message ?? "Invalid room.subscribe payload",
      });
      return;
    }

    const user = this.getSocketUser(client);
    if (!user) {
      this.emitProtocolError(client, {
        code: "UNAUTHORIZED",
        message: "Unauthorized socket",
      });
      return;
    }

    try {
      const roomState = this.gameService.getRoomState(parsed.data.roomCode, user.id);
      const channel = this.roomChannel(roomState.code);
      client.join(channel);
      this.server.to(channel).emit("room.state", roomState);

      if (roomState.matchId) {
        const snapshot = this.gameService.getMatchSnapshot(roomState.matchId, user.id);
        client.emit("match.snapshot", snapshot);
      }
    } catch (error) {
      this.emitProtocolError(client, {
        code: "ROOM_NOT_FOUND",
        message: error instanceof Error ? error.message : "Room subscribe failed",
      });
    }
  }

  @SubscribeMessage("room.ready")
  onRoomReady(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown): void {
    const parsed = roomReadySchema.safeParse(payload);
    if (!parsed.success) {
      this.emitProtocolError(client, {
        code: "INVALID_ACTION",
        message: parsed.error.issues[0]?.message ?? "Invalid room.ready payload",
      });
      return;
    }

    const user = this.getSocketUser(client);
    if (!user) {
      this.emitProtocolError(client, {
        code: "UNAUTHORIZED",
        message: "Unauthorized socket",
      });
      return;
    }

    try {
      const result = this.gameService.setReady(parsed.data.roomCode, user.id, parsed.data.ready);
      const channel = this.roomChannel(result.roomState.code);
      client.join(channel);
      this.server.to(channel).emit("room.state", result.roomState);

      if (result.startedMatchSnapshot) {
        this.server.to(channel).emit("match.snapshot", result.startedMatchSnapshot);
        this.server.to(channel).emit("match.event", {
          type: "MATCH_STARTED",
          matchId: result.startedMatchSnapshot.matchId,
        });
        this.scheduleTurnTimer(result.startedMatchSnapshot.matchId, result.startedMatchSnapshot.currentPlayerId);
      }
    } catch (error) {
      this.emitProtocolError(client, {
        code: "INVALID_ACTION",
        message: error instanceof Error ? error.message : "Failed to set ready",
      });
    }
  }

  @SubscribeMessage("match.sync")
  onMatchSync(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown): void {
    const parsed = matchSyncSchema.safeParse(payload);
    if (!parsed.success) {
      this.emitProtocolError(client, {
        code: "INVALID_ACTION",
        message: parsed.error.issues[0]?.message ?? "Invalid match.sync payload",
      });
      return;
    }

    const user = this.getSocketUser(client);
    if (!user) {
      this.emitProtocolError(client, {
        code: "UNAUTHORIZED",
        message: "Unauthorized socket",
      });
      return;
    }

    try {
      const snapshot = this.gameService.getMatchSnapshot(parsed.data.matchId, user.id);
      client.emit("match.snapshot", snapshot);
    } catch (error) {
      this.emitProtocolError(client, {
        code: "MATCH_NOT_FOUND",
        message: error instanceof Error ? error.message : "Match not found",
      });
    }
  }

  @SubscribeMessage("match.action")
  onMatchAction(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown): void {
    const parsed = matchActionSchema.safeParse(payload);
    if (!parsed.success) {
      this.emitProtocolError(client, {
        code: "INVALID_ACTION",
        message: parsed.error.issues[0]?.message ?? "Invalid match.action payload",
      });
      return;
    }

    const user = this.getSocketUser(client);
    if (!user) {
      this.emitProtocolError(client, {
        code: "UNAUTHORIZED",
        message: "Unauthorized socket",
      });
      return;
    }

    if (!this.gameService.allowActionRate(client.id)) {
      this.emitProtocolError(client, {
        code: "RATE_LIMITED",
        message: "Too many actions per minute",
      });
      return;
    }

    const { matchId, action } = parsed.data;
    const handled = this.gameService.submitAction(matchId, user.id, action);

    if (handled.error || !handled.result) {
      this.emitProtocolError(client, handled.error ?? { code: "SERVER_ERROR", message: "Unknown error" });
      if (handled.snapshot) {
        client.emit("match.snapshot", handled.snapshot);
      }
      return;
    }

    const roomChannel = this.roomChannel(handled.roomCode);
    this.server.to(roomChannel).emit("match.event", {
      actionSeq: handled.result.actionSeq,
      actorId: handled.result.actorId,
      actionType: handled.result.actionType,
      events: handled.result.events,
    });
    this.server.to(roomChannel).emit("match.snapshot", handled.result.snapshot);

    if (handled.result.snapshot.phase === "FINISHED") {
      this.clearTurnTimer(matchId);
      this.server.to(roomChannel).emit("match.finished", {
        matchId,
        winnerId: handled.result.snapshot.winnerId,
        winCondition: handled.result.snapshot.winCondition,
      } satisfies Partial<MatchSummary>);
      return;
    }

    if (this.turnEndsWithAction(action.type)) {
      this.scheduleTurnTimer(matchId, handled.result.snapshot.currentPlayerId);
    }
  }

  @SubscribeMessage("match.resign")
  onMatchResign(@ConnectedSocket() client: Socket, @MessageBody() payload: unknown): void {
    const parsed = matchResignSchema.safeParse(payload);
    if (!parsed.success) {
      this.emitProtocolError(client, {
        code: "INVALID_ACTION",
        message: parsed.error.issues[0]?.message ?? "Invalid match.resign payload",
      });
      return;
    }

    const resignAction: PlayerAction = {
      type: "RESIGN",
      clientActionId: parsed.data.clientActionId,
      expectedActionSeq: parsed.data.expectedActionSeq,
      reason: "manual-resign",
    };

    this.onMatchAction(client, {
      matchId: parsed.data.matchId,
      action: resignAction,
    });
  }

  private turnEndsWithAction(actionType: PlayerAction["type"]): boolean {
    return actionType === "TAKE_TOKENS_LINE" || actionType === "RESERVE_WITH_GOLD" || actionType === "BUY_CARD";
  }

  private scheduleTurnTimer(matchId: string, expectedCurrentPlayerId: string): void {
    this.clearTurnTimer(matchId);

    const timer = setTimeout(() => {
      const timeoutResult = this.gameService.forceTimeoutLoss(matchId, expectedCurrentPlayerId);
      if (!timeoutResult) {
        return;
      }

      this.clearTurnTimer(matchId);
      const roomChannel = this.roomChannel(timeoutResult.roomCode);
      this.server.to(roomChannel).emit("match.snapshot", timeoutResult.snapshot);
      this.server.to(roomChannel).emit("match.finished", {
        matchId,
        winnerId: timeoutResult.snapshot.winnerId,
        winCondition: timeoutResult.snapshot.winCondition,
      } satisfies Partial<MatchSummary>);
    }, TURN_TIMEOUT_SECONDS * 1000);

    this.turnTimers.set(matchId, timer);
  }

  private clearTurnTimer(matchId: string): void {
    const current = this.turnTimers.get(matchId);
    if (current) {
      clearTimeout(current);
      this.turnTimers.delete(matchId);
    }
  }

  private extractToken(client: Socket): string | null {
    const authToken = typeof client.handshake.auth?.token === "string" ? client.handshake.auth.token : null;
    if (authToken) {
      return authToken;
    }

    const headerToken = client.handshake.headers.authorization;
    if (typeof headerToken === "string" && headerToken.startsWith("Bearer ")) {
      return headerToken.slice("Bearer ".length).trim();
    }

    return null;
  }

  private getSocketUser(client: Socket): AuthedUser | null {
    return this.socketUserMap.get(client.id) ?? null;
  }

  private emitProtocolError(client: Socket, error: ProtocolError): void {
    client.emit("match.error", error);
  }

  private roomChannel(roomCode: string): string {
    return `room:${roomCode}`;
  }

  private reconnectTimerKey(matchId: string, userId: string): string {
    return `${matchId}:${userId}`;
  }
}
