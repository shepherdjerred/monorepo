import userRouter from './users/routes';
import termRouter from './terms/routes';
import courseRouter from './courses/routes';
import { Router } from 'express';

let router = Router();

router.use('/users', userRouter);
router.use('/terms', termRouter);
router.use('/courses', courseRouter);

export default router;
