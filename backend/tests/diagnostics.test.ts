import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runDiagnostics, formatDiagnosticsOutput } from '../../scripts/diagnostics';

describe('Contributor Diagnostics Suite (Issue #91)', () => {
  it('runs diagnostics without throwing and checks core environment categories', async () => {
    const summary = await runDiagnostics({
      NODE_ENV: 'development',
      PORT: '3001',
      STELLAR_NETWORK: 'TESTNET',
      FRONTEND_URL: 'http://localhost:3000',
    });

    assert.ok(summary.totalChecks >= 4);
    assert.ok(summary.passed >= 3);
    assert.strictEqual(summary.failures, 0);

    const categories = summary.results.map((r) => r.category);
    assert.ok(categories.includes('runtime'));
    assert.ok(categories.includes('fixtures'));
    assert.ok(categories.includes('config'));
    assert.ok(categories.includes('network'));
  });

  it('reports actionable remediation text when misconfigurations are detected', async () => {
    const summary = await runDiagnostics({
      NODE_ENV: 'production',
      ALLOW_SIMULATE: 'true', // Forbidden in production
    });

    const configResult = summary.results.find((r) => r.name === 'Environment Validation');
    assert.ok(configResult);
    assert.strictEqual(configResult.status, 'FAIL');
    assert.ok(configResult.remediation);
    assert.ok(configResult.remediation.includes('backend/env'));
  });

  it('formats output with clear visual indicators and actionable sections', async () => {
    const summary = await runDiagnostics({});
    const output = formatDiagnosticsOutput(summary);

    assert.ok(output.includes('Inqutum Contributor Local Health Diagnostics'));
    assert.ok(output.includes('Summary:'));
    assert.ok(output.includes('Node.js Version'));
  });
});
