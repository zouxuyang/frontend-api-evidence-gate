import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { AcceptanceSpec, ScenarioSpec } from './types.js';
import { stableStringify } from './spec.js';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export function buildHashes(spec: AcceptanceSpec, normalized: string, scenario: ScenarioSpec, runtime: Record<string, unknown> = {}) {
  const specHash = sha256(normalized);
  const semanticHash = sha256(stableStringify({ scenario, components: spec.components ?? [], apis: spec.apis ?? [], runtime }));
  return { specHash, semanticHash, scenarioHash: sha256(`${specHash}:${semanticHash}`) };
}

export async function readReusableResult(file: string, scenarioHash: string) {
  try {
    const result = JSON.parse(await readFile(file, 'utf8'));
    if (result.status === 'passed' && result.decision === 'pass' && result.fingerprint?.scenarioHash === scenarioHash) return result;
  } catch { /* 缓存缺失或损坏时重新执行 */ }
  return null;
}
