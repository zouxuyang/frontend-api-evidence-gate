#!/usr/bin/env node
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { normalizeSpec, stableStringify, validateSpec } from './spec.js';
import { runAcceptance, type RunOptions } from './runner.js';
import type { AcceptanceSpec } from './types.js';

export interface AcceptanceServerOptions {
  host?: string;
  port?: number;
  outputDir?: string;
}

const jobs = new Map<string, { controller: AbortController; status: 'running' | 'completed' | 'failed' | 'cancelled'; result?: unknown; error?: string }>();
let activeRuns = 0;

export function createAcceptanceServer(options: AcceptanceServerOptions = {}): Server {
  return createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/health') return sendJson(response, 200, { ok: true });
      const expectedToken = process.env.ACCEPTANCE_API_TOKEN;
      if (expectedToken && request.headers.authorization !== `Bearer ${expectedToken}`) return sendJson(response, 401, { error: 'Unauthorized' });
      if (request.method === 'GET' && request.url === '/mcp') return sendJson(response, 200, { name: 'frontend-api-evidence-gate', protocolVersion: '2025-03-26' });
      if (request.method === 'GET' && request.url?.startsWith('/jobs/')) { const job = jobs.get(request.url.slice('/jobs/'.length)); return job ? sendJson(response, 200, { status: job.status, result: job.result, error: job.error }) : sendJson(response, 404, { error: 'Job not found' }); }
      if (request.method === 'POST' && request.url?.startsWith('/jobs/') && request.url.endsWith('/cancel')) { const job = jobs.get(request.url.slice('/jobs/'.length, -'/cancel'.length)); if (!job) return sendJson(response, 404, { error: 'Job not found' }); job.controller.abort(new Error('任务已取消')); job.status = 'cancelled'; return sendJson(response, 202, { status: job.status }); }
      if (request.method !== 'POST' || !['/run', '/mcp'].includes(request.url ?? '')) return sendJson(response, 404, { error: 'Not Found' });
      const payload = await readJson(request);
      if (request.url === '/mcp') return await handleMcp(payload, response, options);
      return await handleRun(payload, response, options);
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

async function handleRun(payload: Record<string, unknown>, response: ServerResponse, options: AcceptanceServerOptions) {
  if (payload.async === true) {
    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const controller = new AbortController();
    const job: { controller: AbortController; status: 'running' | 'completed' | 'failed' | 'cancelled'; result?: unknown; error?: string } = { controller, status: 'running' };
    jobs.set(jobId, job);
    void runPayload(payload, options, controller.signal).then((result) => { job.status = 'completed'; job.result = result; }).catch((error) => { job.status = controller.signal.aborted ? 'cancelled' : 'failed'; job.error = error instanceof Error ? error.message : String(error); });
    return sendJson(response, 202, { jobId, status: 'running' });
  }
  return sendJson(response, 200, await runPayload(payload, options));
}

async function runPayload(payload: Record<string, unknown>, options: AcceptanceServerOptions, signal?: AbortSignal) {
  const maxConcurrent = Number(process.env.ACCEPTANCE_MAX_CONCURRENCY ?? 2);
  if (activeRuns >= maxConcurrent) throw new Error('验收服务当前已达到并发上限');
  activeRuns += 1;
  try {
  const task = (payload.task ?? payload) as AcceptanceSpec;
  const spec = normalizeSpec(task);
  await validateSpec(spec);
  const runOptions = (payload.options ?? {}) as Partial<RunOptions>;
  const results = await runAcceptance({
    spec,
    normalizedSpec: stableStringify(spec),
    outputDir: path.resolve(String(payload.outputDir ?? options.outputDir ?? process.env.ACCEPTANCE_OUTPUT_DIR ?? './artifacts')),
    reuse: Boolean(runOptions.reuse ?? payload.reuse),
    timeoutMs: numberValue(runOptions.timeoutMs ?? payload.timeoutMs),
    maxResponseBodyBytes: numberValue(runOptions.maxResponseBodyBytes ?? payload.maxResponseBodyBytes),
    signal,
    screenshotMode: runOptions.screenshotMode ?? (payload.screenshotMode as RunOptions['screenshotMode']),
    browserTarget: runOptions.browserTarget ?? spec.browser
  });
  return { taskId: spec.taskId, specId: spec.specId, results };
  } finally { activeRuns -= 1; }
}

async function handleMcp(payload: Record<string, unknown>, response: ServerResponse, options: AcceptanceServerOptions) {
  const id = payload.id ?? null;
  if (payload.method === 'tools/list') return sendJson(response, 200, { jsonrpc: '2.0', id, result: { tools: [{ name: 'run_acceptance', description: '执行外部 AI 提供的浏览器验收任务并返回证据', inputSchema: { type: 'object', required: ['task'], properties: { task: { type: 'object' }, outputDir: { type: 'string' }, timeoutMs: { type: 'number' }, maxResponseBodyBytes: { type: 'number' } } } }] } });
  if (payload.method !== 'tools/call') return sendJson(response, 200, { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
  const params = (payload.params ?? {}) as Record<string, unknown>;
  if (params.name !== 'run_acceptance') return sendJson(response, 200, { jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool' } });
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  try {
    const task = args.task as AcceptanceSpec;
    const spec = normalizeSpec(task);
    await validateSpec(spec);
    const results = await runAcceptance({ spec, normalizedSpec: stableStringify(spec), outputDir: path.resolve(String(args.outputDir ?? options.outputDir ?? process.env.ACCEPTANCE_OUTPUT_DIR ?? './artifacts')), timeoutMs: numberValue(args.timeoutMs), maxResponseBodyBytes: numberValue(args.maxResponseBodyBytes), browserTarget: spec.browser });
    return sendJson(response, 200, { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify({ taskId: spec.taskId, specId: spec.specId, results }) }] } });
  } catch (error) {
    return sendJson(response, 200, { jsonrpc: '2.0', id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } });
  }
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of request) { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += buffer.length; if (size > 5 * 1024 * 1024) throw new Error('请求体超过 5MB 限制'); chunks.push(buffer); }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求体必须是 JSON 对象');
  return value as Record<string, unknown>;
}

function numberValue(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined; }
function sendJson(response: ServerResponse, status: number, value: unknown) { response.statusCode = status; response.setHeader('content-type', 'application/json; charset=utf-8'); response.end(JSON.stringify(value)); }

export function startAcceptanceServer(options: AcceptanceServerOptions = {}) {
  const server = createAcceptanceServer(options);
  const host = options.host ?? '127.0.0.1'; const port = options.port ?? 3777;
  server.listen(port, host, () => console.log(`acceptance server listening on http://${host}:${port}`));
  return server;
}

if (process.argv[1] && path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url))) {
  const portIndex = process.argv.indexOf('--port');
  const port = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 3777;
  startAcceptanceServer({ port: Number.isFinite(port) ? port : 3777 });
}
