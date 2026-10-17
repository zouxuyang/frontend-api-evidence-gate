import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import type { AcceptanceResult, AcceptanceSpec, CheckResult, RequestEvidence, ResponseEvidence, ScenarioSpec } from './types.js';
import { buildHashes, readReusableResult } from './fingerprint.js';
import { NoopModelAdapter, type ModelAdapter } from './model.js';

export interface RunOptions { spec: AcceptanceSpec; normalizedSpec: string; outputDir: string; baseUrl?: string; browser?: 'chromium' | 'firefox' | 'webkit'; model?: ModelAdapter; reuse?: boolean; }

export async function runAcceptance(options: RunOptions): Promise<AcceptanceResult[]> {
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;
  const results: AcceptanceResult[] = [];
  const model = options.model ?? new NoopModelAdapter();
  const browser = await (options.browser === 'firefox' ? (await import('playwright')).firefox : options.browser === 'webkit' ? (await import('playwright')).webkit : chromium).launch({ headless: true });
  try {
    for (const scenario of options.spec.scenarios) {
      const hashes = buildHashes(options.spec, options.normalizedSpec, scenario, { browser: options.browser ?? 'chromium' });
      const artifactDir = path.join(options.outputDir, runId, scenario.id);
      const previous = options.reuse ? await readReusableResult(path.join(options.outputDir, 'latest', scenario.id, 'acceptance-result.json'), hashes.scenarioHash) : null;
      if (previous) {
        results.push({ ...previous, runId, status: 'reused', reusedFrom: previous.runId });
        continue;
      }
      results.push(await runScenario(browser, options, model, scenario, hashes, runId, artifactDir));
    }
  } finally { await browser.close(); }
  await mkdir(path.join(options.outputDir, runId), { recursive: true });
  await writeFile(path.join(options.outputDir, runId, 'run-summary.json'), JSON.stringify({ runId, specId: options.spec.specId, results }, null, 2));
  return results;
}

async function runScenario(browser: Browser, options: RunOptions, model: ModelAdapter, scenario: ScenarioSpec, fingerprint: AcceptanceResult['fingerprint'], runId: string, artifactDir: string): Promise<AcceptanceResult> {
  await mkdir(artifactDir, { recursive: true });
  const page = await browser.newPage();
  await page.context().tracing.start({ screenshots: true, snapshots: true });
  const requests: RequestEvidence[] = [];
  const responses: ResponseEvidence[] = [];
  const checks: CheckResult[] = [];
  const started = new Map<string, number>();
  page.on('request', (request) => { const id = `${request.method()}-${request.url()}-${Date.now()}`; started.set(request.url(), Date.now()); requests.push({ requestId: id, apiId: matchApiId(request.url(), request.method(), options.spec.apis ?? []), startedAt: new Date().toISOString(), method: request.method(), url: request.url(), headers: redact(request.headers()), body: safeJson(request.postData()) }); });
  page.on('response', async (response) => { const begin = started.get(response.url()) ?? Date.now(); const contentType = response.headers()['content-type']; let body: unknown; let rawBody: string | undefined; try { rawBody = await response.text(); body = contentType?.includes('json') ? JSON.parse(rawBody) : undefined; } catch { /* 保留 rawBody */ } const request = requests.find((r) => r.url === response.url()); responses.push({ apiId: request?.apiId, url: response.url(), requestId: request?.requestId ?? response.url(), status: response.status(), durationMs: Date.now() - begin, headers: redact(response.headers()), contentType, body, rawBody: body === undefined ? rawBody : undefined }); });
  try {
    for (const step of scenario.steps) await executeStep(page, step, options.baseUrl ?? options.spec.project?.baseUrl ?? '', checks, requests, responses);
    const screenshot = path.join(artifactDir, 'screenshot.png'); await page.screenshot({ path: screenshot, fullPage: true });
    await page.context().tracing.stop({ path: path.join(artifactDir, 'trace.zip') }).catch(() => undefined);
    const modelReview = await model.review({ spec: options.spec, scenario, checks, screenshotPath: screenshot });
    const decision = checks.some((check) => check.status === 'failed') ? 'fail' : modelReview.status === 'passed' ? 'pass' : 'needs_review';
    const result: AcceptanceResult = { runId, specId: options.spec.specId, specVersion: options.spec.specVersion, scenarioId: scenario.id, status: decision === 'fail' ? 'failed' : 'passed', decision, fingerprint, reusedFrom: null, evidence: { screenshot, trace: path.join(artifactDir, 'trace.zip'), checks: path.join(artifactDir, 'checks.json'), requests: path.join(artifactDir, 'requests.json'), responses: path.join(artifactDir, 'responses.json') }, requests, responses, checks, findings: modelReview.findings, aiReview: modelReview };
    await writeArtifacts(artifactDir, result);
    await updateLatest(options.outputDir, scenario.id, artifactDir);
    return result;
  } catch (error) {
    const result: AcceptanceResult = { runId, specId: options.spec.specId, specVersion: options.spec.specVersion, scenarioId: scenario.id, status: 'blocked', decision: 'needs_review', fingerprint, reusedFrom: null, evidence: { screenshot: '', checks: path.join(artifactDir, 'checks.json'), requests: path.join(artifactDir, 'requests.json'), responses: path.join(artifactDir, 'responses.json') }, requests, responses, checks: [...checks, { id: `${scenario.id}.runtime`, type: 'runtime', status: 'blocked', message: error instanceof Error ? error.message : String(error) }], findings: [] };
    await writeArtifacts(artifactDir, result);
    await updateLatest(options.outputDir, scenario.id, artifactDir);
    return result;
  } finally { await page.close(); }
}

async function executeStep(page: Page, step: Record<string, unknown>, baseUrl: string, checks: CheckResult[], requests: RequestEvidence[], responses: ResponseEvidence[]) {
  if (typeof step.open === 'string') { await page.goto(new URL(step.open, baseUrl || 'http://localhost').toString()); return; }
  if (step.click && typeof step.click === 'object') { await (await locator(page, step.click as Record<string, unknown>)).click(); return; }
  if (step.fill && typeof step.fill === 'object') { const value = step.fill as Record<string, unknown>; await page.getByLabel(String(value.label)).fill(String(value.value)); return; }
  if (step.assertVisible && typeof step.assertVisible === 'object') { const target = await locator(page, step.assertVisible as Record<string, unknown>); const visible = await target.isVisible(); checks.push({ id: `assertVisible-${checks.length + 1}`, type: 'visibility', status: visible ? 'passed' : 'failed', actual: visible }); return; }
  if (step.assertRequest && typeof step.assertRequest === 'object') {
    const expected = step.assertRequest as Record<string, unknown>;
    const api = String(expected.api ?? '');
    const actual = await waitFor(() => [...requests].reverse().find((request) => (request.apiId === api || request.url.includes(api)) && matchesRequest(request, expected)), 2000);
    const pass = Boolean(actual);
    checks.push({ id: `assertRequest-${checks.length + 1}`, type: 'api-contract', status: pass ? 'passed' : 'failed', expected, actual });
    return;
  }
  if (step.assertResponse && typeof step.assertResponse === 'object') {
    const expected = step.assertResponse as Record<string, unknown>;
    const api = String(expected.api ?? '');
    const actual = await waitFor(() => [...responses].reverse().find((response) => (response.apiId === api || response.url?.includes(api)) && (expected.status === undefined || response.status === Number(expected.status)) && matchesResponse(response, expected)), 2000);
    const pass = Boolean(actual);
    checks.push({ id: `assertResponse-${checks.length + 1}`, type: 'api-response', status: pass ? 'passed' : 'failed', expected, actual });
    return;
  }
  throw new Error(`不支持的验收动作：${JSON.stringify(step)}`);
}

async function waitFor<T>(read: () => T | undefined, timeoutMs: number): Promise<T | undefined> { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { const value = read(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 50)); } return read(); }
function matchesResponse(actual: ResponseEvidence, expected: Record<string, unknown>) { if (!expected.query || typeof expected.query !== 'object') return true; const url = actual.url ?? actual.requestId; return Object.entries(expected.query as Record<string, unknown>).every(([key, value]) => url.includes(`${key}=${encodeURIComponent(String(value))}`)); }
function matchesRequest(actual: RequestEvidence, expected: Record<string, unknown>) { const method = expected.method ? actual.method === String(expected.method).toUpperCase() : true; const query = expected.query && typeof expected.query === 'object' ? Object.entries(expected.query as Record<string, unknown>).every(([key, value]) => new URL(actual.url).searchParams.get(key) === String(value)) : true; const body = expected.body === undefined || JSON.stringify(actual.body) === JSON.stringify(expected.body); return method && query && body; }
function matchApiId(url: string, method: string, apis: Array<{ id: string; method: string; path: string }>) { const parsed = new URL(url); return apis.find((api) => api.method.toUpperCase() === method.toUpperCase() && pathMatches(parsed.pathname, api.path))?.id; }
function pathMatches(actual: string, template: string) { const actualParts = actual.split('/').filter(Boolean); const templateParts = template.split('/').filter(Boolean); return actualParts.length === templateParts.length && templateParts.every((part, index) => part.startsWith(':') || part === actualParts[index]); }
async function locator(page: Page, target: Record<string, unknown>) { if (target.role) return page.getByRole(String(target.role) as any, target.name ? { name: String(target.name) } : undefined); if (target.text) return page.getByText(String(target.text)); if (target.label) return page.getByLabel(String(target.label)); throw new Error(`缺少可执行定位器：${JSON.stringify(target)}`); }
async function writeArtifacts(dir: string, result: AcceptanceResult) { await writeFile(path.join(dir, 'acceptance-result.json'), JSON.stringify(result, null, 2)); await writeFile(path.join(dir, 'checks.json'), JSON.stringify(result.checks, null, 2)); await writeFile(path.join(dir, 'requests.json'), JSON.stringify(result.requests, null, 2)); await writeFile(path.join(dir, 'responses.json'), JSON.stringify(result.responses, null, 2)); }
async function updateLatest(outputDir: string, scenarioId: string, artifactDir: string) { const latest = path.join(outputDir, 'latest', scenarioId); await mkdir(latest, { recursive: true }); await cp(path.join(artifactDir, 'acceptance-result.json'), path.join(latest, 'acceptance-result.json')); }
function safeJson(value: string | null): unknown { if (!value) return undefined; try { return JSON.parse(value); } catch { return value; } }
function redact(headers: Record<string, string>) { return Object.fromEntries(Object.entries(headers).map(([key, value]) => /authorization|cookie|token|secret/i.test(key) ? [key, '[REDACTED]'] : [key, value])); }
