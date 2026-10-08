import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';
import { RootConfig } from './config/env.validation';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useWebSocketAdapter(new WsAdapter(app));

  const configService = app.get(ConfigService<RootConfig, true>);
  const config = configService.get('app', { infer: true });
  const port = config.port;

  app.enableCors({ origin: config.allowedOrigins });
  await app.listen(port);

  console.log(`chioma-agent listening on port ${port}`);
}

void bootstrap();
