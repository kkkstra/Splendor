import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "node:crypto";
import type { AuthedUser } from "../common/authed-user";

interface JwtPayload {
  sub: string;
  name: string;
}

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  createGuestToken(nickname?: string): { user: AuthedUser; token: string } {
    const safeName = nickname?.trim() ? nickname.trim().slice(0, 20) : `Guest-${Math.floor(Math.random() * 9000 + 1000)}`;
    const user = {
      id: `u_${randomUUID().slice(0, 8)}`,
      name: safeName,
    };
    const token = this.jwtService.sign({
      sub: user.id,
      name: user.name,
    } satisfies JwtPayload);

    return {
      user: {
        id: user.id,
        name: user.name,
      },
      token,
    };
  }

  verifyToken(token: string): AuthedUser | null {
    try {
      const payload = this.jwtService.verify<JwtPayload>(token);
      return {
        id: payload.sub,
        name: payload.name,
      };
    } catch {
      return null;
    }
  }
}
