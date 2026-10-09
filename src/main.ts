import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';
import { RootConfig } from './config/env.validation';
import { correlationIdMiddleware } from './http/correlation-id.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(correlationIdMiddleware);
  app.useWebSocketAdapter(new WsAdapter(app));

  const configService = app.get(ConfigService<RootConfig, true>);
  const port = configService.get('app', { infer: true }).port;

  app.enableCors();
  await app.listen(port);

  console.log(`chioma-agent listening on port ${port}`);
}

void bootstrap();
