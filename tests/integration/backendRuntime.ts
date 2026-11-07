import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export const backendLauncher = resolve('scripts/run-backend.sh');

export function backendPython(): string {
  return execFileSync('bash', [backendLauncher, 'python-path'], { encoding: 'utf8' }).trimEnd();
}
