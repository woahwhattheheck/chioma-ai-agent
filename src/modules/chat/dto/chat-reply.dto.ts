import { ApiProperty } from '@nestjs/swagger';

export class ChatReplyDto {
  @ApiProperty({
    description: 'Public session ID to provide on subsequent turns.',
    example: '5c8cd535-9f8f-43b9-b0e5-96d892360b17',
  })
  sessionId!: string;

  @ApiProperty({
    description: 'The assistant response to the message.',
    example: 'Here are two listings that match your budget.',
  })
  reply!: string;
}
