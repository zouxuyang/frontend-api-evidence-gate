import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Locator, type Page, type Request } from 'playwright';
import Ajv2020 from 'ajv/dist/2020.js';
import AxeBuilder from '@axe-core/playwright';
import type { AcceptanceResult, AcceptanceSpec, BrowserTarget, CheckResult, RequestEvidence, ResponseEvidence, ScenarioSpec, StepResult } from './types.js';
import { buildHashes, readReusableResult } from './fingerprint.js';
import type { ModelAdapter } from './model.js';

export interface RunOptions {
  spec: AcceptanceSpec;
  normalizedSpec: string;
  outputDir: string;
  baseUrl?: string;
  browser?: 'chromium' | 'edge' | 'firefox' | 'webkit';
  browserTarget?: BrowserTarget;
  model?: ModelAdapter;
  reuse?: boolean;
  screenshotMode?: 'final' | 'each-step';
  signal?: AbortSignal;
  timeoutMs?: number;
  maxResponseBodyBytes?: number;
  storageState?: Parameters<Browser['newContext']>[0] extends infer T ? T extends { storageState?: infer S } ? S : never : never;
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
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(options.signal?.reason ?? new Error('验收任务已取消'));
  options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  if (options.signal?.aborted) abortFromCaller();
  const timeout = options.timeoutMs && options.timeoutMs > 0 ? setTimeout(() => controller.abort(new Error(`验收任务超时：${options.timeoutMs}ms`)), options.timeoutMs) : undefined;
  let runOptions: RunOptions = { ...options, signal: controller.signal };
  let browser: Browser;
  let executionTarget = target;
  try {
    if (target.mode === 'existing' && target.background !== false) {
      // Never drive the user's visible tab by default. Copy its auth state into
      // a private headless browser and run every scenario there.
      const attached = await connectBrowser(target, options.browser);
      const source = await selectPage(attached, target);
      const storageState = await source.context().storageState();
      await attached.close();
      browser = await chromium.launch({ headless: true });
      runOptions = { ...runOptions, storageState };
      executionTarget = { ...target, mode: 'launch' };
    } else {
      browser = await connectBrowser(target, options.browser);
    }
  }
  catch (error) {
    for (const item of pending) results.push(await writeBlockedResult(options, item.scenario, item.hashes, runId, item.artifactDir, error));
    options.signal?.removeEventListener('abort', abortFromCaller);
    if (timeout) clearTimeout(timeout);
    await writeRunSummary(options.outputDir, runId, options.spec, results);
    return results;
  }
  try {
    for (const item of pending) results.push(await runScenario(browser, runOptions, item.scenario, item.hashes, runId, item.artifactDir, executionTarget));
  } finally {
    await browser.close();
  }
  options.signal?.removeEventListener('abort', abortFromCaller);
  if (timeout) clearTimeout(timeout);
  await writeRunSummary(options.outputDir, runId, options.spec, results);
  return results;
}

async function connectBrowser(target: BrowserTarget, browserName?: RunOptions['browser']): Promise<Browser> {
  if (target.mode === 'existing') {
    if (!target.connection?.endpoint) throw new Error('已有浏览器模式缺少 CDP endpoint');
    if (target.browser && !['chromium', 'edge'].includes(target.browser)) throw new Error('已有浏览器模式当前只支持 Chromium/Edge/CDP');
    return chromium.connectOverCDP(target.connection.endpoint);
  }
  const name = target.browser ?? browserName ?? 'chromium';
  const launcher = name === 'firefox' ? (await import('playwright')).firefox : name === 'webkit' ? (await import('playwright')).webkit : chromium;
  return launcher.launch({ headless: target.headless ?? true, ...(name === 'edge' ? { channel: 'msedge' } : {}) });
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
    if (target.mode !== 'existing') {
      // axe-core requires a context created with browser.newContext(); the
      // browser's implicit default context is not supported by its runner.
      tracingContext = await browser.newContext(options.storageState ? { storageState: options.storageState } : undefined);
      page = await tracingContext.newPage();
    } else {
      page = await selectPage(browser, target);
      tracingContext = page.context();
    }
    const traceEnabled = options.spec.quality?.trace !== false;
    if (traceEnabled) await tracingContext.tracing.start({ screenshots: true, snapshots: true });
    detachNetwork = attachNetworkEvidence(page, options.spec, requests, responses, consoleMessages, options.spec.quality?.redactSensitiveData !== false, options.maxResponseBodyBytes ?? 1024 * 1024);
    if (shouldCaptureEachStep(options)) await page.screenshot({ path: path.join(artifactDir, 'screenshots', '000-before.png'), fullPage: true });
    for (const rawStep of scenario.steps) {
      ensureActive(options.signal);
      const step = normalizeStep(rawStep, steps.length + 1);
      const beforeChecks = checks.length;
      try {
        const explicitEvidence = await executeStep(page, step, options.baseUrl ?? options.spec.project?.baseUrl ?? '', checks, requests, responses, () => captureStepScreenshot(page!, artifactDir, steps.length + 1), options.signal);
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
    if (options.spec.quality?.layoutOverflow === 'fail') {
      const layout = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight }));
      checks.push({ id: `${scenario.id}.layout`, type: 'layout-overflow', status: layout.scrollWidth <= layout.clientWidth ? 'passed' : 'failed', expected: { overflowX: false }, actual: layout });
    }
    if (options.spec.quality?.accessibility === 'fail') {
      const accessibility = await page.evaluate(() => ({ missingImageAlt: [...document.images].filter((image) => !image.hasAttribute('alt')).length, unlabeledInputs: [...document.querySelectorAll('input,select,textarea')].filter((element) => !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby') && !element.closest('label')).length, unnamedButtons: [...document.querySelectorAll('button')].filter((button) => !(button.textContent?.trim() || button.getAttribute('aria-label') || button.getAttribute('title'))).length }));
      const passed = Object.values(accessibility).every((value) => value === 0);
      checks.push({ id: `${scenario.id}.accessibility`, type: 'accessibility', status: passed ? 'passed' : 'failed', expected: { missingImageAlt: 0, unlabeledInputs: 0, unnamedButtons: 0 }, actual: accessibility });
    }
    let axeReport: unknown;
    if (options.spec.quality?.accessibility === 'axe') {
      axeReport = await new AxeBuilder({ page }).analyze();
      const violations = (axeReport as { violations?: unknown[] }).violations ?? [];
      checks.push({ id: `${scenario.id}.axe`, type: 'accessibility', status: violations.length === 0 ? 'passed' : 'failed', expected: { violations: 0 }, actual: { violations } });
    }
    const screenshot = path.join(artifactDir, 'screenshot.png');
    await page.screenshot({ path: screenshot, fullPage: true });
    const tracePath = options.spec.quality?.trace === false ? undefined : path.join(artifactDir, 'trace.zip');
    if (tracePath) await tracingContext.tracing.stop({ path: tracePath }).catch(() => undefined);
    const modelReview = options.model ? await options.model.review({ spec: options.spec, scenario, checks, screenshotPath: screenshot }) : undefined;
    const decision = checks.some((check) => check.status === 'failed') ? 'fail' : modelReview?.status === 'failed' ? 'fail' : modelReview?.status === 'needs_review' ? 'needs_review' : 'pass';
    const result: AcceptanceResult = {
      runId, taskId: options.spec.taskId, specId: options.spec.specId, specVersion: options.spec.specVersion, scenarioId: scenario.id,
      status: decision === 'fail' ? 'failed' : 'passed', decision, fingerprint, reusedFrom: null,
      evidence: { screenshot, screenshots: steps.flatMap((step) => step.evidenceRefs), trace: tracePath, console: path.join(artifactDir, 'console.json'), axe: axeReport ? path.join(artifactDir, 'axe.json') : undefined, checks: path.join(artifactDir, 'checks.json'), requests: path.join(artifactDir, 'requests.json'), responses: path.join(artifactDir, 'responses.json') },
      requests, responses, checks, steps, findings: modelReview?.findings ?? [], ...(modelReview ? { aiReview: modelReview } : {})
    };
    await writeArtifacts(artifactDir, result);
    if (axeReport) await writeFile(path.join(artifactDir, 'axe.json'), JSON.stringify(axeReport, null, 2));
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
    if (target.mode !== 'existing') {
      await page?.close();
      await tracingContext?.close();
    }
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

function attachNetworkEvidence(page: Page, spec: AcceptanceSpec, requests: RequestEvidence[], responses: ResponseEvidence[], consoleMessages: Array<Record<string, unknown>>, redactSensitiveData: boolean, maxResponseBodyBytes: number) {
  const started = new Map<Request, number>();
  const requestEvidence = new Map<Request, RequestEvidence>();
  const onRequest = (request: Request) => {
    const id = `${request.method()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    started.set(request, Date.now());
    const evidence = { requestId: id, apiId: matchApiId(request.url(), request.method(), spec.apis ?? []), startedAt: new Date().toISOString(), method: request.method(), url: redactUrl(request.url(), redactSensitiveData), headers: redact(request.headers()), body: redactSensitiveData ? redactValue(safeJson(request.postData())) : safeJson(request.postData()) };
    requestEvidence.set(request, evidence);
    requests.push(evidence);
  };
  const onResponse = async (response: import('playwright').Response) => {
    const request = requestEvidence.get(response.request());
    const begin = request ? started.get(response.request()) ?? Date.now() : Date.now();
    const contentType = response.headers()['content-type'];
    let body: unknown; let rawBody: string | undefined;
    if (request?.apiId) {
      try {
        const buffer = await response.body();
        if (buffer.byteLength <= maxResponseBodyBytes) {
          rawBody = buffer.toString('utf8');
          body = contentType?.includes('json') ? JSON.parse(rawBody) : undefined;
          if (redactSensitiveData && body === undefined) rawBody = '[REDACTED: non-JSON response body]';
        } else {
          rawBody = `[REDACTED: response body ${buffer.byteLength} bytes exceeds ${maxResponseBodyBytes} byte limit]`;
        }
      } catch { /* 保留 rawBody */ }
    }
    responses.push({ apiId: request?.apiId, url: redactUrl(response.url(), redactSensitiveData), requestId: request?.requestId ?? response.url(), status: response.status(), durationMs: Date.now() - begin, headers: redact(response.headers()), contentType, body: redactSensitiveData ? redactValue(body) : body, rawBody: body === undefined ? rawBody : undefined });
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

async function executeStep(page: Page, step: ExecutableStep, baseUrl: string, checks: CheckResult[], requests: RequestEvidence[], responses: ResponseEvidence[], capture: () => Promise<string>, signal?: AbortSignal): Promise<string[]> {
  ensureActive(signal);
  const action = step.action;
  const target = step.target && typeof step.target === 'object' ? step.target as Record<string, unknown> : undefined;
  if (action === 'open' || typeof step.open === 'string') { await page.goto(new URL(String(step.open ?? step.path ?? step.url), baseUrl || 'http://localhost').toString()); return []; }
  if (action === 'attach') return [];
  if (action === 'click' || (step.click && typeof step.click === 'object')) { const targetSpec = target ?? step.click as Record<string, unknown>; await uniqueLocator(page, targetSpec, action).then((item) => item.click()); return []; }
  if (action === 'fill' || (step.fill && typeof step.fill === 'object')) { const value = (step.fill ?? step) as Record<string, unknown>; const targetSpec = target ?? value; await uniqueLocator(page, targetSpec, action).then((item) => item.fill(String(step.value ?? value.value ?? ''))); return []; }
  if (action === 'select') { await uniqueLocator(page, target ?? {}, action).then((item) => item.selectOption(String(step.value))); return []; }
  if (action === 'upload') { await uniqueLocator(page, target ?? {}, action).then((item) => item.setInputFiles(String(step.file ?? step.value))); return []; }
  if (action === 'press') { await uniqueLocator(page, target ?? {}, action).then((item) => item.press(String(step.key ?? 'Enter'))); return []; }
  if (action === 'waitFor') {
    if (target) await (await locator(page, target)).waitFor({ state: (step.state as 'attached' | 'detached' | 'visible' | 'hidden' | undefined) ?? 'visible', timeout: Number(step.timeoutMs ?? 5000) });
    else await sleepWithSignal(Number(step.timeoutMs ?? 250), signal);
    return [];
  }
  if (action === 'screenshot') return [await capture()];
  if (action === 'assertVisible' || (step.assertVisible && typeof step.assertVisible === 'object')) { const expected = target ?? step.assertVisible as Record<string, unknown>; const wanted = typeof step.expected === 'boolean' ? step.expected : true; const actual = await waitForVisibility(page, expected, wanted, Number(step.timeoutMs ?? 5000)); checks.push({ id: `assertVisible-${checks.length + 1}`, type: 'visibility', status: actual === wanted ? 'passed' : 'failed', expected: wanted, actual }); return []; }
  if (action === 'assertText') { const actual = await uniqueLocator(page, target ?? {}, action).then((item) => item.innerText()); const expected = String(step.expected ?? step.text ?? ''); checks.push({ id: `assertText-${checks.length + 1}`, type: 'text', status: actual.includes(expected) ? 'passed' : 'failed', expected, actual }); return []; }
  if (action === 'assertValue') { const actual = await uniqueLocator(page, target ?? {}, action).then((item) => item.inputValue()); const expected = String(step.expected ?? ''); checks.push({ id: `assertValue-${checks.length + 1}`, type: 'value', status: actual === expected ? 'passed' : 'failed', expected, actual }); return []; }
  if (action === 'assertValidation') { const expected = step.expected as Record<string, unknown> ?? {}; const element = target ? await locator(page, target) : undefined; const message = expected.message ? page.getByText(String(expected.message), { exact: true }).first() : element; if (!message) throw new Error('assertValidation 缺少 target 或 expected.message'); const actual = await waitForVisibilityLocator(message, Boolean(expected.visible ?? true), Number(step.timeoutMs ?? 5000)); checks.push({ id: `assertValidation-${checks.length + 1}`, type: 'validation', status: actual === Boolean(expected.visible ?? true) ? 'passed' : 'failed', expected, actual }); return []; }
  if (action === 'assertRequest' || (step.assertRequest && typeof step.assertRequest === 'object')) { const expected = (step.expected ?? step.assertRequest) as Record<string, unknown>; const contract = step.bodyMatch ? { ...expected, bodyMatch: step.bodyMatch } : expected; const api = String(step.api ?? contract.api ?? ''); const actual = await waitFor(() => [...requests].reverse().find((request) => (request.apiId === api || request.url.includes(api)) && matchesRequest(request, contract)), 2000, signal); checks.push({ id: `assertRequest-${checks.length + 1}`, type: 'api-contract', status: actual ? 'passed' : 'failed', expected: contract, actual }); return []; }
  if (action === 'assertResponse' || (step.assertResponse && typeof step.assertResponse === 'object')) { const expected = (step.expected ?? step.assertResponse) as Record<string, unknown>; const contract = step.bodyMatch ? { ...expected, bodyMatch: step.bodyMatch } : expected; const api = String(step.api ?? contract.api ?? ''); const actual = await waitFor(() => [...responses].reverse().find((response) => (response.apiId === api || response.url?.includes(api)) && matchesResponse(response, contract, requests)), 2000, signal); checks.push({ id: `assertResponse-${checks.length + 1}`, type: 'api-response', status: actual ? 'passed' : 'failed', expected: contract, actual }); return []; }
  throw new Error(`不支持的验收动作：${JSON.stringify(step)}`);
}

async function captureStepScreenshot(page: Page, artifactDir: string, index: number): Promise<string> { const relative = path.join('screenshots', `${String(index).padStart(3, '0')}-step.png`); await page.screenshot({ path: path.join(artifactDir, relative), fullPage: true }); return relative; }
function shouldCaptureEachStep(options: RunOptions) { return options.screenshotMode === 'each-step' || options.spec.quality?.screenshot === 'each-step'; }
async function waitFor<T>(read: () => T | undefined, timeoutMs: number, signal?: AbortSignal): Promise<T | undefined> { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { ensureActive(signal); const value = read(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 50)); } ensureActive(signal); return read(); }
function ensureActive(signal?: AbortSignal) { if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('验收任务已取消'); }
async function sleepWithSignal(timeoutMs: number, signal?: AbortSignal) {
  ensureActive(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, timeoutMs);
    const onAbort = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(signal?.reason instanceof Error ? signal.reason : new Error('验收任务已取消')); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  ensureActive(signal);
}
function matchesRequest(actual: RequestEvidence, expected: Record<string, unknown>) { const method = expected.method ? actual.method === String(expected.method).toUpperCase() : true; const query = matchesQuery(actual.url, expected.query); const body = expected.body === undefined || matchesPayload(actual.body, expected.body, expected.bodyMatch); return method && query && body; }
function matchesResponse(actual: ResponseEvidence, expected: Record<string, unknown>, requests: RequestEvidence[]) {
  if (expected.status !== undefined && actual.status !== Number(expected.status)) return false;
  const request = requests.find((item) => item.requestId === actual.requestId);
  const query = expected.query && request ? matchesQuery(request.url, expected.query) : true;
  const body = expected.body === undefined || matchesPayload(actual.body, expected.body, expected.bodyMatch);
  if (!query || !body) return false;
  if (expected.schema) {
    if (actual.body === undefined) return false;
    try { if (!new Ajv2020.default({ allErrors: true }).compile(expected.schema)(actual.body)) return false; } catch { return false; }
  }
  return true;
}
function matchesQuery(url: string, expected: unknown): boolean {
  if (!expected || typeof expected !== 'object') return true;
  const params = new URL(url).searchParams;
  return Object.entries(expected as Record<string, unknown>).every(([key, value]) => {
    const actual = params.getAll(key);
    const wanted = Array.isArray(value) ? value.map(String) : [String(value)];
    return actual.length === wanted.length && actual.every((item, index) => item === wanted[index]);
  });
}
function matchesPayload(actual: unknown, expected: unknown, mode: unknown): boolean {
  if (mode !== 'subset') return JSON.stringify(actual) === JSON.stringify(expected);
  if (expected === null || typeof expected !== 'object') return actual === expected;
  if (!actual || typeof actual !== 'object') return false;
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.every((item, index) => matchesPayload((actual as unknown[])[index], item, mode));
  return Object.entries(expected as Record<string, unknown>).every(([key, value]) => matchesPayload((actual as Record<string, unknown>)[key], value, mode));
}
function matchApiId(url: string, method: string, apis: Array<{ id: string; method: string; path: string }>) { const parsed = new URL(url); return apis.find((api) => api.method.toUpperCase() === method.toUpperCase() && pathMatches(parsed.pathname, api.path))?.id; }
function pathMatches(actual: string, template: string) { const actualParts = actual.split('/').filter(Boolean); const templateParts = template.split('/').filter(Boolean); return actualParts.length === templateParts.length && templateParts.every((part, index) => part.startsWith(':') || part === actualParts[index]); }
async function locator(page: Page, target: Record<string, unknown>): Promise<Locator> {
  const exact = typeof target.exact === 'boolean' ? target.exact : undefined;
  let result: Locator;
  if (target.role) result = page.getByRole(String(target.role) as any, { ...(target.name ? { name: String(target.name) } : {}), ...(exact === undefined ? {} : { exact }) });
  else if (target.testId) result = page.getByTestId(String(target.testId));
  else if (target.placeholder) result = page.getByPlaceholder(String(target.placeholder), exact === undefined ? undefined : { exact });
  else if (target.text) result = page.getByText(String(target.text), exact === undefined ? undefined : { exact });
  else if (target.label) result = page.getByLabel(String(target.label), exact === undefined ? undefined : { exact });
  else if (target.css) result = page.locator(String(target.css));
  else throw new Error(`缺少可执行定位器：${JSON.stringify(target)}`);
  if (typeof target.nth === 'number') return result.nth(target.nth);
  if (target.first === true) return result.first();
  if (target.last === true) return result.last();
  return result;
}

async function uniqueLocator(page: Page, target: Record<string, unknown>, action: string): Promise<Locator> {
  const result = await locator(page, target);
  const count = await result.count();
  if (count !== 1) {
    const hint = count > 1 ? '请增加 exact、nth、first/last 或作用域 CSS 定位。' : '请检查页面是否完成渲染或定位器是否正确。';
    throw new Error(`验收定位器不唯一：action=${action}，匹配数量=${count}，target=${JSON.stringify(target)}。${hint}`);
  }
  return result;
}

async function waitForVisibility(page: Page, target: Record<string, unknown>, wanted: boolean, timeoutMs: number): Promise<boolean> {
  const result = await locator(page, target);
  return (await waitFor(() => visibility(result, wanted), timeoutMs)) ?? !wanted;
}

async function waitForVisibilityLocator(result: Locator, wanted: boolean, timeoutMs: number): Promise<boolean> {
  return (await waitFor(() => visibility(result, wanted), timeoutMs)) ?? !wanted;
}

async function visibility(result: Locator, wanted: boolean): Promise<boolean | undefined> {
  const count = await result.count();
  if (count !== 1) {
    if (count > 1) throw new Error(`验收断言定位器匹配 ${count} 个元素，请使用 exact、nth、first/last 或作用域 CSS 定位。`);
    return wanted ? undefined : true;
  }
  const actual = await result.isVisible();
  return actual === wanted ? actual : undefined;
}
async function writeArtifacts(dir: string, result: AcceptanceResult) { await writeFile(path.join(dir, 'acceptance-result.json'), JSON.stringify(result, null, 2)); await writeFile(path.join(dir, 'checks.json'), JSON.stringify(result.checks, null, 2)); await writeFile(path.join(dir, 'requests.json'), JSON.stringify(result.requests, null, 2)); await writeFile(path.join(dir, 'responses.json'), JSON.stringify(result.responses, null, 2)); }
async function updateLatest(outputDir: string, scenarioId: string, artifactDir: string) { const latest = path.join(outputDir, 'latest', scenarioId); await mkdir(latest, { recursive: true }); await cp(path.join(artifactDir, 'acceptance-result.json'), path.join(latest, 'acceptance-result.json')); }
function safeJson(value: string | null): unknown { if (!value) return undefined; try { return JSON.parse(value); } catch { return value; } }
function redactUrl(raw: string, redactSensitiveData: boolean): string {
  if (!redactSensitiveData) return raw;
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) {
      if (/authorization|cookie|password|passwd|token|secret|api[-_]?key|phone|mobile|id[-_]?card/i.test(key)) url.searchParams.set(key, '[REDACTED]');
    }
    return url.toString();
  } catch { return raw; }
}
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
async function writeRunSummary(outputDir: string, runId: string, spec: AcceptanceSpec, results: AcceptanceResult[]) { await mkdir(path.join(outputDir, runId), { recursive: true }); await writeFile(path.join(outputDir, runId, 'run-summary.json'), JSON.stringify({ runId, taskId: spec.taskId, specId: spec.specId, selection: { total: results.length, run: results.filter((result) => result.status !== 'reused').length, reused: results.filter((result) => result.status === 'reused').length, items: results.map((result) => ({ scenarioId: result.scenarioId, action: result.status === 'reused' ? 'reuse' : 'run', reusedFrom: result.reusedFrom })) }, results }, null, 2)); }
