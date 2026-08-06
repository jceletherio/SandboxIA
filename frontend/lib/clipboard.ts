/**
 * Copiar para a área de transferência funcionando em origem insegura.
 *
 * `navigator.clipboard` é secure-context only: aberto pelo IP da LAN em http —
 * que é justamente como o celular acessa isto — o objeto **não existe**, e
 * `navigator.clipboard.writeText` estoura TypeError. O caminho antigo
 * (`document.execCommand('copy')`) é deprecado mas continua funcionando fora de
 * origem segura, então serve de fallback.
 *
 * Devolve boolean em vez de lançar: quem chama precisa dar retorno honesto na
 * UI — "copiado" que não copiou é pior que um erro visível.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permissão negada ou contexto recusado — cai para o execCommand abaixo.
    }
  }

  if (typeof document === 'undefined') return false;

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    // Fora da tela mas focável: `display:none` ou `hidden` fazem a seleção
    // falhar, e o iOS dá zoom se a fonte for menor que 16px.
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '-9999px';
    textarea.style.fontSize = '16px';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
