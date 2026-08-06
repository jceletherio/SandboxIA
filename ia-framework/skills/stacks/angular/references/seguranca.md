# Angular 22 — Segurança

## OWASP Top 10 mapeado

| Código | Item | Em Angular |
| ------ | ---- | ---------- |
| A03 | Injection | Angular sanitiza binding `{{ }}`. **Nunca** use `innerHTML` sem `DomSanitizer`+`bypassSecurityTrust*` — vire finding. |
| A05 | Security Misconfig | CSP `index.html` `Content-Security-Policy` meta. Sem `unsafe-inline`. |
| A07 | Auth Fail | JWT no `sessionStorage` apenas se hidden do JS; melhor HttpOnly cookie + refresh. Guard `isAuthenticated` + `canMatch`. |
| A08 | Integrity Fail | Subresource Integrity (SRI) em scripts externos; pinning de versão `package.json`. |
| A09 | Logging | Não logar secrets no service HTTP interceptor (Authorization, CreditCard). |
| A10 | SSRF | `httpResource`/HttpClient nunca aponta URL dinâmica do usuário — allowlist. |

## AuthN / AuthZ

### Token storage

- **Padrão**: refresh token em cookie `HttpOnly; Secure; SameSite=Strict`, access token
  short-lived (≤ 15 min) em memória (signal). Após reload, refresh troca por access novo.
- **Não**: `localStorage.setItem('access_token', ...)` — XSS rouba. Se legado, vira
  finding `severity: high`.

### Guards e CanMatch

```ts
export const requireScope = (scope: string): CanMatchFn =>
  () => {
    const auth = inject(AuthService);
    return auth.hasScope(scope) ? true : createUrlTreeToTree(['/', 'forbidden']);
  };
```

`CanActivateFn`/`CanMatchFn` funcional. Sem `CanActivate` orientado a classe legado.
Redirecione para `/forbidden` separado (não tentar any auth page$id).

## XSS — sanitize explicitamente

```ts
// nunca fazer
this.sanitizer.bypassSecurityTrustHtml(userInput);
// se inevitável, encontrar saneado previamente com DOMPurify fora do Angular
const safe = this.sanitizer.sanitize(SecurityContext.HTML, DOMPurify.sanitize(html));
```

`[innerHTML]` sem `sanitize` é `severity: critical`. Material/Angular `MatIcon` com
SVG registry exige URL allowlist — não registre dinâmica.

## CSRF

- Cookie SameSite=Strict + header custom `X-Requested-With` validado no backend = dupla
  defesa.
- Com `withFetch()` e cookie SameSite=None (caso cross-site), CSRF token sincronizado é
  mandatório — interceptor lê `XSRF-TOKEN` cookie → envia `X-XSRF-TOKEN` header (já suportado
  por `provideHttpClient(withXsrfConfiguration())`).

## CSP e Trusted Types

`index.html`:

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self' 'nonce-<nonce-mesma-do-bundle>';
               style-src 'self' 'nonce-<nonce>'; connect-src 'self' https://api.exemplo.com;
               img-src 'self' data:; object-src 'none'; base-uri 'self'">
```

Sem `'unsafe-eval'`, sem `'unsafe-inline'` em `script-src`. Trusted Types via
`require-trusted-types-for 'script'` exige `ng-trusted-types` policy; só se backend/CI
conseguir servir com nonce rotativo. Caso contrário, vira env `'wasm-unsafe-eval'` se
for AOT (padrão Angular com Ivy) — AOT não precisa de `unsafe-eval`.

## Prevenção de template injection

Angular templates são compilados AOT — sem `eval` em runtime. Verifique:

- Sem `new Function(...)` em código de aplicação.
- Sem `Compiler` injetado em runtime (removido do bundle production).
- `platformBrowserDynamic` não deve aparecer em production bundle.

## Proteção de rotas

- `canMatch` + `canActivate` somados quando há estado disparado em deep-link.
- **Não** deixe dados sensíveis em query string — `$state`/Router params viram logs e
  history.

## Dependency hygiene

- `npm audit --omit=dev` em CI. CVE high/critical bloqueia merge.
- Não importe de `@angular/core` via path relativo (quebra tree-shaking e bundling seguro).
- Sem eval de linguagem em i18n dinâmico — use済 `$localize` compile-time.

## SSR — extra

- Server-side rendering revela environment vars ao cliente se injetadas no template. Não
  serializam dotenvs no `TransferState` sem allowlist.
- Hydration mismatch = risco de XSS via DOM mutado. Use `isPlatformBrowser` ao escrever em
  `localStorage` dentro de `effect`.

## Segredos

- Nunca hardcode API keys em `environment.ts` — em build production vira bundle舰队 visível.
  Use backend proxy (`/api/proxy/...`) ou BFF.
- `process.env` no SSR nunca exposto ao cliente — server-exclusivo.