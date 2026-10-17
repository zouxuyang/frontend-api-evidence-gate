import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { AcceptanceSpec, ScenarioSpec } from './types.js';
import { stableStringify } from './spec.js';

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

export function buildHashes(spec: AcceptanceSpec, normalized: string, scenario: ScenarioSpec, runtime: Record<string, unknown> = {}) {
  const specHash = sha256(normalized);
  const files = (spec.components ?? []).map((component) => ({ path: component.path, contentHash: hashFile(component.path) }));
  const contentHash = sha256(stableStringify({ files, pages: spec.pages ?? [], apis: spec.apis ?? [] }));
  const semanticHash = sha256(stableStringify({ scenario, files, components: spec.components ?? [], apis: spec.apis ?? [], runtime }));
  return { specHash, contentHash, semanticHash, scenarioHash: sha256(`${specHash}:${contentHash}:${semanticHash}`) };
}

function hashFile(file: string) { try { const resolved = existsSync(file) ? file : path.resolve(process.cwd(), file); return existsSync(resolved) ? sha256(readFileSync(resolved)) : 'missing'; } catch { return 'unreadable'; } }

export async function readReusableResult(file: string, scenarioHash: string) {
  try {
    const result = JSON.parse(await readFile(file, 'utf8'));
    if (result.status === 'passed' && result.decision === 'pass' && result.fingerprint?.scenarioHash === scenarioHash) {
      const evidence = result.evidence ?? {};
      const paths = [evidence.screenshot, evidence.trace, evidence.checks, evidence.requests, evidence.responses, ...(evidence.screenshots ?? [])].filter(Boolean);
      for (const evidencePath of paths) await stat(path.isAbsolute(evidencePath) ? evidencePath : path.resolve(path.dirname(file), evidencePath));
      const resultStat = await stat(file);
      const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
      if (Date.now() - resultStat.mtimeMs <= maxAgeMs) return result;
    }
  } catch { /* 缓存缺失或损坏时重新执行 */ }
  return null;
}
