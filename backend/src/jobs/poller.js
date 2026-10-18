/**
 * Runs `run()` every `intervalMs` in this process, one pass at a time: the next pass is
 * scheduled when the previous one ends, so a slow pass never overlaps the next. Errors are
 * logged and the next pass runs as usual. The first pass runs right away.
 *
 * Used for work whose state is in PostgreSQL (notification outbox, trial expiry), so it does
 * not depend on anything stored in Redis. Work that several processes may run at once must
 * be safe to repeat or must lock its rows.
 */
export function createPoller({ name, intervalMs, run, logger }) {
  let timer = null;
  let running = null;
  let stopped = false;

  function schedule(delay) {
    if (stopped) return;
    timer = setTimeout(async () => {
      running = Promise.resolve()
        .then(run)
        .catch((err) => logger.error({ err, job: name }, 'Background job failed; retrying later'));
      await running;
      running = null;
      schedule(intervalMs);
    }, delay);
  }

  return {
    start() {
      schedule(0);
    },
    /** Stops polling and waits for the pass in progress to finish. */
    async close() {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
