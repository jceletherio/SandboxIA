/**
 * Acumula chunks de saída do PTY e faz flush em lote (por tempo ou tamanho),
 * evitando um INSERT de log por chunk.
 */
export class OutputBuffer {
  private buffer = '';
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly onFlush: (chunk: string) => void,
    private readonly flushIntervalMs = 2000,
    private readonly maxBytes = 8192,
  ) {}

  push(data: string) {
    this.buffer += data;
    if (Buffer.byteLength(this.buffer) >= this.maxBytes) {
      this.flush();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.flushIntervalMs);
    }
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.buffer) return;
    const chunk = this.buffer;
    this.buffer = '';
    this.onFlush(chunk);
  }

  dispose() {
    this.flush();
  }
}
