import { Router } from 'express';
import { greetingRouter } from './greeting.routes.js';

export const apiRouter = Router();

apiRouter.use('/greeting', greetingRouter);
