import { Router } from 'express';

const CHECK_TIMEOUT_MS = 2000;

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function runCheck(name, fn, log) {
  try {
    await withTimeout(fn(), CHECK_TIMEOUT_MS);
    return [name, 'up'];
  } catch (err) {
    log.warn({ err, dependency: name }, 'Readiness check failed');
    return [name, 'down'];
  }
}

export function healthRouter({ prisma, redis }) {
  const router = Router();

  // Liveness: the process is running and can serve HTTP. No dependency checks, so a
  // database outage does not make an orchestrator restart healthy API containers.
  router.get('/', (_req, res) => {
    res.json({ data: { status: 'ok' } });
  });

  // Readiness: the API can do useful work. Dependency details are reported as up/down only.
  router.get('/ready', async (req, res) => {
    const checks = Object.fromEntries(
      await Promise.all([
        runCheck('database', () => prisma.$queryRaw`SELECT 1`, req.log),
        runCheck('redis', () => redis.ping(), req.log),
      ]),
    );
    const ready = Object.values(checks).every((state) => state === 'up');
    res
      .status(ready ? 200 : 503)
      .json({ data: { status: ready ? 'ready' : 'unavailable', checks } });
  });

  return router;
}
