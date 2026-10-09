import { createHash } from 'crypto';
import {
  BadRequestException,
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
import { ProactiveNudgesService } from './proactive-nudges.service';

@Controller('chat')
export class ChatController {
  constructor(private readonly conversationService: ConversationService, private readonly proactiveNudges: ProactiveNudgesService) {}

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

    this.proactiveNudges.refresh(sessionId, accessToken);
    return { sessionId: clientSessionId, reply };
  }

  @Post(':sessionId/nudges')
  updateNudges(
    @Param('sessionId') id: string,
    @Body() config: { enabled?: boolean },
    @Headers('authorization') auth?: string,
  ): { enabled: boolean } {
    if (typeof config?.enabled !== 'boolean') {
      throw new BadRequestException('enabled must be boolean');
    }
    const token = this.extractBearerToken(auth);
    this.proactiveNudges.setEnabled(this.ownerScopedId(token, id), token, config.enabled);
    return { enabled: config.enabled };
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
    this.proactiveNudges.forget(sessionId);
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
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing bearer token — pass the chioma backend access token in the Authorization header.',
      );
    }
    return authorization.slice('Bearer '.length);
  }
}
