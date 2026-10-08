import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';
import { RootConfig } from './config/env.validation';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useWebSocketAdapter(new WsAdapter(app));
  // Allow Nest to dispose registered providers on Kubernetes/docker SIGTERM.
  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);

  const configService = app.get(ConfigService<RootConfig, true>);
  const port = configService.get('app', { infer: true }).port;

  app.enableCors();
  await app.listen(port);

  console.log('chioma-agent listening on port ' + port);
}

void bootstrap();
