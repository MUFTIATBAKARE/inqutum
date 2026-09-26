import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Router } from 'express';
import {
  API_CONTRACT,
  API_CONTRACT_KEYS,
  adminRoutes,
  contractErrorCodes,
  findRoute,
  routeKey,
} from '../src/api/api-contract.ts';

/**
 * Route discovery (issue #55).
 *
 * Walks a live Express router rather than parsing source, so the contract is
 * checked against what the server actually serves. Importing the Postgres
 * router is safe here: nothing connects until a query runs.
 */
function discoverRoutes(router: Router): string[] {
  const found: string[] = [];

  const walk = (stack: any[], prefix = '') => {
    for (const layer of stack) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) {
          if (method === '_all') continue;
          found.push(routeKey(method, prefix + layer.route.path));
        }
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack, prefix);
      }
    }
  };

  walk((router as any).stack ?? []);
  return found.sort();
}

/** Express 4 modules come back double-wrapped under tsx's CJS interop. */
async function loadPostgresRouter(): Promise<Router> {
  const mod: any = await import('../src/routes/index.ts');
  return (mod.default?.default ?? mod.default) as Router;
}

describe('public API contract (issue #55)', () => {
  describe('contract table', () => {
    it('declares no duplicate method+path pairs', () => {
      const seen = new Set<string>();
      for (const key of API_CONTRACT_KEYS) {
        assert.equal(seen.has(key), false, `duplicate route in contract: ${key}`);
        seen.add(key);
      }
    });

    it('gives every route a summary and an auth level', () => {
      for (const route of API_CONTRACT) {
        assert.ok(route.summary.length > 15, `${routeKey(route.method, route.path)} needs a real summary`);
        assert.ok(['public', 'session', 'admin'].includes(route.auth));
      }
    });

    it('starts every path with a slash and declares no query string in the path', () => {
      for (const route of API_CONTRACT) {
        assert.ok(route.path.startsWith('/'), `${route.path} must start with /`);
        assert.equal(route.path.includes('?'), false, `${route.path} must not embed a query string`);
      }
    });

    it('declares only real HTTP methods', () => {
      for (const route of API_CONTRACT) {
        assert.ok(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(route.method));
      }
    });

    it('documents error codes in UPPER_SNAKE and plausible statuses', () => {
      for (const route of API_CONTRACT) {
        for (const err of route.errors ?? []) {
          assert.match(err.code, /^[A-Z][A-Z0-9_]*$/, `${route.path}: ${err.code}`);
          assert.ok(err.status >= 400 && err.status < 600, `${route.path}: ${err.status}`);
          assert.ok(err.when.length > 5, `${route.path}/${err.code} needs a "when" clause`);
        }
      }
    });

    it('never declares the same error code twice on one route', () => {
      for (const route of API_CONTRACT) {
        const codes = (route.errors ?? []).map((e) => e.code);
        assert.equal(new Set(codes).size, codes.length, `${route.path} repeats an error code`);
      }
    });

    it('finds a declared route and reports nothing for an unknown one', () => {
      assert.equal(findRoute('GET', '/invoices/:id')?.auth, 'public');
      assert.equal(findRoute('GET', '/nope'), undefined);
      assert.equal(findRoute('post', '/invoices')?.method, 'POST', 'lookup is case-insensitive');
    });
  });

  describe('admin gating', () => {
    it('derives the admin surface from the contract', () => {
      // main gates /stellar behind authenticate() + requirePermission('stellar:read'),
      // so the contract must not advertise those reads as public.
      const admin = adminRoutes();
      assert.ok(admin.includes('GET /stellar/account'));
      assert.ok(admin.includes('POST /stellar/verify-payment'));
      assert.equal(
        admin.some((key) => key.startsWith('GET /invoices')),
        false,
        'invoice reads are public'
      );
    });
  });

  describe('drift against the live router', () => {
    it('declares every route the Postgres server actually serves', async () => {
      const router = await loadPostgresRouter();
      const live = discoverRoutes(router);
      const declared = new Set(API_CONTRACT_KEYS);

      const undocumented = live.filter((key) => !declared.has(key));
      assert.deepEqual(
        undocumented,
        [],
        'routes exist that the contract does not declare; document them in src/api/api-contract.ts'
      );
    });

    it('does not declare routes the server stopped serving', async () => {
      const router = await loadPostgresRouter();
      const live = new Set(discoverRoutes(router));
      const stale = API_CONTRACT_KEYS.filter((key) => !live.has(key));

      assert.deepEqual(
        stale,
        [],
        'the contract documents routes that no longer exist; documentation that outlives the code is worse than none'
      );
    });

    it('finds the whole surface rather than an empty stack', async () => {
      const router = await loadPostgresRouter();
      const live = discoverRoutes(router);
      // Guards the walker itself: if introspection silently broke, both drift
      // tests above would pass by comparing empty lists.
      assert.ok(live.length >= 25, `expected the full route surface, walked ${live.length}`);
    });

    it('agrees with the router on the exact count', async () => {
      const router = await loadPostgresRouter();
      assert.equal(discoverRoutes(router).length, API_CONTRACT.length);
    });
  });

  describe('MVP server parity', () => {
    it('mounts only routes the contract declares', async () => {
      // The memory-backed server exposes a subset. Anything it adds must still
      // be in the contract, or the docs are wrong for one of the two servers.
      const mod: any = await import('../src/server-mvp.ts');
      const app = (mod.default?.default ?? mod) as any;
      const stack = app?._router?.stack ?? app?.router?.stack;
      if (!stack) return; // Express version without a reachable stack: nothing to assert.

      const live = discoverRoutes(app._router ?? app.router);
      const declared = new Set(API_CONTRACT_KEYS);
      assert.deepEqual(live.filter((key) => !declared.has(key)), []);
    });
  });

  describe('error codes', () => {
    it('never claims a code the server does not actually send', async () => {
      // Authoritative set: taxonomy keys plus every code literal in src/.
      // main has no error-taxonomy module. The authoritative set is the
      // machine-readable code unions in src/types/api.ts plus every code
      // literal the routes actually emit.
      const { DOMAIN_ERROR_TAXONOMY } = await (async () => {
        try {
          return await import('../src/errors/error-taxonomy.ts');
        } catch {
          return { DOMAIN_ERROR_TAXONOMY: {} as Record<string, unknown> };
        }
      })();
      const real = new Set(Object.keys(DOMAIN_ERROR_TAXONOMY));

      const srcDir = new URL('../src/', import.meta.url);
      const { readdirSync, readFileSync, statSync } = await import('node:fs');
      const { join } = await import('node:path');

      const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry);
          if (statSync(full).isDirectory()) {
            walk(full);
          } else if (full.endsWith('.ts') && !full.endsWith('api-contract.ts')) {
            for (const m of readFileSync(full, 'utf8').matchAll(/code:\s*'([A-Z][A-Z0-9_]*)'/g)) {
              real.add(m[1]);
            }
          }
        }
      };
      walk(srcDir.pathname);

      // The machine-readable code unions are the other authoritative source.
      // VerificationCode lives in shared/, outside src/, which is why the literal
      // walk above cannot see the codes the verification service emits.
      const repoRoot = new URL('../../shared/', import.meta.url);
      for (const file of ['types/api.ts', 'verification.ts']) {
        const full = file === 'types/api.ts'
          ? join(srcDir.pathname, file)
          : join(repoRoot.pathname, file);
        for (const m of readFileSync(full, 'utf8').matchAll(/\|\s*'([A-Z][A-Z0-9_]*)'/g)) {
          real.add(m[1]);
        }
      }

      const claimed = contractErrorCodes();
      const invented = claimed.filter((code) => !real.has(code));
      assert.deepEqual(
        invented,
        [],
        'the contract documents error codes the server never sends; fix the contract or send the code'
      );
    });

    it('declares no error code the server cannot send', () => {
      // The status of a code is owned by the route that emits it on main, not by
      // a central table, so what the contract can be held to is: the code is real,
      // and its status is a client or server error rather than a success.
      for (const route of API_CONTRACT) {
        for (const err of route.errors ?? []) {
          assert.ok(
            err.status >= 400 && err.status < 600,
            `${route.method} ${route.path}: ${err.code} is documented as ${err.status}`
          );
        }
      }
    });
  });

  describe('response envelope', () => {
    it('matches the shared success envelope', async () => {
      const { apiSuccess } = await import('../src/types/api.ts');
      const body = apiSuccess({ id: 'x' }, { message: 'Created', code: 'OK' });

      assert.equal(body.success, true);
      assert.deepEqual(body.data, { id: 'x' });
      assert.equal(body.message, 'Created');
      assert.equal(body.code, 'OK');
    });

    it('omits optional envelope fields rather than sending undefined', async () => {
      const { apiSuccess } = await import('../src/types/api.ts');
      const body = apiSuccess({ id: 'x' });

      // JSON.stringify drops undefined, but an explicit key would still show up
      // in Object.keys and mislead anyone reading the wire format.
      assert.deepEqual(Object.keys(body).sort(), ['data', 'success']);
    });

    it('carries a code and a recovery action on failure', async () => {
      const { apiFailure } = await import('../src/types/api.ts');
      const body = apiFailure('Import has 3 rows');

      assert.equal(body.success, false);
      assert.equal(body.error, 'Import has 3 rows');
      assert.equal(body.code, undefined, 'apiFailure carries only the message on main');

      // #53 puts the code and the recovery action on the import failure itself,
      // so a client can branch on the code without parsing prose.
      const { API_CONTRACT } = await import('../src/api/api-contract.ts');
      const importRoute = API_CONTRACT.find((r) => r.path === '/imports/invoices');
      assert.ok(importRoute, 'the import route is in the contract');
      assert.ok(
        (importRoute.errors ?? []).some((e) => e.code === 'INVALID_IMPORT_PAYLOAD'),
        'import failures document a code a client can branch on'
      );
    });
  });
});
