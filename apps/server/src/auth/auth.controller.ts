import { Body, Controller, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { CreateGuestDto } from "./dto/create-guest.dto";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("guest")
  createGuest(@Body() body: CreateGuestDto): { user: { id: string; name: string }; token: string } {
    return this.authService.createGuestToken(body.nickname);
  }
}
