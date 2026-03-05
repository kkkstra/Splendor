import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { AuthedUser } from "../common/authed-user";
import { GameService } from "../game/game.service";

@UseGuards(JwtAuthGuard)
@Controller("me")
export class MeController {
  constructor(private readonly gameService: GameService) {}

  @Get("history")
  getHistory(@CurrentUser() user: AuthedUser, @Query("cursor") cursor?: string) {
    return this.gameService.getHistory(user.id, cursor);
  }
}
