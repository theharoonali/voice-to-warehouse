import { Router } from 'express';
import { greetingRouter } from './greeting.routes.js';
import { transcriptionRouter } from './transcription.routes.js';
import { structuredOutputRouter } from './structured-output.routes.js';

export const apiRouter = Router();

apiRouter.use('/greeting', greetingRouter);
apiRouter.use('/transcription', transcriptionRouter);
apiRouter.use('/structured-output', structuredOutputRouter);
