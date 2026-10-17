import { badRequest } from '../utils/errors.js';

/**
 * Validates params, query and body with Zod schemas. Parsed (and therefore trusted, typed and
 * stripped of unknown keys) values are placed on `req.valid`; handlers read only from there.
 */
export function validate(schemas) {
  return function validateRequest(req, _res, next) {
    const valid = {};
    const fieldErrors = {};

    for (const part of ['params', 'query', 'body']) {
      if (!schemas[part]) continue;
      const result = schemas[part].safeParse(req[part] ?? {});
      if (result.success) {
        valid[part] = result.data;
      } else {
        for (const issue of result.error.issues) {
          const field = issue.path.length ? issue.path.join('.') : part;
          fieldErrors[field] ??= issue.message;
        }
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      return next(badRequest('VALIDATION_FAILED', 'Some fields are invalid', { fieldErrors }));
    }
    req.valid = valid;
    next();
  };
}
