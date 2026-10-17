---
name: frontend-api-evidence-gate
description: Drive the frontend API evidence gate during AI development. Generate structured acceptance tasks, run real browser checks, inspect screenshots and request/response evidence, then fix and re-run failed scenarios.
read_when:
  - Modifying a frontend page, component, form, button, or interaction
  - Changing frontend API requests or response handling
  - Verifying a page in an already logged-in Chrome or Edge tab
  - The user asks for screenshots, API evidence, or an acceptance conclusion
metadata: {"requires":{"bins":["acceptance-runner"]}}
allowed-tools: Bash(acceptance-runner:*)
---

# Frontend API evidence gate

Use this skill when a change needs browser and API evidence. The runner is an external verifier; do not embed an AI model into the application under test.

## Workflow

1. Inspect the project and locate an existing `acceptance-task.yaml` or `acceptance-spec.yaml`.
2. Reuse it when it covers the requested change. Otherwise create a task in the project temporary/artifacts area with explicit pages, APIs, steps, and quality checks. Keep the task scoped to the changed page/component/API; do not add unrelated full-site checks unless a shared component or runtime changed.
3. Before running, perform a lightweight preflight: verify the frontend URL, the configured API base or health endpoint, and (when the scenario needs it) the authenticated tab/session. If a dependency is unavailable, record `blocked` with the concrete dependency and stop before interpreting page assertions.
4. Run the task:

```bash
acceptance-runner run acceptance-task.yaml --output artifacts/acceptance --reuse
```

5. For an already open and logged-in Chromium or Edge tab, use the CDP endpoint and tab selector supplied by the user:

```bash
acceptance-runner run acceptance-task.yaml \
  --target existing \
  --browser edge \
  --cdp-endpoint http://127.0.0.1:9222 \
  --tab-url https://example.test/orders \
  --output artifacts/acceptance
```

6. Read the returned decision and inspect `acceptance-result.json`, `checks.json`, `requests.json`, `responses.json`, `console.json`, screenshots, and `axe.json` when present.
7. If the decision is `fail` or `needs_review`, classify the cause before changing code:
   - `blocked`: environment, browser, authentication, or dependency unavailable;
   - `fail`: deterministic assertion, layout, accessibility, request, or response mismatch;
   - `needs_review`: evidence exists but requires human/semantic judgment.
   A Playwright locator error caused by multiple matches is an acceptance-task defect first. Fix the locator or task and rerun before changing product code.
8. If the decision is `fail` or `needs_review` for a product reason, use the evidence to make the smallest code fix, then run the affected task again. Do not report a pass when the runner returned a blocked or failed result.
9. Report the decision and link the evidence files. Keep secrets and session cookies out of the task file and output.

## Task authoring rules

- Prefer stable selectors in this order: `testId`, unique `label`/`placeholder`, a scoped CSS selector, then an accessible role. A role/name selector is valid only when the expected match is unique.
- When the same accessible name is intentionally used by a tab and its submit button, scope the action (`css: "#form-up button[type=submit]"`) or add a stable test id. Do not rely on `.first()` to hide an ambiguous contract.
- For every mutating click, add a resulting assertion: visible success/error feedback, dialog state, or an API request/response assertion. A click alone is not evidence of completion.
- Prefer `waitFor` before asserting content that is loaded asynchronously. Use a task timeout appropriate to the real API instead of assuming the default 5 seconds.
- Declare only affected APIs in `apis`; include method, path template, relevant query/body fields, status, and a response schema when the contract matters. Avoid exact full-body equality when fields such as timestamps or generated IDs are nondeterministic.
- When only a stable subset of a request or response body matters, set `bodyMatch: subset`; keep `exact` as the default for contracts that must match the complete body.
- Use `quality.layoutOverflow: fail` for modal, tooltip, card, table, and responsive-layout changes; use `accessibility: axe` for shared components when the project can tolerate the extra runtime.
- Use `--reuse` only when the scenario fingerprint includes the changed files/configuration and the same browser/auth/environment. After a product change, delete or invalidate stale `latest` results rather than treating reuse as a fresh pass.
- Never place passwords, cookies, bearer tokens, database URLs, or real personal data in YAML, screenshots, request bodies, or committed artifacts. Use the runner's redaction and local bootstrap fixtures.

## TypeScript integration

When the project wants to invoke the verifier directly, use the high-level API:

```ts
import { accept } from '@zouxuyang/frontend-api-evidence-gate';

const run = await accept({
  task,
  outputDir: './artifacts/acceptance',
  browser: 'chromium',
  headed: false,
});

if (run.decision !== 'pass') throw new Error(`验收未通过：${run.decision}`);
```

The runner returns structured results with screenshots, request/response evidence, checks, traces, and optional axe output. Use `acceptFile()` when the task is already stored as YAML or JSON.
