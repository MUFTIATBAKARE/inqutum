import fs from 'fs';
import path from 'path';
import { validateEnvironment } from '../backend/src/config/env-validator';

export interface DiagnosticCheckResult {
  name: string;
  category: 'runtime' | 'config' | 'storage' | 'network' | 'fixtures';
  status: 'PASS' | 'WARN' | 'FAIL';
  message: string;
  remediation?: string;
}

export interface DiagnosticsSummary {
  timestamp: string;
  totalChecks: number;
  passed: number;
  warnings: number;
  failures: number;
  results: DiagnosticCheckResult[];
}

export async function runDiagnostics(env: Record<string, string | undefined> = process.env): Promise<DiagnosticsSummary> {
  const results: DiagnosticCheckResult[] = [];

  // 1. Node.js runtime version check
  const nodeVersion = process.versions.node;
  const majorVersion = parseInt(nodeVersion.split('.')[0] || '0', 10);
  if (majorVersion >= 18) {
    results.push({
      name: 'Node.js Version',
      category: 'runtime',
      status: 'PASS',
      message: `Node.js v${nodeVersion} meets the requirement (>= 18.0.0).`,
    });
  } else {
    results.push({
      name: 'Node.js Version',
      category: 'runtime',
      status: 'FAIL',
      message: `Node.js v${nodeVersion} is below required minimum (>= 18.0.0).`,
      remediation: 'Upgrade Node.js to v18.x or v20.x LTS using nvm or your package manager.',
    });
  }

  // 2. Project structure and fixture presence
  const rootDir = path.resolve(__dirname, '..');
  const criticalPaths = [
    { rel: 'backend/src/server-mvp.ts', desc: 'Backend MVP server' },
    { rel: 'backend/src/storage/memory-invoice-storage.ts', desc: 'In-memory storage layer' },
    { rel: 'backend/tests', desc: 'Backend test suite' },
    { rel: 'frontend/app', desc: 'Frontend Next.js application' },
  ];

  let structureOk = true;
  for (const item of criticalPaths) {
    const fullPath = path.join(rootDir, item.rel);
    if (!fs.existsSync(fullPath)) {
      structureOk = false;
      results.push({
        name: `Path: ${item.rel}`,
        category: 'fixtures',
        status: 'FAIL',
        message: `Missing expected project path: ${item.rel} (${item.desc})`,
        remediation: `Ensure you have pulled all files from git repository: git checkout main && git pull`,
      });
    }
  }

  if (structureOk) {
    results.push({
      name: 'Project Directory Structure',
      category: 'fixtures',
      status: 'PASS',
      message: 'All expected core project paths and fixtures are present.',
    });
  }

  // 3. Environment configuration validation (Issue #90 integration)
  const envCheck = validateEnvironment(env);
  if (envCheck.issues.length === 0) {
    results.push({
      name: 'Environment Validation',
      category: 'config',
      status: 'PASS',
      message: 'All environment variables and formats are valid.',
    });
  } else {
    results.push({
      name: 'Environment Validation',
      category: 'config',
      status: env.NODE_ENV === 'production' ? 'FAIL' : 'WARN',
      message: `Environment validation detected issues:\n    • ${envCheck.issues.join('\n    • ')}`,
      remediation: 'Review backend/env.example.txt or backend/env.mvp.example and configure missing or malformed keys.',
    });
  }

  // 4. Storage mode & DB configuration (Read-only check)
  if (env.DATABASE_URL) {
    results.push({
      name: 'Database Configuration',
      category: 'storage',
      status: 'PASS',
      message: 'DATABASE_URL is defined. PostgreSQL persistence mode is available.',
    });
  } else {
    results.push({
      name: 'Database Configuration',
      category: 'storage',
      status: 'WARN',
      message: 'DATABASE_URL is not set. Running in zero-database MVP mode (in-memory storage).',
      remediation: 'Set DATABASE_URL in backend/.env if you wish to run with persistent PostgreSQL.',
    });
  }

  // 5. Stellar network & Horizon check
  const stellarNetwork = (env.STELLAR_NETWORK || 'TESTNET').toUpperCase();
  const horizonUrl =
    env.STELLAR_HORIZON_URL ||
    (stellarNetwork === 'TESTNET'
      ? 'https://horizon-testnet.stellar.org'
      : 'https://horizon.stellar.org');

  if (horizonUrl.startsWith('https://')) {
    results.push({
      name: 'Stellar Horizon Gateway',
      category: 'network',
      status: 'PASS',
      message: `Configured for ${stellarNetwork} via HTTPS: ${horizonUrl}`,
    });
  } else {
    results.push({
      name: 'Stellar Horizon Gateway',
      category: 'network',
      status: 'WARN',
      message: `Horizon URL (${horizonUrl}) does not use HTTPS.`,
      remediation: 'Stellar network communication should use an HTTPS horizon endpoint.',
    });
  }

  const passed = results.filter((r) => r.status === 'PASS').length;
  const warnings = results.filter((r) => r.status === 'WARN').length;
  const failures = results.filter((r) => r.status === 'FAIL').length;

  return {
    timestamp: new Date().toISOString(),
    totalChecks: results.length,
    passed,
    warnings,
    failures,
    results,
  };
}

export function formatDiagnosticsOutput(summary: DiagnosticsSummary): string {
  const lines: string[] = [];
  lines.push('====================================================');
  lines.push('🔍 Inqutum Contributor Local Health Diagnostics');
  lines.push(`⏰ Timestamp: ${summary.timestamp}`);
  lines.push('====================================================\n');

  for (const r of summary.results) {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'WARN' ? '⚠️ ' : '❌';
    lines.push(`${icon} [${r.category.toUpperCase()}] ${r.name}: ${r.status}`);
    lines.push(`   ${r.message}`);
    if (r.remediation) {
      lines.push(`   👉 Remediation: ${r.remediation}`);
    }
    lines.push('');
  }

  lines.push('----------------------------------------------------');
  lines.push(`Summary: ${summary.totalChecks} checks run | ${summary.passed} PASS | ${summary.warnings} WARN | ${summary.failures} FAIL`);
  if (summary.failures === 0) {
    lines.push('🎉 Contributor environment is healthy and ready for development!');
  } else {
    lines.push('❌ Found critical issues. Please resolve the remediation steps above.');
  }
  lines.push('====================================================');

  return lines.join('\n');
}

// CLI entrypoint
if (require.main === module || process.argv[1]?.endsWith('diagnostics.ts')) {
  runDiagnostics().then((summary) => {
    console.log(formatDiagnosticsOutput(summary));
    process.exit(summary.failures > 0 ? 1 : 0);
  });
}
