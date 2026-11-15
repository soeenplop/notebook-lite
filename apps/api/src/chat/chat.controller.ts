import {
  BadRequestException,
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  CHAT_STREAM_ERROR_CODES,
  chatIdSchema,
  chatStreamRequestSchema,
} from '@notebook-lite/shared';
import { pipeUIMessageStreamToResponse } from 'ai';
import type { Response } from 'express';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard.js';
import { SupabaseService } from '../supabase/supabase.service.js';
import { ChatStreamService } from './chat-stream.service.js';
import { UserRateLimiter } from './user-rate-limiter.js';

/** Injection token for the per-user chat message limiter. */
export const CHAT_RATE_LIMITER = Symbol('CHAT_RATE_LIMITER');

/**
 * Grounded chat answers, streamed as an AI SDK UI-message stream (SSE) for `useChat`.
 * Errors before the stream starts are JSON: `{ error: { code, message } }` or Nest's default.
 */
@Controller('chat')
@UseGuards(AuthGuard)
export class ChatController {
  constructor(
    private readonly chats: ChatStreamService,
    private readonly supabase: SupabaseService,
    @Inject(CHAT_RATE_LIMITER) private readonly limiter: UserRateLimiter,
  ) {}

  @Post(':chatId/stream')
  async stream(
    @Param('chatId') chatIdParam: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const chatId = chatIdSchema.safeParse(chatIdParam);
    if (!chatId.success) throw new BadRequestException('Invalid chat id');
    const input = chatStreamRequestSchema.safeParse(body);
    if (!input.success) {
      throw new BadRequestException(input.error.issues[0]?.message ?? 'Invalid request');
    }

    const limit = this.limiter.take(req.user.id);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      throw new HttpException(
        {
          error: {
            code: CHAT_STREAM_ERROR_CODES.rateLimited,
            message: 'Too many messages. Please wait a moment.',
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const db = this.supabase.forUser(req.user.accessToken);
    const chat = await this.chats.prepare(db, chatId.data);
    await this.chats.saveQuestion(db, chat, input.data.text);
    await pipeUIMessageStreamToResponse({
      response: res,
      stream: this.chats.stream(db, chat, input.data.text),
      keepAliveMs: 15_000,
    });
  }
}
