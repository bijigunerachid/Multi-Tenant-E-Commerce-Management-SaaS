/**
 * Loads the session named by the cookie and attaches helpers:
 *   req.session          the session data, or null
 *   req.startSession()   creates a fresh session (always a new ID: prevents session fixation)
 *   req.endSession()     destroys the current session and clears the cookie
 *   req.updateSession()  merges fields into the current session
 */
export function sessionMiddleware({ sessionStore, cookieName, cookieOptions }) {
  return async function loadSession(req, res, next) {
    const sessionId = req.cookies?.[cookieName];
    req.sessionId = null;
    req.session = null;

    if (sessionId) {
      const session = await sessionStore.load(sessionId);
      if (session) {
        req.sessionId = sessionId;
        req.session = session;
      } else {
        res.clearCookie(cookieName, { ...cookieOptions, maxAge: undefined });
      }
    }

    req.startSession = async ({ userId, activeOrganizationId }) => {
      if (req.sessionId) await sessionStore.destroy(req.sessionId, req.session?.userId);
      const { id, session } = await sessionStore.create({ userId, activeOrganizationId });
      req.sessionId = id;
      req.session = session;
      res.cookie(cookieName, id, cookieOptions);
      return session;
    };

    req.endSession = async () => {
      if (req.sessionId) await sessionStore.destroy(req.sessionId, req.session?.userId);
      req.sessionId = null;
      req.session = null;
      res.clearCookie(cookieName, { ...cookieOptions, maxAge: undefined });
    };

    req.updateSession = async (patch) => {
      if (!req.sessionId) return null;
      req.session = await sessionStore.update(req.sessionId, patch);
      return req.session;
    };

    next();
  };
}

export function sessionCookieSettings(env) {
  const production = env.NODE_ENV === 'production';
  return {
    // The __Host- prefix makes browsers reject the cookie unless it is Secure, has Path=/
    // and no Domain, so a sibling subdomain cannot set or overwrite it.
    cookieName: production ? '__Host-vendora_session' : 'vendora_session',
    cookieOptions: {
      httpOnly: true,
      secure: production,
      sameSite: 'lax',
      path: '/',
      maxAge: env.SESSION_ABSOLUTE_DAYS * 24 * 60 * 60 * 1000,
    },
  };
}
