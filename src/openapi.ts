import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Document only the actual registered Nest routes; do not expose credentials. */
export function configureOpenApi(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Chioma AI Agent API')
    .setDescription('Authenticated chat endpoints for the Chioma assistant.')
    .setVersion('0.1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        description: 'Chioma backend access token (Authorization: Bearer <token>)',
      },
      'chioma-access-token',
    )
    .build();

  SwaggerModule.setup('api', app, SwaggerModule.createDocument(app, config));
}
