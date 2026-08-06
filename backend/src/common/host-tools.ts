import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export const isWindows = process.platform === 'win32';

/**
 * O binário existe no PATH? Era `which <bin>` — que não existe no Windows.
 *
 * `where` é o equivalente e resolve também os shims `.cmd`/`.ps1` pelo PATHEXT,
 * que é justamente como os CLIs de agente (`claude`, `opencode`) chegam
 * instalados por lá: `where claude` acha `claude.cmd`, enquanto uma busca só
 * por nome exato não acharia nada.
 */
export async function binaryExists(binary: string): Promise<boolean> {
  try {
    await execFileAsync(isWindows ? 'where' : 'which', [binary], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Espaço livre em GB no volume do caminho, ou `null` se não der para medir.
 * Era `df -BG <path>`, que no Windows não existe.
 */
export async function freeDiskGb(targetPath: string): Promise<number | null> {
  try {
    if (isWindows) {
      // O drive do caminho ("C:"), não o caminho inteiro: Win32_LogicalDisk é
      // indexado por letra de volume.
      const drive = targetPath.slice(0, 2).toUpperCase();
      const { stdout } = await execFileAsync(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-Command',
          `(Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive}'").FreeSpace`,
        ],
        { timeout: 10_000 },
      );
      const bytes = Number(stdout.trim());
      if (!Number.isFinite(bytes) || bytes <= 0) return null;
      return Math.floor(bytes / 1024 ** 3);
    }

    const { stdout } = await execFileAsync('df', ['-BG', targetPath], { timeout: 10_000 });
    const lines = stdout.trim().split('\n');
    if (lines.length < 2) return null;
    const available = parseInt(lines[1].split(/\s+/)[3].replace('G', ''), 10);
    return Number.isFinite(available) ? available : null;
  } catch {
    return null;
  }
}

/**
 * Envolve um comando para rodar com prioridade baixa de CPU e I/O.
 *
 * No Linux era `ionice -c3 nice -n 19 <cmd>`. No Windows nenhum dos dois
 * existe: `start /low` é builtin do cmd e exigiria montar linha de comando
 * (o oposto do `execFile` com array que o resto do código usa), então o
 * comando roda em prioridade normal.
 *
 * ponytail: indexação do qmd concorre com o resto da máquina no Windows. Se
 * incomodar, o upgrade é ajustar a prioridade do processo depois do spawn
 * (`wmic process where processid=<pid> CALL setpriority "idle"`), não montar
 * uma linha de comando aqui.
 */
export function lowPriorityWrap(
  bin: string,
  args: string[],
  ioniceAvailable: boolean,
): { file: string; args: string[] } {
  if (isWindows) return { file: bin, args };
  const niced = ['nice', '-n', '19', bin, ...args];
  return ioniceAvailable
    ? { file: 'ionice', args: ['-c3', ...niced] }
    : { file: niced[0], args: niced.slice(1) };
}
