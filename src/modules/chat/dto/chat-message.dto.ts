import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Upper bound on user message length to limit prompt-stuffing / cost abuse. */
export const CHAT_MESSAGE_MAX_LENGTH = 4000;

export class ChatMessageDto {
  @ApiProperty({
    description: 'The message to send to the assistant.',
    minLength: 1,
    maxLength: CHAT_MESSAGE_MAX_LENGTH,
    example: 'Show me two affordable listings',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(CHAT_MESSAGE_MAX_LENGTH)
  message!: string;

  @ApiPropertyOptional({
    description: 'Public session ID from a previous reply; omit for a new session.',
    example: '5c8cd535-9f8f-43b9-b0e5-96d892360b17',
  })
  @IsOptional()
  @IsString()
  sessionId?: string;
}
