import { createHash } from 'crypto';
import {
  Body,
  Controller,
  Delete,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConversationService } from '../../agent/conversation/conversation.service';
import { ChatMessageDto } from './dto/chat-message.dto';

@Controller('chat')
export class ChatController {
  constructor(private readonly conversationService: ConversationService) {}

  @Post()
  async sendMessage(
    @Body() dto: ChatMessageDto,
    @Headers('authorization') authorization?: string,
  ): Promise<{ sessionId: string; reply: string }> {
    const accessToken = this.extractBearerToken(authorization);
    const clientSessionId = dto.sessionId ?? ConversationService.newSessionId();
    const sessionId = this.ownerScopedId(accessToken, clientSessionId);

    const reply = await this.conversationService.handleTurn(sessionId, dto.message, {
      accessToken,
    });

    return { sessionId: clientSessionId, reply };
  }

  @Delete(':sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetSession(
    @Param('sessionId') clientSessionId: string,
    @Headers('authorization') authorization?: string,
  ): Promise<void> {
    const accessToken = this.extractBearerToken(authorization);
    const sessionId = this.ownerScopedId(accessToken, clientSessionId);
    await this.conversationService.resetSession(sessionId);
  }

  /**
   * Namespace the client-facing session ID under a stable, short hash of the
   * caller's access token so that two callers with different tokens can never
   * collide on or access each other's sessions, even if they happen to supply
   * the same sessionId value.
   */
  private ownerScopedId(accessToken: string, clientSessionId: string): string {
    const ownerKey = createHash('sha256').update(accessToken).digest('hex').slice(0, 16);
    return `${ownerKey}:${clientSessionId}`;
  }

  private extractBearerToken(authorization?: string): string {
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
    // An empty or whitespace-containing value is not a usable bearer token.
    // Apply the same rule to POST and DELETE through this shared helper.
    if (!token || /\s/.test(token)) {
      throw new UnauthorizedException(
        'Missing or invalid bearer token — pass the chioma backend access token in the Authorization header.',
      );
    }
    return token;
  }
}
