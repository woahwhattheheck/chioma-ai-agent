import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';
import { StructuredLogger } from './observability/structured-logger';
import { RootConfig } from './config/env.validation';

async function bootstrap() {
  const logger = new StructuredLogger();
  const app = await NestFactory.create(AppModule, { logger });
  app.useWebSocketAdapter(new WsAdapter(app));

  const configService = app.get(ConfigService<RootConfig, true>);
  const port = configService.get('app', { infer: true }).port;

  app.enableCors();
  await app.listen(port);

  logger.record('info', 'app.ready', { port });
}

void bootstrap();
