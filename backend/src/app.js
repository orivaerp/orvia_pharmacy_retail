import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { errorHandler, notFound } from './middleware/error.js';
import routes from './routes.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()), credentials: true }));
  // the raw bytes are kept for webhooks: their signature is computed over the exact body
  app.use(express.json({ limit: '3mb', verify: (req, _res, buf) => { if (req.originalUrl.startsWith('/api/v1/webhooks')) req.rawBody = buf; } }));
  if (env.NODE_ENV !== 'test') app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

  app.use('/api/v1', routes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
