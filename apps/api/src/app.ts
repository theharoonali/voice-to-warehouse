import express from 'express';
import helmet from 'helmet';
import { errorHandler } from './middleware/error-handler.js';
import { notFound } from './middleware/not-found.js';
import { apiRouter } from './routes/index.js';

export const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use('/api/v1', apiRouter);
app.use(notFound);
app.use(errorHandler);
