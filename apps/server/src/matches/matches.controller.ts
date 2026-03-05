import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { AuthedUser } from "../common/authed-user";
import { GameService } from "../game/game.service";

@UseGuards(JwtAuthGuard)
@Controller("matches")
export class MatchesController {
  constructor(private readonly gameService: GameService) {}

  @Get(":matchId")
  getMatch(@Param("matchId") matchId: string, @CurrentUser() user: AuthedUser) {
    return this.gameService.getMatchDetail(matchId, user.id);
  }
}
