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
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ConversationService } from '../../agent/conversation/conversation.service';
import { ChatMessageDto } from './dto/chat-message.dto';
import { ChatReplyDto } from './dto/chat-reply.dto';

@ApiTags('chat')
@ApiBearerAuth('chioma-access-token')
@Controller('chat')
export class ChatController {
  constructor(private readonly conversationService: ConversationService) {}

  @Post()
  @ApiOperation({ summary: 'Send a message to the Chioma assistant' })
  @ApiBody({ type: ChatMessageDto })
  @ApiCreatedResponse({
    description: 'Assistant reply with the public session ID.',
    type: ChatReplyDto,
  })
  @ApiUnauthorizedResponse({ description: 'A bearer access token is required.' })
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
  @ApiOperation({ summary: 'Clear the caller-owned chat session' })
  @ApiParam({ name: 'sessionId', description: 'Public session ID from a chat reply.' })
  @ApiNoContentResponse({ description: 'Session history was cleared.' })
  @ApiUnauthorizedResponse({ description: 'A bearer access token is required.' })
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
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing bearer token — pass the chioma backend access token in the Authorization header.',
      );
    }
    return authorization.slice('Bearer '.length);
  }
}
