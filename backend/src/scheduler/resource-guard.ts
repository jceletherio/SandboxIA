import { readFileSync } from 'fs';
import * as os from 'os';

/** Amostra de recursos da máquina no instante da checagem. */
export interface ResourceSample {
  /** Load average de 1 minuto (`os.loadavg()[0]`). */
  loadavg1: number;
  /** Núcleos lógicos — normaliza o load average (1.0 = saturado em 1 core). */
  cpuCount: number;
  /** Memória REALMENTE disponível, em MB — ver `sampleResources` sobre o porquê de não ser `os.freemem()` puro. */
  freeMemMb: number;
}

export interface ResourceThresholds {
  /** Load average por núcleo acima do qual novas sessões são adiadas. */
  cpuLoadThreshold: number;
  /** Memória disponível abaixo da qual novas sessões são adiadas. */
  minFreeMemMb: number;
}

export interface ResourceCheck {
  ok: boolean;
  /** Motivo legível, só presente quando `ok` é false. */
  detail?: string;
}

/**
 * Decide se a máquina tem folga pra subir mais uma sessão. Função pura —
 * recebe a amostra em vez de ler o SO ela mesma — para dar pra testar sem
 * mockar `os`/`fs`. Quem lê o SO de verdade é `sampleResources`.
 */
export function checkResourcePressure(
  sample: ResourceSample,
  thresholds: ResourceThresholds,
): ResourceCheck {
  const perCore = sample.cpuCount > 0 ? sample.loadavg1 / sample.cpuCount : sample.loadavg1;
  if (perCore > thresholds.cpuLoadThreshold) {
    return {
      ok: false,
      detail: `load average ${sample.loadavg1.toFixed(2)} (${perCore.toFixed(2)}/núcleo) acima do limiar ${thresholds.cpuLoadThreshold}`,
    };
  }
  if (sample.freeMemMb < thresholds.minFreeMemMb) {
    return {
      ok: false,
      detail: `memória disponível ${sample.freeMemMb}MB abaixo do limiar ${thresholds.minFreeMemMb}MB`,
    };
  }
  return { ok: true };
}

/**
 * `os.freemem()` no Linux devolve `MemFree` do `/proc/meminfo` — NÃO conta
 * page cache/buffers como disponível, mesmo eles sendo reclamáveis na
 * prática. Numa workstation de dev isso deixa a memória "livre" artificialmente
 * baixa o tempo todo e o guard adiaria sessão sem necessidade real. Lemos
 * `MemAvailable` (kernel ≥ 3.14, já soma o reclamável) direto do
 * `/proc/meminfo` quando existir; fora do Linux (ou arquivo ausente), caímos
 * para `os.freemem()`.
 */
export function sampleResources(): ResourceSample {
  return {
    loadavg1: os.loadavg()[0],
    cpuCount: os.cpus()?.length || 1,
    freeMemMb: availableMemMb(),
  };
}

function availableMemMb(): number {
  try {
    const meminfo = readFileSync('/proc/meminfo', 'utf8');
    const match = meminfo.match(/^MemAvailable:\s+(\d+)\s+kB/m);
    if (match) return Math.floor(parseInt(match[1], 10) / 1024);
  } catch {
    // não-Linux ou /proc indisponível — segue para o fallback abaixo
  }
  return Math.floor(os.freemem() / (1024 * 1024));
}
