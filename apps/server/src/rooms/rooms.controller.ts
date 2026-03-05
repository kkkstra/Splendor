import { Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { AuthedUser } from "../common/authed-user";
import { GameService } from "../game/game.service";

@UseGuards(JwtAuthGuard)
@Controller("rooms")
export class RoomsController {
  constructor(private readonly gameService: GameService) {}

  @Post()
  createRoom(@CurrentUser() user: AuthedUser) {
    return this.gameService.createRoom(user);
  }

  @Post(":roomCode/join")
  joinRoom(@Param("roomCode") roomCode: string, @CurrentUser() user: AuthedUser) {
    return this.gameService.joinRoom(roomCode, user);
  }

  @Get(":roomCode")
  getRoom(@Param("roomCode") roomCode: string, @CurrentUser() user: AuthedUser) {
    return this.gameService.getRoomState(roomCode, user.id);
  }
}
