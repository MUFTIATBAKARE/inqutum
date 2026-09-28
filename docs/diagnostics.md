# Contributor Local Health Diagnostics

Inqutum provides a single unified diagnostics command for contributors to verify their local setup, dependencies, environment configuration, database readiness, and network mocks before starting development.

## Running Diagnostics

Run the diagnostics check from either the project root or the `backend` directory:

```bash
# From backend directory
npm run diagnostics

# Or directly using tsx from project root
npx tsx scripts/diagnostics.ts
```

## What it Checks

1. **Node.js Runtime**: Verifies that your installed Node.js engine satisfies `>= 18.0.0`.
2. **Project Fixtures & Paths**: Ensures required core modules, tests, and frontend paths exist.
3. **Environment Configuration**: Validates active environment variables against the typed schema, flags unsafe combinations (e.g. simulation enabled in production), and checks required origins.
4. **Storage Layer State**: Detects whether persistent PostgreSQL or zero-dependency in-memory MVP mode is active.
5. **Stellar Horizon Gateway**: Confirms correct network endpoints (Testnet vs Public) and HTTPS protocol usage.

## Safety Guarantee

The diagnostics command is strictly **read-only** and performs non-destructive health probes. It never writes, alters, or resets production or staging records.
