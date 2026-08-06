import * as path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { corsOrigin } from './common/cors';

/**
 * Carrega `backend/.env` no processo do APP.
 *
 * O `prisma.config.ts` já faz isto, mas só vale para o CLI do Prisma — quem
 * sobe o servidor é `node dist/main`, que nunca passou por ele. Com
 * `prisma.config.ts` presente o Prisma parou de carregar `.env` sozinho, então
 * o boot morria em `P1012: Environment variable not found: DATABASE_URL` a
 * menos que a variável já estivesse exportada no shell. `process.loadEnvFile` é
 * nativo do Node (>=20.6) — mesma escolha do prisma.config.ts, sem dependência
 * nova.
 *
 * Duas tentativas porque o cwd depende de quem chama: os scripts de setup rodam
 * a partir de `backend/`, mas `node backend/dist/main` a partir da raiz do repo
 * também tem que funcionar.
 */
for (const candidate of [
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '..', '.env'),
]) {
  try {
    process.loadEnvFile(candidate);
    break;
  } catch {
    // arquivo ausente — tenta o próximo, e segue sem se nenhum existir
    // (ambiente que já exporta as vars, ex.: CI ou container)
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT || 4000;
  await app.listen(port);

  // await_answer (MCP) pode segurar uma request por até ~55min
  const server = app.getHttpServer();
  server.requestTimeout = 3_600_000;
  server.headersTimeout = 3_660_000;
  server.keepAliveTimeout = 3_600_000;

  console.log(`🚀 Orchestrator API running on http://localhost:${port}`);
}

bootstrap();
