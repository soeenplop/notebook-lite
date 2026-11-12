import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import { type AuthUser, UnauthorizedError } from './auth.types.js';

export type AuthenticatedRequest = Request & { user: AuthUser };

/** Guard for plain Nest controllers (e.g. the chat SSE endpoint): requires a valid session. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    try {
      const user = await this.auth.authenticate(request.headers.authorization);
      if (!user) throw new UnauthorizedError('Missing access token');
      request.user = user;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedError) throw new UnauthorizedException(error.message);
      throw error;
    }
  }
}
