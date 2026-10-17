export type AcceptanceStatus = 'passed' | 'failed' | 'blocked' | 'reused' | 'skipped';
export type AcceptanceDecision = 'pass' | 'fail' | 'needs_review';

export interface AcceptanceSpec {
  specId: string;
  specVersion: number;
  taskId?: string;
  taskVersion?: number;
  browser?: BrowserTarget;
  project?: { baseUrl?: string; [key: string]: unknown };
  pages?: Array<{ id: string; route?: string; path?: string; [key: string]: unknown }>;
  apis?: Array<{ id: string; method: string; path: string; [key: string]: unknown }>;
  scenarios: ScenarioSpec[];
  quality?: Record<string, unknown>;
  data?: Record<string, unknown>;
  components?: ComponentSpec[];
  [key: string]: unknown;
}

export interface BrowserTarget {
  mode?: 'launch' | 'existing';
  browser?: 'chromium' | 'firefox' | 'webkit';
  headless?: boolean;
  connection?: { type: 'cdp'; endpoint: string };
  target?: { url?: string; tabTitle?: string; index?: number };
}

export interface ComponentSpec {
  id: string;
  path: string;
  impact: 'local' | 'interaction' | 'data-display' | 'visual' | 'interaction-and-visual' | 'visual-global' | 'runtime-global';
  exports?: string[];
  [key: string]: unknown;
}

export interface ScenarioSpec {
  id: string;
  page?: string;
  priority?: string;
  steps: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface RequestEvidence {
  requestId: string;
  apiId?: string;
  startedAt: string;
  durationMs?: number;
  method: string;
  url: string;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface ResponseEvidence {
  apiId?: string;
  requestId: string;
  url?: string;
  status: number;
  durationMs: number;
  headers?: Record<string, string>;
  contentType?: string;
  body?: unknown;
  rawBody?: string;
}

export interface CheckResult {
  id: string;
  type: string;
  status: 'passed' | 'failed' | 'blocked' | 'skipped';
  expected?: unknown;
  actual?: unknown;
  message?: string;
  evidenceRefs?: string[];
}

export interface StepResult {
  stepId: string;
  action: string;
  status: 'passed' | 'failed' | 'blocked';
  expected?: unknown;
  actual?: unknown;
  message?: string;
  evidenceRefs: string[];
}

export interface AcceptanceResult {
  runId: string;
  taskId?: string;
  specId: string;
  specVersion: number;
  scenarioId: string;
  status: AcceptanceStatus;
  decision: AcceptanceDecision;
  fingerprint: { scenarioHash: string; specHash: string; contentHash?: string; semanticHash?: string; dependencyHashes?: Record<string, string> };
  reusedFrom: string | null;
  evidence: { screenshot: string; screenshots?: string[]; trace?: string; checks: string; requests: string; responses: string; console?: string; axe?: string };
  requests: RequestEvidence[];
  responses: ResponseEvidence[];
  checks: CheckResult[];
  steps?: StepResult[];
  findings: Array<{ id: string; severity: string; message: string; confidence?: number; evidenceRefs: string[] }>;
  aiReview?: { status: string; confidence: number; findings: AcceptanceResult['findings']; evidenceRefs: string[] };
}
