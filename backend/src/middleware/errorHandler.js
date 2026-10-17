import { AppError, notFound } from '../utils/errors.js';

export function notFoundHandler(_req, _res, next) {
  next(notFound('Route not found'));
}

// Express recognises error handlers by their four parameters, so `next` must stay.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // Errors raised by body-parser (malformed JSON, payload too large) carry a status.
  if (!(err instanceof AppError) && err.type && err.status >= 400 && err.status < 500) {
    err = new AppError(
      err.status,
      err.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST',
      err.status === 413 ? 'Request body is too large' : 'Malformed request body',
    );
  }

  // Upload limits enforced by multer (file too large, too many files or fields).
  if (err?.name === 'MulterError') {
    err =
      err.code === 'LIMIT_FILE_SIZE'
        ? new AppError(413, 'PAYLOAD_TOO_LARGE', 'The file is too large (maximum 5 MB)', {
            fieldErrors: { file: 'The file is too large (maximum 5 MB)' },
          })
        : new AppError(400, 'BAD_REQUEST', 'Upload one image file in the "file" field', {
            fieldErrors: { file: 'Upload one image file' },
          });
  }

  if (err instanceof AppError) {
    if (err.status >= 500) req.log.error({ err }, err.message);
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details, requestId: req.id },
    });
  }

  req.log.error({ err }, 'Unhandled error');
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong', requestId: req.id },
  });
}
