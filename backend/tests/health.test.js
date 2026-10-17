import request from 'supertest';
import { createTestApp } from './helpers/testApp.js';

describe('health endpoints', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  test('GET /api/v1/health reports liveness and a request id', async () => {
    const res = await request(ctx.app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { status: 'ok' } });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('GET /api/v1/health/ready is 200 when the database and Redis are reachable', async () => {
    const res = await request(ctx.app).get('/api/v1/health/ready');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ status: 'ready', checks: { database: 'up', redis: 'up' } });
  });

  test('GET /api/v1/health/ready is 503 when a dependency is down, without leaking details', async () => {
    const brokenRedis = { ping: () => Promise.reject(new Error('ECONNREFUSED 10.0.0.5:6379')) };
    const broken = await createTestApp({ prisma: ctx.prisma, redis: brokenRedis });

    const res = await request(broken.app).get('/api/v1/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.data).toEqual({
      status: 'unavailable',
      checks: { database: 'up', redis: 'down' },
    });
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
  });

  test('keeps a safe caller-supplied request id and replaces an unsafe one', async () => {
    const kept = await request(ctx.app).get('/api/v1/health').set('X-Request-Id', 'lb-123.abc');
    expect(kept.headers['x-request-id']).toBe('lb-123.abc');

    // HTTP clients refuse to send raw newlines, so use other characters outside the allowlist.
    const replaced = await request(ctx.app)
      .get('/api/v1/health')
      .set('X-Request-Id', 'evil" injected=<script>');
    expect(replaced.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('error handling', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  test('unknown routes return the standard 404 error shape', async () => {
    const res = await request(ctx.app).get('/api/v1/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND', message: 'Route not found' });
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  test('malformed JSON is a 400, not a 500', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  test('bodies over 100 kB are rejected with 413', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(110 * 1024) }));

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  test('sets security headers and hides the framework', async () => {
    const res = await request(ctx.app).get('/api/v1/health');

    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  test('CORS allows configured origins only', async () => {
    const allowed = ctx.env.CORS_ORIGINS[0];
    const ok = await request(ctx.app).get('/api/v1/health').set('Origin', allowed);
    expect(ok.headers['access-control-allow-origin']).toBe(allowed);
    expect(ok.headers['access-control-allow-credentials']).toBe('true');

    const denied = await request(ctx.app)
      .get('/api/v1/health')
      .set('Origin', 'https://attacker.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
