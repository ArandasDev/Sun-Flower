import type { DatabaseSync } from 'node:sqlite';
import fastifyCookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CoreHandle } from '../../core/application/core.ts';
import { openDatabase } from '../../core/infrastructure/database.ts';
import { MIGRATIONS_DIR, runMigrations } from '../../core/infrastructure/migrations.ts';
import { PermissionService } from '../../core/permissions/permission-service.ts';
import { SessionStore } from '../../core/sessions/session-store.ts';
import type { MemberInfo } from './ports.ts';
import { SESSION_COOKIE, createSessionAuth, type SessionAuth } from './session.ts';

const USER = '111111111111111111';
const SECRET = Buffer.alloc(32, 9);

let db: DatabaseSync;
let sessions: SessionStore;
let auth: SessionAuth;
let app: FastifyInstance;
let member: MemberInfo | null | undefined;
let lookups: number;

beforeEach(async () => {
  db = openDatabase(':memory:');
  runMigrations(db, MIGRATIONS_DIR);
  sessions = new SessionStore(db);
  member = { roleIds: [], isOwner: false, displayName: 'Pessoa', avatarUrl: null };
  lookups = 0;
  const core = { sessions, permissions: new PermissionService(db) } as unknown as CoreHandle;
  auth = createSessionAuth({
    core,
    directory: {
      lookup: () => {
        lookups += 1;
        return Promise.resolve(member);
      },
    },
    sessionSecret: SECRET,
  });
  app = Fastify();
  await app.register(fastifyCookie);
  const handler = () => ({ ok: true });
  app.get('/x', { preHandler: auth.requireSession }, handler);
  app.post('/x', { preHandler: auth.requireSession }, handler);
  app.delete('/x', { preHandler: auth.requireSession }, handler);
});

afterEach(async () => {
  await app.close();
  db.close();
});

function send(method: 'GET' | 'POST' | 'DELETE', token?: string, csrf?: string) {
  return app.inject({
    method,
    url: '/x',
    ...(token === undefined ? {} : { cookies: { [SESSION_COOKIE]: token } }),
    ...(csrf === undefined ? {} : { headers: { 'x-csrf-token': csrf } }),
  });
}

describe('requireSession', () => {
  it('answers 401 without a session', async () => {
    expect((await send('GET')).statusCode).toBe(401);
    expect((await send('POST')).statusCode).toBe(401);
  });

  it('lets a read through without CSRF', async () => {
    const { token } = sessions.create(USER);
    expect((await send('GET', token)).statusCode).toBe(200);
  });

  it('answers 403 to a changing method without or with a wrong CSRF token', async () => {
    const { token, record } = sessions.create(USER);
    const other = sessions.create(USER);
    expect((await send('POST', token)).statusCode).toBe(403);
    expect((await send('DELETE', token, '')).statusCode).toBe(403);
    expect((await send('POST', token, auth.csrfToken(other.record.idHash))).statusCode).toBe(403);
    expect((await send('POST', token, auth.csrfToken(record.idHash).slice(1))).statusCode).toBe(
      403,
    );
    expect((await send('POST', token, auth.csrfToken(record.idHash))).statusCode).toBe(200);
  });

  it('derives the CSRF token from the session secret', () => {
    const a = auth.csrfToken('abc');
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(auth.csrfToken('abd')).not.toBe(a);
  });

  it('refuses a session whose member left, and deletes it', async () => {
    const { token } = sessions.create(USER);
    member = null;
    expect((await send('GET', token)).statusCode).toBe(401);
    expect(sessions.resolve(token)).toBeNull();
  });

  it('answers 503 without deleting while the lookup cannot answer', async () => {
    const { token } = sessions.create(USER);
    member = undefined;
    const res = await send('GET', token);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      error: {
        code: 'unavailable',
        message: 'Não foi possível confirmar seu acesso agora. Tente de novo em instantes.',
      },
    });
    expect(sessions.resolve(token)).not.toBeNull();
  });

  it('checks the CSRF token before looking the person up', async () => {
    const { token } = sessions.create(USER);
    lookups = 0;
    expect((await send('POST', token)).statusCode).toBe(403);
    expect(lookups).toBe(0);
    expect((await send('GET', token)).statusCode).toBe(200);
    expect(lookups).toBe(1);
  });
});
