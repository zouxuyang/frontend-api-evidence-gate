import path from 'node:path';
import { loadSpec, normalizeSpec, stableStringify, validateSpec } from './spec.js';
import { runAcceptance, type RunOptions } from './runner.js';
import type { AcceptanceResult, AcceptanceSpec, BrowserTarget } from './types.js';

/** High-level entry point for application code and Agent integrations. */
export interface AcceptOptions {
  task: AcceptanceSpec;
  outputDir?: string;
  baseUrl?: string;
  browser?: BrowserTarget['browser'];
  target?: BrowserTarget['mode'];
  cdpEndpoint?: string;
  tabUrl?: string;
  tabTitle?: string;
  headed?: boolean;
  reuse?: boolean;
  screenshotMode?: RunOptions['screenshotMode'];
  timeoutMs?: number;
  maxResponseBodyBytes?: number;
  signal?: AbortSignal;
}

export interface AcceptanceRun {
  taskId?: string;
  specId: string;
  results: AcceptanceResult[];
  decision: 'pass' | 'fail' | 'needs_review';
}

export async function accept(options: AcceptOptions): Promise<AcceptanceRun> {
  const spec = normalizeSpec({
    ...options.task,
    ...(options.baseUrl ? { project: { ...(options.task.project ?? {}), baseUrl: options.baseUrl } } : {}),
    ...(options.browser || options.target || options.cdpEndpoint || options.tabUrl || options.tabTitle ? {
      browser: {
        ...(options.task.browser ?? {}),
        ...(options.target ? { mode: options.target } : {}),
        ...(options.browser ? { browser: options.browser } : {}),
        ...(typeof options.headed === 'boolean' ? { headless: !options.headed } : {}),
        ...(options.cdpEndpoint ? { connection: { type: 'cdp' as const, endpoint: options.cdpEndpoint } } : {}),
        ...(options.tabUrl || options.tabTitle ? { target: { url: options.tabUrl, tabTitle: options.tabTitle } } : {}),
      },
    } : {}),
  });
  await validateSpec(spec);
  const results = await runAcceptance({
    spec,
    normalizedSpec: stableStringify(spec),
    outputDir: path.resolve(options.outputDir ?? 'artifacts'),
    reuse: options.reuse,
    screenshotMode: options.screenshotMode,
    timeoutMs: options.timeoutMs,
    maxResponseBodyBytes: options.maxResponseBodyBytes,
    signal: options.signal,
    browserTarget: spec.browser,
  });
  const decision = results.some((result) => result.decision === 'fail') ? 'fail' : results.some((result) => result.decision === 'needs_review') ? 'needs_review' : 'pass';
  return { taskId: spec.taskId, specId: spec.specId, results, decision };
}

export async function acceptFile(file: string, options: Omit<AcceptOptions, 'task'> = {}): Promise<AcceptanceRun> {
  const { spec } = await loadSpec(file);
  return accept({ ...options, task: spec });
}
