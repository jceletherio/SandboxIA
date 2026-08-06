import { checkResourcePressure } from './resource-guard';

describe('checkResourcePressure', () => {
  const thresholds = { cpuLoadThreshold: 1.5, minFreeMemMb: 1024 };

  it('ok quando load e memória estão dentro do limiar', () => {
    const result = checkResourcePressure(
      { loadavg1: 2, cpuCount: 4, freeMemMb: 2048 },
      thresholds,
    );
    expect(result).toEqual({ ok: true });
  });

  it('bloqueia quando o load average por núcleo excede o limiar', () => {
    const result = checkResourcePressure(
      { loadavg1: 8, cpuCount: 4, freeMemMb: 2048 },
      thresholds,
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/load average/);
  });

  it('bloqueia quando a memória disponível está abaixo do limiar, mesmo com CPU ociosa', () => {
    const result = checkResourcePressure(
      { loadavg1: 0.1, cpuCount: 4, freeMemMb: 512 },
      thresholds,
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/memória disponível/);
  });

  it('não normaliza por núcleo quando cpuCount é 0 (evita divisão por zero)', () => {
    const result = checkResourcePressure(
      { loadavg1: 1, cpuCount: 0, freeMemMb: 2048 },
      thresholds,
    );
    expect(result).toEqual({ ok: true });
  });

  it('máquina de 1 núcleo satura no primeiro sinal de load', () => {
    const result = checkResourcePressure(
      { loadavg1: 2, cpuCount: 1, freeMemMb: 2048 },
      thresholds,
    );
    expect(result.ok).toBe(false);
  });
});
