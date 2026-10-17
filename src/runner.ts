import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page, type Request } from 'playwright';
import Ajv2020 from 'ajv/dist/2020.js';
import type { AcceptanceResult, AcceptanceSpec, BrowserTarget, CheckResult, RequestEvidence, ResponseEvidence, ScenarioSpec, StepResult } from './types.js';
import { buildHashes, readReusableResult } from './fingerprint.js';
import type { ModelAdapter } from './model.js';

export interface RunOptions {
  spec: AcceptanceSpec;
  normalizedSpec: string;
  outputDir: string;
  baseUrl?: string;
  browser?: 'chromium' | 'firefox' | 'webkit';
  browserTarget?: BrowserTarget;
  model?: ModelAdapter;
  reuse?: boolean;
  screenshotMode?: 'final' | 'each-step';
}

export async function runAcceptance(options: RunOptions): Promise<AcceptanceResult[]> {
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;
  const results: AcceptanceResult[] = [];
  const target = options.browserTarget ?? options.spec.browser ?? { mode: 'launch' };
  const pending: Array<{ scenario: ScenarioSpec; hashes: AcceptanceResult['fingerprint']; artifactDir: string }> = [];
  for (const scenario of options.spec.scenarios) {
    const hashes = buildHashes(options.spec, options.normalizedSpec, scenario, { browser: target.browser ?? options.browser ?? 'chromium', mode: target.mode ?? 'launch', target: target.target, screenshotMode: options.screenshotMode ?? options.spec.quality?.screenshot });
    const artifactDir = path.join(options.outputDir, runId, scenario.id);
    const previous = options.reuse ? await readReusableResult(path.join(options.outputDir, 'latest', scenario.id, 'acceptance-result.json'), hashes.scenarioHash) : null;
    if (previous) results.push({ ...previous, runId, status: 'reused', reusedFrom: previous.runId });
    else pending.push({ scenario, hashes, artifactDir });
  }
  if (pending.length === 0) {
    await writeRunSummary(options.outputDir, runId, options.spec, results);
    return results;
  }
  let browser: Browser;
  try { browser = await connectBrowser(target, options.browser); }
  catch (error) {
    for (const item of pending) results.push(await writeBlockedResult(options, item.scenario, item.hashes, runId, item.artifactDir, error));
    await writeRunSummary(options.outputDir, runId, options.spec, results);
    return results;
  }
  try {
    for (const item of pending) results.push(await runScenario(browser, options, item.scenario, item.hashes, runId, item.artifactDir, target));
  } finally {
    await browser.close();
  }
  await writeRunSummary(options.outputDir, runId, options.spec, results);
  return results;
}

async function connectBrowser(target: BrowserTarget, browserName?: RunOptions['browser']): Promise<Browser> {
  if (target.mode === 'existing') {
    if (!target.connection?.endpoint) throw new Error('已有浏览器模式缺少 CDP endpoint');
    if (target.browser && target.browser !== 'chromium') throw new Error('已有浏览器模式当前只支持 Chromium/CDP');
    return chromium.connectOverCDP(target.connection.endpoint);
  }
  const name = target.browser ?? browserName ?? 'chromium';
  const launcher = name === 'firefox' ? (await import('playwright')).firefox : name === 'webkit' ? (await import('playwright')).webkit : chromium;
  return launcher.launch({ headless: target.headless ?? true });
}

async function runScenario(browser: Browser, options: RunOptions, scenario: ScenarioSpec, fingerprint: AcceptanceResult['fingerprint'], runId: string, artifactDir: string, target: BrowserTarget): Promise<AcceptanceResult> {
  await mkdir(path.join(artifactDir, 'screenshots'), { recursive: true });
  const requests: RequestEvidence[] = [];
  const responses: ResponseEvidence[] = [];
  const checks: CheckResult[] = [];
  const steps: StepResult[] = [];
  let page: Page | undefined;
  let tracingContext: BrowserContext | undefined;
  let detachNetwork: (() => void) | undefined;
  const consoleMessages: Array<Record<string, unknown>> = [];
  try {
    page = await selectPage(browser, target);
    tracingContext = page.context();
    const traceEnabled = options.spec.quality?.trace !== false;
    if (traceEnabled) await tracingContext.tracing.start({ screenshots: true, snapshots: true });
    detachNetwork = attachNetworkEvidence(page, options.spec, requests, responses, consoleMessages, options.spec.quality?.redactSensitiveData !== false);
    if (shouldCaptureEachStep(options)) await page.screenshot({ path: path.join(artifactDir, 'screenshots', '000-before.png'), fullPage: true });
    for (const rawStep of scenario.steps) {
      const step = normalizeStep(rawStep, steps.length + 1);
      const beforeChecks = checks.length;
      try {
        const explicitEvidence = await executeStep(page, step, options.baseUrl ?? options.spec.project?.baseUrl ?? '', checks, requests, responses, () => captureStepScreenshot(page!, artifactDir, steps.length + 1));
        const screenshot = shouldCaptureEachStep(options) ? await captureStepScreenshot(page, artifactDir, steps.length + 1) : undefined;
        steps.push({ stepId: step.id, action: step.action, status: checks.slice(beforeChecks).some((check) => check.status === 'failed') ? 'failed' : 'passed', evidenceRefs: [...explicitEvidence, ...(screenshot ? [screenshot] : [])] });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const screenshot = await captureStepScreenshot(page, artifactDir, steps.length + 1);
        steps.push({ stepId: step.id, action: step.action, status: 'blocked', message, evidenceRefs: [screenshot] });
        throw error;
      }
    }
    if (options.spec.quality?.consoleErrors === 'fail' && consoleMessages.length > 0) checks.push({ id: `${scenario.id}.console`, type: 'console-error', status: 'failed', actual: consoleMessages });
    const screenshot = path.join(artifactDir, 'screenshot.png');
    await page.screenshot({ path: screenshot, fullPage: true });
    const tracePath = options.spec.quality?.trace === false ? undefined : path.join(artifactDir, 'trace.zip');
    if (tracePath) await tracingContext.tracing.stop({ path: tracePath }).catch(() => undefined);
    const modelReview = options.model ? await options.model.review({ spec: options.spec, scenario, checks, screenshotPath: screenshot }) : undefined;
    const decision = checks.some((check) => check.status === 'failed') ? 'fail' : modelReview?.status === 'failed' ? 'fail' : modelReview?.status === 'needs_review' ? 'needs_review' : 'pass';
    const result: AcceptanceResult = {
      runId, taskId: options.spec.taskId, specId: options.spec.specId, specVersion: options.spec.specVersion, scenarioId: scenario.id,
      status: decision === 'fail' ? 'failed' : 'passed', decision, fingerprint, reusedFrom: null,
      evidence: { screenshot, screenshots: steps.flatMap((step) => step.evidenceRefs), trace: tracePath, console: path.join(artifactDir, 'console.json'), checks: path.join(artifactDir, 'checks.json'), requests: path.join(artifactDir, 'requests.json'), responses: path.join(artifactDir, 'responses.json') },
      requests, responses, checks, steps, findings: modelReview?.findings ?? [], ...(modelReview ? { aiReview: modelReview } : {})
    };
    await writeArtifacts(artifactDir, result);
    await updateLatest(options.outputDir, scenario.id, artifactDir);
    return result;
  } catch (error) {
    const runtimeCheck: CheckResult = { id: `${scenario.id}.runtime`, type: 'runtime', status: 'blocked', message: error instanceof Error ? error.message : String(error) };
    const tracePath = options.spec.quality?.trace === false ? undefined : path.join(artifactDir, 'trace.zip');
    if (tracePath) await tracingContext?.tracing.stop({ path: tracePath }).catch(() => undefined);
    const result: AcceptanceResult = {
      runId, taskId: options.spec.taskId, specId: options.spec.specId, specVersion: options.spec.specVersion, scenarioId: scenario.id,
      status: 'blocked', decision: 'needs_review', fingerprint, reusedFrom: null,
      evidence: { screenshot: '', screenshots: steps.flatMap((step) => step.evidenceRefs), trace: tracePath, console: path.join(artifactDir, 'console.json'), checks: path.join(artifactDir, 'checks.json'), requests: path.join(artifactDir, 'requests.json'), responses: path.join(artifactDir, 'responses.json') },
      requests, responses, checks: [...checks, runtimeCheck], steps, findings: []
    };
    await writeArtifacts(artifactDir, result);
    await updateLatest(options.outputDir, scenario.id, artifactDir);
    return result;
  } finally {
    detachNetwork?.();
    await writeFile(path.join(artifactDir, 'console.json'), JSON.stringify(consoleMessages, null, 2));
    if (target.mode !== 'existing') await page?.close();
  }
}

async function selectPage(browser: Browser, target: BrowserTarget): Promise<Page> {
  if (target.mode !== 'existing') return browser.newPage();
  const pages = browser.contexts().flatMap((context) => context.pages());
  const wanted = target.target;
  const urlMatches = pages.filter((candidate) => !wanted?.url || candidate.url() === wanted.url || candidate.url().startsWith(wanted.url));
  const matches = wanted?.tabTitle
    ? (await Promise.all(urlMatches.map(async (candidate) => [candidate, await candidate.title().catch(() => '')] as const))).filter(([, title]) => title === wanted.tabTitle).map(([candidate]) => candidate)
    : urlMatches;
  const page = matches[wanted?.index ?? 0];
  if (!page) throw new Error('未找到可用浏览器标签页');
  return page;
}

function attachNetworkEvidence(page: Page, spec: AcceptanceSpec, requests: RequestEvidence[], responses: ResponseEvidence[], consoleMessages: Array<Record<string, unknown>>, redactSensitiveData: boolean) {
  const started = new Map<Request, number>();
  const requestEvidence = new Map<Request, RequestEvidence>();
  const onRequest = (request: Request) => {
    const id = `${request.method()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    started.set(request, Date.now());
    const evidence = { requestId: id, apiId: matchApiId(request.url(), request.method(), spec.apis ?? []), startedAt: new Date().toISOString(), method: request.method(), url: request.url(), headers: redact(request.headers()), body: redactSensitiveData ? redactValue(safeJson(request.postData())) : safeJson(request.postData()) };
    requestEvidence.set(request, evidence);
    requests.push(evidence);
  };
  const onResponse = async (response: import('playwright').Response) => {
    const request = requestEvidence.get(response.request());
    const begin = request ? started.get(response.request()) ?? Date.now() : Date.now();
    const contentType = response.headers()['content-type'];
    let body: unknown; let rawBody: string | undefined;
    if (request?.apiId) {
      try { rawBody = await response.text(); body = contentType?.includes('json') ? JSON.parse(rawBody) : undefined; } catch { /* 保留 rawBody */ }
    }
    responses.push({ apiId: request?.apiId, url: response.url(), requestId: request?.requestId ?? response.url(), status: response.status(), durationMs: Date.now() - begin, headers: redact(response.headers()), contentType, body: redactSensitiveData ? redactValue(body) : body, rawBody: body === undefined ? rawBody : undefined });
  };
  const onConsole = (message: import('playwright').ConsoleMessage) => { if (message.type() === 'error') consoleMessages.push({ type: 'console', text: message.text(), location: message.location() }); };
  const onPageError = (error: Error) => consoleMessages.push({ type: 'pageerror', message: error.message, stack: error.stack });
  page.on('request', onRequest); page.on('response', onResponse); page.on('console', onConsole); page.on('pageerror', onPageError);
  return () => { page.off('request', onRequest); page.off('response', onResponse); page.off('console', onConsole); page.off('pageerror', onPageError); };
}

type ExecutableStep = Record<string, unknown> & { id: string; action: string };
function normalizeStep(raw: Record<string, unknown>, index: number): ExecutableStep {
  if (typeof raw.action === 'string') return { ...raw, id: String(raw.id ?? `step-${index}`), action: raw.action };
  const legacy = Object.keys(raw)[0];
  return { ...raw, id: `step-${index}`, action: legacy ?? '' };
}

async function executeStep(page: Page, step: ExecutableStep, baseUrl: string, checks: CheckResult[], requests: RequestEvidence[], responses: ResponseEvidence[], capture: () => Promise<string>): Promise<string[]> {
  const action = step.action;
  const target = step.target && typeof step.target === 'object' ? step.target as Record<string, unknown> : undefined;
  if (action === 'open' || typeof step.open === 'string') { await page.goto(new URL(String(step.open ?? step.path ?? step.url), baseUrl || 'http://localhost').toString()); return []; }
  if (action === 'attach') return [];
  if (action === 'click' || (step.click && typeof step.click === 'object')) { await (await locator(page, target ?? step.click as Record<string, unknown>)).click(); return []; }
  if (action === 'fill' || (step.fill && typeof step.fill === 'object')) { const value = (step.fill ?? step) as Record<string, unknown>; await (await locator(page, target ?? value)).fill(String(step.value ?? value.value ?? '')); return []; }
  if (action === 'select') { await (await locator(page, target ?? {})).selectOption(String(step.value)); return []; }
  if (action === 'upload') { await (await locator(page, target ?? {})).setInputFiles(String(step.file ?? step.value)); return []; }
  if (action === 'press') { await (await locator(page, target ?? {})).press(String(step.key ?? 'Enter')); return []; }
  if (action === 'waitFor') {
    if (target) await (await locator(page, target)).waitFor({ state: (step.state as 'attached' | 'detached' | 'visible' | 'hidden' | undefined) ?? 'visible', timeout: Number(step.timeoutMs ?? 5000) });
    else await page.waitForTimeout(Number(step.timeoutMs ?? 250));
    return [];
  }
  if (action === 'screenshot') return [await capture()];
  if (action === 'assertVisible' || (step.assertVisible && typeof step.assertVisible === 'object')) { const expected = target ?? step.assertVisible as Record<string, unknown>; const actual = await (await locator(page, expected)).isVisible(); const wanted = typeof step.expected === 'boolean' ? step.expected : true; checks.push({ id: `assertVisible-${checks.length + 1}`, type: 'visibility', status: actual === wanted ? 'passed' : 'failed', expected: wanted, actual }); return []; }
  if (action === 'assertText') { const actual = await (await locator(page, target ?? {})).innerText(); const expected = String(step.expected ?? step.text ?? ''); checks.push({ id: `assertText-${checks.length + 1}`, type: 'text', status: actual.includes(expected) ? 'passed' : 'failed', expected, actual }); return []; }
  if (action === 'assertValue') { const actual = await (await locator(page, target ?? {})).inputValue(); const expected = String(step.expected ?? ''); checks.push({ id: `assertValue-${checks.length + 1}`, type: 'value', status: actual === expected ? 'passed' : 'failed', expected, actual }); return []; }
  if (action === 'assertValidation') { const expected = step.expected as Record<string, unknown> ?? {}; const element = await locator(page, target ?? {}); const message = expected.message ? page.getByText(String(expected.message)).first() : element; const actual = await message.isVisible(); checks.push({ id: `assertValidation-${checks.length + 1}`, type: 'validation', status: actual === Boolean(expected.visible ?? true) ? 'passed' : 'failed', expected, actual }); return []; }
  if (action === 'assertRequest' || (step.assertRequest && typeof step.assertRequest === 'object')) { const expected = (step.expected ?? step.assertRequest) as Record<string, unknown>; const api = String(step.api ?? expected.api ?? ''); const actual = await waitFor(() => [...requests].reverse().find((request) => (request.apiId === api || request.url.includes(api)) && matchesRequest(request, expected)), 2000); checks.push({ id: `assertRequest-${checks.length + 1}`, type: 'api-contract', status: actual ? 'passed' : 'failed', expected, actual }); return []; }
  if (action === 'assertResponse' || (step.assertResponse && typeof step.assertResponse === 'object')) { const expected = (step.expected ?? step.assertResponse) as Record<string, unknown>; const api = String(step.api ?? expected.api ?? ''); const actual = await waitFor(() => [...responses].reverse().find((response) => (response.apiId === api || response.url?.includes(api)) && matchesResponse(response, expected, requests)), 2000); checks.push({ id: `assertResponse-${checks.length + 1}`, type: 'api-response', status: actual ? 'passed' : 'failed', expected, actual }); return []; }
  throw new Error(`不支持的验收动作：${JSON.stringify(step)}`);
}

async function captureStepScreenshot(page: Page, artifactDir: string, index: number): Promise<string> { const relative = path.join('screenshots', `${String(index).padStart(3, '0')}-step.png`); await page.screenshot({ path: path.join(artifactDir, relative), fullPage: true }); return relative; }
function shouldCaptureEachStep(options: RunOptions) { return options.screenshotMode === 'each-step' || options.spec.quality?.screenshot === 'each-step'; }
async function waitFor<T>(read: () => T | undefined, timeoutMs: number): Promise<T | undefined> { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { const value = read(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 50)); } return read(); }
function matchesRequest(actual: RequestEvidence, expected: Record<string, unknown>) { const method = expected.method ? actual.method === String(expected.method).toUpperCase() : true; const query = expected.query && typeof expected.query === 'object' ? Object.entries(expected.query as Record<string, unknown>).every(([key, value]) => new URL(actual.url).searchParams.get(key) === String(value)) : true; const body = expected.body === undefined || JSON.stringify(actual.body) === JSON.stringify(expected.body); return method && query && body; }
function matchesResponse(actual: ResponseEvidence, expected: Record<string, unknown>, requests: RequestEvidence[]) {
  if (expected.status !== undefined && actual.status !== Number(expected.status)) return false;
  const request = requests.find((item) => item.requestId === actual.requestId);
  const query = expected.query && request ? Object.entries(expected.query as Record<string, unknown>).every(([key, value]) => new URL(request.url).searchParams.get(key) === String(value)) : true;
  const body = expected.body === undefined || JSON.stringify(actual.body) === JSON.stringify(expected.body);
  if (!query || !body) return false;
  if (expected.schema && actual.body !== undefined) {
    try { if (!new Ajv2020.default({ allErrors: true }).compile(expected.schema)(actual.body)) return false; } catch { return false; }
  }
  return true;
}
function matchApiId(url: string, method: string, apis: Array<{ id: string; method: string; path: string }>) { const parsed = new URL(url); return apis.find((api) => api.method.toUpperCase() === method.toUpperCase() && pathMatches(parsed.pathname, api.path))?.id; }
function pathMatches(actual: string, template: string) { const actualParts = actual.split('/').filter(Boolean); const templateParts = template.split('/').filter(Boolean); return actualParts.length === templateParts.length && templateParts.every((part, index) => part.startsWith(':') || part === actualParts[index]); }
async function locator(page: Page, target: Record<string, unknown>) { if (target.role) return page.getByRole(String(target.role) as any, target.name ? { name: String(target.name) } : undefined); if (target.testId) return page.getByTestId(String(target.testId)); if (target.placeholder) return page.getByPlaceholder(String(target.placeholder)); if (target.text) return page.getByText(String(target.text)); if (target.label) return page.getByLabel(String(target.label)); if (target.css) return page.locator(String(target.css)); throw new Error(`缺少可执行定位器：${JSON.stringify(target)}`); }
async function writeArtifacts(dir: string, result: AcceptanceResult) { await writeFile(path.join(dir, 'acceptance-result.json'), JSON.stringify(result, null, 2)); await writeFile(path.join(dir, 'checks.json'), JSON.stringify(result.checks, null, 2)); await writeFile(path.join(dir, 'requests.json'), JSON.stringify(result.requests, null, 2)); await writeFile(path.join(dir, 'responses.json'), JSON.stringify(result.responses, null, 2)); }
async function updateLatest(outputDir: string, scenarioId: string, artifactDir: string) { const latest = path.join(outputDir, 'latest', scenarioId); await mkdir(latest, { recursive: true }); await cp(path.join(artifactDir, 'acceptance-result.json'), path.join(latest, 'acceptance-result.json')); }
function safeJson(value: string | null): unknown { if (!value) return undefined; try { return JSON.parse(value); } catch { return value; } }
function redact(headers: Record<string, string>) { return Object.fromEntries(Object.entries(headers).map(([key, value]) => /authorization|cookie|token|secret/i.test(key) ? [key, '[REDACTED]'] : [key, value])); }
function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => /authorization|cookie|password|passwd|token|secret|api[-_]?key|phone|mobile|id[-_]?card/i.test(key) ? [key, '[REDACTED]'] : [key, redactValue(item)]));
}
async function writeBlockedResult(options: RunOptions, scenario: ScenarioSpec, fingerprint: AcceptanceResult['fingerprint'], runId: string, artifactDir: string, error: unknown) {
  await mkdir(path.join(artifactDir, 'screenshots'), { recursive: true });
  const result: AcceptanceResult = { runId, taskId: options.spec.taskId, specId: options.spec.specId, specVersion: options.spec.specVersion, scenarioId: scenario.id, status: 'blocked', decision: 'needs_review', fingerprint, reusedFrom: null, evidence: { screenshot: '', checks: path.join(artifactDir, 'checks.json'), requests: path.join(artifactDir, 'requests.json'), responses: path.join(artifactDir, 'responses.json') }, requests: [], responses: [], checks: [{ id: `${scenario.id}.runtime`, type: 'runtime', status: 'blocked', message: error instanceof Error ? error.message : String(error) }], findings: [] };
  await writeArtifacts(artifactDir, result);
  await updateLatest(options.outputDir, scenario.id, artifactDir);
  return result;
}
async function writeRunSummary(outputDir: string, runId: string, spec: AcceptanceSpec, results: AcceptanceResult[]) { await mkdir(path.join(outputDir, runId), { recursive: true }); await writeFile(path.join(outputDir, runId, 'run-summary.json'), JSON.stringify({ runId, taskId: spec.taskId, specId: spec.specId, results }, null, 2)); }
