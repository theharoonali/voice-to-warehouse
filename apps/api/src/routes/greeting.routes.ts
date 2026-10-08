import { Router } from 'express';
import { getGreeting } from '../controllers/greeting.controller.js';

export const greetingRouter = Router();

greetingRouter.get('/', getGreeting);
