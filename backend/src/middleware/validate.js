import { ApiError } from '../utils/ApiError.js';

/**
 * Validates req.body against a zod schema and replaces it with the parsed value.
 *
 * Use `{ onlyGiven: true }` for PATCH routes. A schema's defaults (e.g. "schedule defaults to OTC") are right
 * when creating, but on a partial edit they would silently overwrite fields the caller never sent.
 * With onlyGiven, only the keys present in the request are kept after validation.
 */
export const validateBody = (schema, { onlyGiven = false } = {}) => (req, _res, next) => {
  const given = req.body && typeof req.body === 'object' ? Object.keys(req.body) : [];
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return next(ApiError.badRequest('Validation failed', details));
  }
  req.body = onlyGiven ? Object.fromEntries(Object.entries(result.data).filter(([k]) => given.includes(k))) : result.data;
  next();
};
