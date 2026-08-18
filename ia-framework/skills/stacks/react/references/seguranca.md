# React 19+ — Segurança

## OWASP Top 10 mapeado

| Código | Item | Em React |
| ------ | ---- | ---------- |
| A03 | Injection | React escapa JSX por padrão. **Nunca** `dangerouslySetInnerHTML` sem `DOMPurify.sanitize` — vire finding `critical`. |
| A05 | Security Misconfig | CSP em `index.html` (`Content-Security-Policy`). Sem `unsafe-inline`/`unsafe-eval` em `script-src` (Vite dev usa eval — só em prod/AOT). |
| A07 | Auth Fail | Access token em memória (Zustand), refresh em cookie `HttpOnly; Secure; SameSite=Strict`. `localStorage` para access token = `high`. Guard `RequireAuth`. |
| A08 | Integrity Fail | Subresource Integrity (SRI) em scripts externos; pinning de versão no `package.json`. |
| A09 | Logging | Não logar tokens/PII em `console.error`/logs — interceptor/`api/` não loga `Authorization`. |
| A10 | SSRF | `api/` nunca chama URL dinâmica vinda do usuário sem allowlist. |

## AuthN / AuthZ

### Token storage

- **Padrão**: refresh token em cookie `HttpOnly; Secure; SameSite=Strict`; access token
  short-lived (≤ 15 min) em memória (`auth.store`). Reload → refresh troca por access novo.
- **Não**: `localStorage.setItem('access_token', ...)` — XSS rouba. Se legado, `high`.

### Guard de rota (wrapper)

```tsx
function RequireScope({ scope, children }: { scope: string; children: ReactNode }) {
  const has = useAuthStore((s) => s.hasScope(scope));
  return has ? children : <Navigate to="/forbidden" replace />;
}
// uso: <RequireScope scope="admin"><AdminPage /></RequireScope>
```

Redirecione para `/forbidden` separado — não tentar qualquer página de auth como fallback.

## XSS — sanitize explicitamente

```tsx
// nunca fazer
<div dangerouslySetInnerHTML={{ __html: userInput }} />

// se inevitável, sanitize com DOMPurify antes
import DOMPurify from 'dompurify';
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />
```

`dangerouslySetInnerHTML` sem sanitize é `severity: critical`. Links de usuário com
`target="_blank"` → `rel="noopener noreferrer"`.

## CSRF

- Cookie `SameSite=Strict` + header custom `X-Requested-With` validado no backend = dupla
  defesa.
- Se cookie `SameSite=None` (cross-site), token CSRF sincronizado: leia cookie
  `XSRF-TOKEN` → envie header `X-XSRF-TOKEN` no `api/` client.

## CSP e Trusted Types

`index.html`:

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self' 'nonce-<nonce-do-bundle>';
               style-src 'self' 'nonce-<nonce>'; connect-src 'self' https://api.exemplo.com;
               img-src 'self' data:; object-src 'none'; base-uri 'self'">
```

Sem `'unsafe-eval'`, sem `'unsafe-inline'` em `script-src`. Vite injecta scripts inline
em dev — valide o bundle de produção; em prod use build com nonce/hash.

## Prevenção de template injection

- JSX é compilado — sem `eval`/`new Function` em runtime.
- `dangerouslySetInnerHTML` é o único vetor — sempre sanitizado (ver acima).

## Proteção de rotas

- `RequireAuth`/`RequireScope` como wrapper de rota; dados sensíveis nunca em query string.
- Lazy loading via `React.lazy` — bundle de rota restrita só baixa após o guard passar.

## Dependency hygiene

- `npm audit --omit=dev` em CI. CVE high/critical bloqueia merge.
- Versões pinadas major no `package.json`; sem `^` em libs sensíveis.
- SRI em scripts de CDN externos (`crossorigin="anonymous"` + `integrity`).

## Segredos

- Nunca hardcode API keys em `src/` — vira bundle visível em produção. Use proxy no
  backend (`/api/proxy/...`) ou BFF.
- `import.meta.env` só com prefixo `VITE_` e **sem** secretos — nunca `VITE_` + token real.
- Variáveis de SSR (se `@react/ssr`/Next-like) nunca expostas ao cliente sem allowlist.
