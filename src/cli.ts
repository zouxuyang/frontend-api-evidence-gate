#!/usr/bin/env node
import path from 'node:path';
import { loadSpec } from './spec.js';
import { runAcceptance } from './runner.js';

const args = process.argv.slice(2);
const command = args[0] ?? 'run';
const specFile = args[1] ?? 'acceptance-spec.yaml';
const outputFlag = args.indexOf('--output');
const outputDir = outputFlag >= 0 ? (args[outputFlag + 1] ?? 'artifacts') : 'artifacts';
const reuse = args.includes('--reuse');

if (!['run', 'plan'].includes(command)) { console.error('用法：acceptance-runner <run|plan> <spec.yaml> [--output artifacts] [--reuse]'); process.exit(2); }
try {
  const { spec, normalized } = await loadSpec(path.resolve(specFile));
  if (command === 'plan') { console.log(JSON.stringify({ specId: spec.specId, scenarios: spec.scenarios.map((scenario) => ({ id: scenario.id, priority: scenario.priority ?? 'normal' })) }, null, 2)); process.exit(0); }
  const results = await runAcceptance({ spec, normalizedSpec: normalized, outputDir: path.resolve(outputDir), reuse });
  console.log(JSON.stringify({ specId: spec.specId, total: results.length, pass: results.filter((r) => r.decision === 'pass').length, fail: results.filter((r) => r.decision === 'fail').length, needsReview: results.filter((r) => r.decision === 'needs_review').length, results }, null, 2));
  process.exit(results.some((result) => result.decision === 'fail') ? 1 : 0);
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exit(1); }
