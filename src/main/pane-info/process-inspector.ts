import { execFile } from 'node:child_process';
import type { ObservedPaneActivity, ProcessTableRow } from './types';

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;
export type ExecFileAdapter = (file: string, args: string[], callback: ExecFileCallback) => void;

const PS_ARGS = ['-axo', 'pid=,ppid=,pgid=,tpgid=,comm=,args='];
const MAX_COMMAND_LENGTH = 120;

/**
 * Reads and interprets macOS process table data for PTY foreground process detection.
 */
export class ProcessInspector {
  public constructor(private readonly execFileAdapter: ExecFileAdapter = execFile) {}

  /**
   * Returns the current process table rows needed by `PaneInfoTracker`.
   */
  public listProcesses(): Promise<ProcessTableRow[]> {
    return new Promise((resolve, reject) => {
      this.execFileAdapter('ps', PS_ARGS, (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(parseProcessTable(stdout));
      });
    });
  }
}

/**
 * Parses `ps -axo pid=,ppid=,pgid=,tpgid=,comm=,args=` output.
 */
export function parseProcessTable(output: string): ProcessTableRow[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(-?\d+)\s+(-?\d+)\s+(\S+)\s*(.*)$/);
      if (!match) {
        return [];
      }

      const [, pid, ppid, pgid, tpgid, command, args] = match;
      return [
        {
          pid: Number(pid),
          ppid: Number(ppid),
          pgid: Number(pgid),
          tpgid: Number(tpgid),
          command: command ?? '',
          args: args?.trim() ?? '',
        },
      ];
    });
}

/**
 * Derives whether a shell-backed PTY is idle or has a foreground process.
 */
export function observePaneActivity(
  rows: ProcessTableRow[],
  shellPid: number,
): ObservedPaneActivity {
  const shellRow = rows.find((row) => row.pid === shellPid);
  if (!shellRow || shellRow.tpgid <= 0 || shellRow.tpgid === shellRow.pgid) {
    return { activity: 'idle' };
  }

  const foregroundRows = rows
    .filter((row) => row.pgid === shellRow.tpgid && row.pid !== shellPid)
    .sort((a, b) => a.pid - b.pid);
  const leader = foregroundRows.find((row) => row.pid === row.pgid) ?? foregroundRows[0];
  const foregroundArgs = leader ? leader.args || leader.command : undefined;
  const foregroundCommand = foregroundArgs ? formatCommandLine(foregroundArgs) : undefined;

  return {
    activity: 'running',
    foregroundCommand,
    foregroundArgs,
  };
}

function formatCommandLine(commandLine: string): string {
  const normalized = commandLine.trim().replace(/\s+/g, ' ');
  if (normalized.length <= MAX_COMMAND_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_COMMAND_LENGTH - 1)}…`;
}
