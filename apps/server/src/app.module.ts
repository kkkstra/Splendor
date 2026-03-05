import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { GameGateway } from "./game/game.gateway";
import { GameService } from "./game/game.service";
import { MatchesController } from "./matches/matches.controller";
import { MeController } from "./matches/me.controller";
import { RoomsController } from "./rooms/rooms.controller";

@Module({
  imports: [AuthModule],
  controllers: [RoomsController, MatchesController, MeController],
  providers: [GameService, GameGateway],
})
export class AppModule {}
