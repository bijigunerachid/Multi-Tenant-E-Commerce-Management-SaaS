import { randomToken, sha256 } from '../../utils/crypto.js';

/**
 * Server-side sessions in Redis.
 *
 * - The browser holds only the random session ID. Redis keys use its SHA-256, so a copy of
 *   Redis does not contain usable session IDs.
 * - Idle timeout: the key's TTL, extended on each request.
 * - Absolute timeout: `createdAt` is checked on load, so a session cannot be kept alive forever.
 * - Each user has a set of their session keys, so all of them can be revoked at once
 *   (password change or reset, "log out everywhere", account disabled).
 */
export function createSessionStore({ redis, idleSeconds, absoluteSeconds }) {
  const sessionKey = (hash) => `sess:${hash}`;
  const userKey = (userId) => `user-sessions:${userId}`;

  async function create({ userId, activeOrganizationId }) {
    const id = randomToken();
    const hash = sha256(id);
    const session = {
      userId,
      activeOrganizationId: activeOrganizationId ?? null,
      csrfToken: randomToken(),
      createdAt: Date.now(),
    };
    await redis
      .multi()
      .set(sessionKey(hash), JSON.stringify(session), 'EX', idleSeconds)
      .sadd(userKey(userId), hash)
      .expire(userKey(userId), absoluteSeconds)
      .exec();
    return { id, session };
  }

  async function load(id) {
    if (typeof id !== 'string' || id.length < 32 || id.length > 128) return null;
    const hash = sha256(id);
    const raw = await redis.get(sessionKey(hash));
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (Date.now() - session.createdAt > absoluteSeconds * 1000) {
      await destroy(id, session.userId);
      return null;
    }
    // Sliding idle expiry, never beyond the absolute lifetime.
    const remainingAbsolute = Math.ceil(
      (session.createdAt + absoluteSeconds * 1000 - Date.now()) / 1000,
    );
    await redis.expire(sessionKey(hash), Math.min(idleSeconds, remainingAbsolute));
    return session;
  }

  async function update(id, patch) {
    const hash = sha256(id);
    const key = sessionKey(hash);
    const raw = await redis.get(key);
    if (!raw) return null;
    const session = { ...JSON.parse(raw), ...patch };
    // KEEPTTL preserves the current idle expiry.
    await redis.set(key, JSON.stringify(session), 'KEEPTTL');
    return session;
  }

  async function destroy(id, userId) {
    const hash = sha256(id);
    const multi = redis.multi().del(sessionKey(hash));
    if (userId) multi.srem(userKey(userId), hash);
    await multi.exec();
  }

  /** Revokes every session of a user, optionally keeping one (the caller's current session). */
  async function destroyAllForUser(userId, { exceptId } = {}) {
    const keep = exceptId ? sha256(exceptId) : null;
    const hashes = await redis.smembers(userKey(userId));
    const toDelete = hashes.filter((hash) => hash !== keep);
    if (toDelete.length === 0) return 0;
    await redis
      .multi()
      .del(...toDelete.map(sessionKey))
      .srem(userKey(userId), ...toDelete)
      .exec();
    return toDelete.length;
  }

  return { create, load, update, destroy, destroyAllForUser };
}
