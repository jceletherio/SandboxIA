# Node.js 22+ — Segurança

## OWASP Top 10 por item

| Código | Item| Em NodeJS |
| ------ | ---- | --------- |
| A01 | Broken Access | Toda rota protegida por plugin/preHandler. Authorize no service com `tenantId`. |
| A02 | Crypto Fail | `argon2id` (`@node-rs/argon2`) para hash de senha. **Nunca** MD5/SHA1. JWT RS256/ES256. |
| A03 | Injection | SQL parameterized (`pg`). Sem template `${}` com input. Comando shell? use `execFile` com args array. |
| A04 | Insecure Design | Threat modeling na spec fase 2 (uma bullet de risco). |
| A05 | Security Misconfig | Helmet, CORS allowlist, body limit, desativar `x-powered-by`, headers `X-Content-Type-Options: nosniff`. |
| A06 | Vuln Dependencies | `npm audit --omit=dev` em CI. Bot `dependabot`/`renovate`. `"--ignore-scripts"` no install CI. |
| A07 | Auth Fail | Login com rate-limit estrito (10/min/IP), lockout por tenant, JWT ≤ 15 min, refresh cookie HttpOnly rotação. Sem `123456` default. |
| A08 | Integrity Fail | Subresource integrity em scripts externos. Verificação de assinatura de webhooks (HMAC + replay protection via nonce + timestamp). |
| A09 | Logging | Logar auth events (login success/fail, refresh, logout), timing. Nunca logar senha/ token/PII. |
| A10 | SSRF | URL externa vinda de input → allowlist de hosts. `fetch` com `redirect: 'manual'`. |

## AuthN — JWT com rotação

```ts
// plugins/auth.ts
import jwt from '@fastify/jwt';
import { env } from '../config/env.js';

app.register(jwt, {
  secret: { private: env.JWT_PRIVATE, public: env.JWT_PUBLIC },
  algorithm: 'RS256',
  sign: { expiresIn: '15m' },
});

app.decorate('verifyJWT', async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    await req.jwtVerify();
    req.tenantContext = { tenantId: req.user.tenant_id, requestId: req.id };
  } catch (e) {
    return reply.code(401).send({ error: { code: 'unauthorized', message: 'Token inválido' } });
  }
});
```

- Schema de claims `zod`: `sub` uuid, `tenant_id` uuid, `scopes` array, `exp`, `iat`, `kid`.
- Rotate `kid`: na mesma `jwks.json` publica dois `kid` durante a janela de sobreposição
  (grace period 1 semana). Remoção só após todos os refresh tokens rotacionados.

## Hash de senha

```ts
import { hash, verify, ArgonOptions } from '@node-rs/argon2';
const opts: ArgonOptions = { memoryCost: 19456, parallelism: 1, algorithm: 2 /*id*/ };
const digest = await hash(password, opts);
const ok = await verify(digest, supplied, opts);
```

Argon2id estável; nunca adicionar regra case-sensitive "first login com senha default".

## Rate-limit

```ts
app.register(rateLimit, {
  max: 100, timeWindow: '1 minute',
  redis: new Redis(env.REDIS_URL),
  keyGenerator: (req) => req.tenantContext?.tenantId ?? req.ip,
  addHeaders: { 'x-ratelimit-limit': true, 'x-ratelimit-remaining': true, 'retry-after': true },
});
```

Rota `/auth/login` override: `{ max: 10, timeWindow: '1 minute' }`. Header `Retry-After`.

## CORS — allowlist não `*`

```ts
app.register(cors, {
  origin: env.CORS_ORIGINS, // ['https://app.exemplo.com'] não '*'
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Requested-With'],
});
```

## Helmet

```ts
app.register(helmet, {
  contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], objectSrc: ["'none'"] } },
  strictTransportSecurity: { maxAge: 31536000, includeSubdomains: true, preload: true },
  referrerPolicy: 'no-referrer',
});
```

Routes JSON expõem OpenAPI? `crossOriginResourceSharing`core+acima. Protege docs em prod
(`/docs` só em staging/dev).

## Body e coercion

```ts
{ bodyLimit: 1_048_576 }                    // 1 MiB default. Subir só se necessário.
ajv: { customOptions: { coerceTypes: false } } // schema zod decide tipos
```

Zod schema confere tipos, ranges, enums, e normaliza strings. Erro de schema → 400.

## SQL injection — regras

- Toda query pelo `pg` parameterized (`$1`, `$2`...). Não concatene.
- Identifiers dinâmicos (coluna de `ORDER BY`) — **whitelist** de valores permitidos:
  ```ts
  const SORTABLE = ['created_at', 'updated_at', 'status'] as const;
  function orderColumn(sort: string): string {
    return SORTABLE.includes(sort as never) ? sort : 'created_at';
  }
  // nunca: query(`... ORDER BY ${sort}`)
  ```
- Query construindo `IN (?,?,?...)` expandido por `arrayLiteral` de `pg` ou generator
  com placeholders dinâmicos (somente count, nunca conteúdo).

## Schema validation — env

```ts
const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_PRIVATE: z.string(),
  JWT_PUBLIC: z.string(),
  CORS_ORIGINS: z.string().transform(s => s.split(',')),
  NODE_ENV: z.enum(['development','test','production']),
});
export const env = envSchema.parse(process.env);
```

Faltou em prod → throw antes de `app.listen`. Bom default = **nenhum** para secrets.

## Webhooks — assinatura

```ts
const signature = req.headers['x-webhook-signature'] as string;
const raw = await req.rawBody; // body crú p/ HMAC
const expected = createHmac('sha256', env.WEBHOOK_SECRET).update(raw).digest('hex');
const fresh = Math.abs(Date.now() - Number(req.headers['x-webhook-timestamp'])) < 5 * 60 * 1000;
if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) || !fresh) {
  return reply.code(401).send(...);
}
```

Replay protection: nonce no Redis SETNX com TTL 10 min.

## Logging — não logar PII

`pino` schema confere campos. Blacklist na entrada do transporte:

```ts
redact: { paths: ['req.headers.authorization', '*.password', '*.token', '*.ssn'], censor: '[REDACTED]' }
```

## Não faça

- `eval`, `new Function`, `vm.runInThisContext` — bloqueie via ESLint `no-eval`.
- `fs.readFile` em path de input (path traversal). Canonicalize e confina a pasta.
- `crypto.randomBytes(8)` para secret — use 32 bytes.
- `setTimeout(... , 86400000)` sem `AbortController` — vaza handle em longo uptime.
- Resposta de erro exponha stack trace em prod (`NODE_ENV=production`).