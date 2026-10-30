import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { collectLayoutMetrics, inspectLayout, resolveVisualReview, runAcceptance, validateSpec, VISUAL_REVIEW_RUBRIC } from '../dist/index.js';

const cleanMetrics = {
  viewport: { width: 390, height: 844 },
  document: { scrollWidth: 390, clientWidth: 390, scrollHeight: 844, clientHeight: 844 },
  overlays: [],
};

test('layout rules pass an in-bounds page and fail viewport overflow and obscured modal actions', () => {
  assert.deepEqual(inspectLayout(cleanMetrics), []);
  const findings = inspectLayout({
    ...cleanMetrics,
    document: { ...cleanMetrics.document, scrollWidth: 412 },
    overlays: [{
      selector: '.ant-modal',
      rect: { x: 0, y: 0, width: 390, height: 900, right: 390, bottom: 900 },
      body: { x: 16, y: 80, width: 358, height: 740, right: 374, bottom: 820 },
      footer: { x: 16, y: 800, width: 358, height: 60, right: 374, bottom: 860 },
    }],
  });
  assert.deepEqual(findings.map(({ id }) => id), [
    'page-horizontal-overflow',
    'overlay-outside-viewport-1',
    'overlay-footer-outside-viewport-1',
    'overlay-body-footer-overlap-1',
  ]);
});

test('visual review cannot pass when required evidence or rubric criteria are missing', () => {
  assert.equal(resolveVisualReview('required').decision, 'needs_review');
  const criteria = VISUAL_REVIEW_RUBRIC.map(({ id }) => ({ id, status: 'passed', rationale: 'Checked against evidence.', evidenceRefs: ['viewport.png'] }));
  assert.equal(resolveVisualReview('required', { status: 'passed', confidence: 0.95, findings: [], evidenceRefs: ['viewport.png'], criteria }).decision, 'pass');
  assert.equal(resolveVisualReview('required', { status: 'passed', confidence: 0.95, findings: [], evidenceRefs: ['viewport.png'], criteria: criteria.map((item, i) => i === 5 ? { ...item, status: 'not_applicable', rationale: 'The product has no narrow viewport support.' } : item) }).decision, 'pass');
  assert.equal(resolveVisualReview('required', { status: 'passed', confidence: 0.95, findings: [], evidenceRefs: ['viewport.png'], criteria: criteria.slice(1) }).decision, 'needs_review');
  assert.equal(resolveVisualReview('required', { status: 'passed', confidence: 0.95, findings: [], evidenceRefs: ['viewport.png'], criteria: criteria.map((item, i) => i === 0 ? { ...item, evidenceRefs: [] } : item) }).decision, 'needs_review');
  assert.equal(resolveVisualReview('required', { status: 'passed', confidence: 0.95, findings: [], evidenceRefs: ['viewport.png'], criteria: criteria.map((item, i) => i === 0 ? { ...item, status: 'failed' } : item) }).decision, 'fail');
  assert.equal(resolveVisualReview('optional').status, 'not_run');
});

test('spec schemas accept visual policy and scenario viewport and reject invalid viewport dimensions', async () => {
  const spec = {
    specId: 'viewport-contract',
    specVersion: 1,
    pages: [{ id: 'page', path: '/' }],
    apis: [],
    scenarios: [{ id: 'desktop', page: 'page', viewport: { width: 1440, height: 900 }, steps: [] }],
    quality: { visualReview: 'required', layoutOverflow: 'fail' },
  };
  await validateSpec(spec);
  await assert.rejects(validateSpec({ ...spec, scenarios: [{ ...spec.scenarios[0], viewport: { width: 0, height: 900 } }] }));
});

test('browser layout metrics detect a clipped modal footer and required visual review cannot silently pass', async (t) => {
  const browser = await chromium.launch({ headless: true, ...(process.env.EVIDENCE_GATE_CHROME_PATH ? { executablePath: process.env.EVIDENCE_GATE_CHROME_PATH } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent(`
    <style>
      html,body { margin: 0; width: 100%; height: 100%; overflow-x: hidden; }
      .ant-modal-wrap { position: fixed; inset: 0; }
      .ant-modal { position: absolute; inset: 20px 10px auto; height: 900px; background: white; }
      .ant-modal-body { position: absolute; top: 60px; bottom: 40px; overflow: auto; }
      .ant-modal-footer { position: absolute; bottom: 0; height: 50px; }
    </style>
    <div class="ant-modal-wrap"><section class="ant-modal"><main class="ant-modal-body">Dialog content</main><footer class="ant-modal-footer"><button>Save</button></footer></section></div>
  `);
  const metrics = await collectLayoutMetrics(page);
  assert.ok(inspectLayout(metrics).some(({ id }) => id.startsWith('overlay-footer-outside-viewport')));

  const parent = process.env.EVIDENCE_GATE_TEST_OUTPUT ?? '/Volumes/1T/codex-tmp/frontend-api-evidence-gate/tests';
  await mkdir(parent, { recursive: true });
  const outputDir = await mkdtemp(path.join(parent, 'visual-review-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const spec = {
    specId: 'required-visual-review',
    specVersion: 1,
    pages: [{ id: 'blank', path: '/' }],
    apis: [],
    scenarios: [{ id: 'blank-desktop', page: 'blank', viewport: { width: 1024, height: 768 }, steps: [] }],
    quality: { screenshot: 'required', layoutOverflow: 'fail', visualReview: 'required', trace: false },
  };
  const [result] = await runAcceptance({
    spec,
    normalizedSpec: JSON.stringify(spec),
    outputDir,
    browserTarget: { mode: 'launch', browser: 'chromium', headless: true },
  });
  assert.equal(result.decision, 'needs_review');
  assert.equal(result.status, 'blocked');
  assert.equal(result.quality.visualReview.status, 'not_run');
  assert.equal(result.checks.find(({ type }) => type === 'layout-overflow')?.status, 'passed');
  assert.equal((await stat(result.evidence.viewportScreenshot)).isFile(), true);
  assert.equal((await stat(result.evidence.layout)).isFile(), true);
  const metricsFromArtifact = JSON.parse(await readFile(result.evidence.layout, 'utf8'));
  assert.deepEqual(metricsFromArtifact.viewport, { width: 1024, height: 768 });
});
