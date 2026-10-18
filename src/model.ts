export interface ModelReviewInput {
  spec: unknown;
  scenario: unknown;
  checks: unknown[];
  requests: unknown[];
  responses: unknown[];
  screenshotPath: string;
}
export interface ModelReview { status: 'passed' | 'failed' | 'needs_review' | 'blocked'; confidence: number; findings: Array<{ id: string; severity: string; message: string; confidence?: number; evidenceRefs: string[] }>; evidenceRefs: string[]; }

export interface ModelAdapter { review(input: ModelReviewInput): Promise<ModelReview>; }

export class NoopModelAdapter implements ModelAdapter {
  async review(input: ModelReviewInput): Promise<ModelReview> {
    return { status: 'passed', confidence: 1, findings: [], evidenceRefs: [input.screenshotPath] };
  }
}
