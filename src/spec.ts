import { readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import * as AjvNamespace from 'ajv/dist/2020.js';
const Ajv = (AjvNamespace as any).default ?? AjvNamespace;
import type { AcceptanceSpec } from './types.js';

export async function loadSpec(file: string): Promise<{ spec: AcceptanceSpec; normalized: string }> {
  const source = await readFile(file, 'utf8');
  const value = path.extname(file).toLowerCase() === '.json' ? JSON.parse(source) : YAML.parse(source);
  if (!value || typeof value !== 'object') throw new Error('验收规格必须是 YAML 或 JSON 对象');
  const spec = normalizeSpec(value as AcceptanceSpec);
  await validateSpec(spec);
  return { spec, normalized: stableStringify(spec) };
}

export async function validateSpec(spec: AcceptanceSpec): Promise<void> {
  const schemaName = 'taskId' in (spec as Record<string, unknown>) ? 'acceptance-task.schema.json' : 'acceptance-spec.schema.json';
  const source = await readSchema(schemaName);
  const validate = new Ajv({ allErrors: true }).compile(JSON.parse(source));
  if (!validate(spec)) throw new Error(`验收规格校验失败：${JSON.stringify(validate.errors)}`);
}

export function normalizeSpec(input: AcceptanceSpec): AcceptanceSpec {
  return {
    ...input,
    pages: [...(input.pages ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
    apis: [...(input.apis ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
    components: [...(input.components ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
    scenarios: input.scenarios.map((scenario) => ({ ...scenario, steps: scenario.steps ?? [] })),
  };
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

async function readSchema(name: string): Promise<string> {
  try { return await readFile(new URL(`../schemas/${name}`, import.meta.url), 'utf8'); }
  catch { return await readFile(path.resolve(process.cwd(), 'schemas', name), 'utf8'); }
}
