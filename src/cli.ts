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
const targetFlag = args.indexOf('--target');
const targetMode = targetFlag >= 0 ? args[targetFlag + 1] : undefined;
const cdpFlag = args.indexOf('--cdp-endpoint');
const cdpEndpoint = cdpFlag >= 0 ? args[cdpFlag + 1] : undefined;
const tabUrlFlag = args.indexOf('--tab-url');
const tabUrl = tabUrlFlag >= 0 ? args[tabUrlFlag + 1] : undefined;
const tabTitleFlag = args.indexOf('--tab-title');
const tabTitle = tabTitleFlag >= 0 ? args[tabTitleFlag + 1] : undefined;
const timeoutFlag = args.indexOf('--timeout');
const timeoutMs = timeoutFlag >= 0 ? Number(args[timeoutFlag + 1]) : undefined;
const scenarioTimeoutFlag = args.indexOf('--scenario-timeout');
const scenarioTimeoutMs = scenarioTimeoutFlag >= 0 ? Number(args[scenarioTimeoutFlag + 1]) : undefined;
const maxBodyFlag = args.indexOf('--max-response-bytes');
const maxResponseBodyBytes = maxBodyFlag >= 0 ? Number(args[maxBodyFlag + 1]) : undefined;
const headed = args.includes('--headed');
const foreground = args.includes('--foreground');
const browserFlag = args.indexOf('--browser');
const browser = browserFlag >= 0 ? args[browserFlag + 1] : undefined;

if (!['run', 'plan'].includes(command) || (targetMode && !['launch', 'existing'].includes(targetMode)) || (browser && !['chromium', 'edge', 'firefox', 'webkit'].includes(browser)) || (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) || (scenarioTimeoutMs !== undefined && (!Number.isFinite(scenarioTimeoutMs) || scenarioTimeoutMs <= 0)) || (maxResponseBodyBytes !== undefined && (!Number.isFinite(maxResponseBodyBytes) || maxResponseBodyBytes <= 0))) { console.error('用法：acceptance-runner <run|plan> <spec.yaml> [--output artifacts] [--reuse] [--target launch|existing] [--browser chromium|edge|firefox|webkit] [--cdp-endpoint URL --tab-url URL --tab-title TITLE] [--timeout ms] [--scenario-timeout ms] [--max-response-bytes bytes] [--headed] [--foreground]'); process.exit(2); }
try {
  const { spec, normalized } = await loadSpec(path.resolve(specFile));
  if (command === 'plan') { console.log(JSON.stringify({ specId: spec.specId, scenarios: spec.scenarios.map((scenario) => ({ id: scenario.id, priority: scenario.priority ?? 'normal' })) }, null, 2)); process.exit(0); }
  const browserTarget = targetMode || browser ? { mode: (targetMode ?? 'launch') as 'launch' | 'existing', browser: browser as 'chromium' | 'edge' | 'firefox' | 'webkit' | undefined, headless: !headed, background: !foreground, connection: targetMode === 'existing' && cdpEndpoint ? { type: 'cdp' as const, endpoint: cdpEndpoint } : undefined, target: tabUrl || tabTitle ? { url: tabUrl, tabTitle } : undefined } : undefined;
  const results = await runAcceptance({ spec, normalizedSpec: normalized, outputDir: path.resolve(outputDir), reuse, browserTarget, timeoutMs, scenarioTimeoutMs, maxResponseBodyBytes });
  console.log(JSON.stringify({ specId: spec.specId, total: results.length, pass: results.filter((r) => r.decision === 'pass').length, fail: results.filter((r) => r.decision === 'fail').length, needsReview: results.filter((r) => r.decision === 'needs_review').length, results }, null, 2));
  process.exit(results.some((result) => result.decision === 'fail' || result.status === 'blocked') ? 1 : results.some((result) => result.decision === 'needs_review') ? 2 : 0);
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exit(1); }
