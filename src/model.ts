import type { VisualReviewPolicy, VisualReviewStatus } from './types.js';

export const VISUAL_REVIEW_RUBRIC = [
  { id: 'content-fit', rule: 'Visible text, labels, controls, validation and results are not clipped, obscured, overlapping, or outside their intended container.' },
  { id: 'dialog-actions', rule: 'Dialog or drawer title/context is clear; content can scroll independently when needed; close/cancel and primary actions remain visible and reachable.' },
  { id: 'task-grouping', rule: 'Related fields/results are grouped, labels stay adjacent to controls, and actions follow the content they affect.' },
  { id: 'control-readability', rule: 'Labels and values can be read; controls and loading/error/success states are identifiable; long text does not break layout.' },
  { id: 'alignment-spacing', rule: 'Repeated controls align consistently; spacing and separators make grouping and action ownership clear and follow established project patterns.' },
  { id: 'responsive-behavior', rule: 'At the supplied supported viewport, controls remain usable, actions stay reachable, and there is no unintended horizontal scrolling or overlap.' },
] as const;

export type VisualCriterionId = (typeof VISUAL_REVIEW_RUBRIC)[number]['id'];
export interface VisualCriterionResult {
  id: VisualCriterionId;
  status: 'passed' | 'failed' | 'not_observable' | 'not_applicable';
  rationale: string;
  evidenceRefs: string[];
}

export interface ModelReviewInput {
  spec: unknown;
  scenario: unknown;
  checks: unknown[];
  requests: unknown[];
  responses: unknown[];
  screenshotPath: string;
  screenshots: Array<{ kind: 'viewport' | 'full-page' | 'step-viewport' | 'step-full-page'; path: string; stepId?: string; viewport: { width: number; height: number } }>;
  layoutMetrics?: unknown;
  rubric: typeof VISUAL_REVIEW_RUBRIC;
}
export interface ModelReview {
  status: 'passed' | 'failed' | 'needs_review' | 'blocked';
  confidence: number;
  findings: Array<{ id: string; severity: string; message: string; confidence?: number; evidenceRefs: string[] }>;
  evidenceRefs: string[];
  criteria?: VisualCriterionResult[];
}

export interface ModelAdapter { review(input: ModelReviewInput): Promise<ModelReview>; }

export class NoopModelAdapter implements ModelAdapter {
  async review(input: ModelReviewInput): Promise<ModelReview> {
    return {
      status: 'blocked',
      confidence: 0,
      findings: [{ id: 'visual-review-not-performed', severity: 'info', message: 'No visual model review was performed.', evidenceRefs: [input.screenshotPath] }],
      evidenceRefs: [],
    };
  }
}

export function resolveVisualReview(policy: VisualReviewPolicy, review?: ModelReview) {
  if (policy === 'off') return { status: 'not_run' as VisualReviewStatus, decision: 'pass' as const };
  if (!review) return { status: 'not_run' as VisualReviewStatus, decision: policy === 'required' ? 'needs_review' as const : 'pass' as const };
  if (review.status === 'failed' || review.criteria?.some((item) => item.status === 'failed')) {
    return { status: 'failed' as VisualReviewStatus, decision: 'fail' as const };
  }
  if (review.status !== 'passed') return { status: review.status === 'blocked' ? 'blocked' as const : 'needs_review' as const, decision: 'needs_review' as const };
  const items = review.criteria ?? [];
  const criteria = new Map(items.map((item) => [item.id, item]));
  const complete = items.length === VISUAL_REVIEW_RUBRIC.length
    && criteria.size === VISUAL_REVIEW_RUBRIC.length
    && VISUAL_REVIEW_RUBRIC.every((criterion) => {
      const item = criteria.get(criterion.id);
      return Boolean(item && ['passed', 'not_applicable'].includes(item.status) && item.rationale.trim() && item.evidenceRefs.length > 0);
    })
    && review.evidenceRefs.length > 0;
  if (!complete) return { status: 'needs_review' as VisualReviewStatus, decision: 'needs_review' as const };
  return { status: 'passed' as VisualReviewStatus, decision: 'pass' as const };
}
