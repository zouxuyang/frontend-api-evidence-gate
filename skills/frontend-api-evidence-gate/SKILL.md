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
2. Reuse it when it covers the requested change. Otherwise create a task in the project temporary/artifacts area with explicit pages, APIs, steps, and quality checks.
3. Run the task:

```bash
acceptance-runner run acceptance-task.yaml --output artifacts/acceptance --reuse
```

4. For an already open and logged-in Chromium or Edge tab, use the CDP endpoint and tab selector supplied by the user:

```bash
acceptance-runner run acceptance-task.yaml \
  --target existing \
  --browser edge \
  --cdp-endpoint http://127.0.0.1:9222 \
  --tab-url https://example.test/orders \
  --output artifacts/acceptance
```

5. Read the returned decision and inspect `acceptance-result.json`, `checks.json`, `requests.json`, `responses.json`, `console.json`, screenshots, and `axe.json` when present.
6. If the decision is `fail` or `needs_review`, use the evidence to make the smallest code fix, then run the affected task again. Do not report a pass when the runner returned a blocked or failed result.
7. Report the decision and link the evidence files. Keep secrets and session cookies out of the task file and output.

## TypeScript integration

When the project wants to invoke the verifier directly, use the high-level API:

```ts
import { accept } from '@frontend-api-evidence-gate/runner';

const run = await accept({
  task,
  outputDir: './artifacts/acceptance',
  browser: 'chromium',
  headed: false,
});

if (run.decision !== 'pass') throw new Error(`验收未通过：${run.decision}`);
```

The runner returns structured results with screenshots, request/response evidence, checks, traces, and optional axe output. Use `acceptFile()` when the task is already stored as YAML or JSON.
