import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { AuthedUser } from "../common/authed-user";

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthedUser => {
  const request = context.switchToHttp().getRequest<{ user: AuthedUser }>();
  return request.user;
});
