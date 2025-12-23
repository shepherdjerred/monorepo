import { Router } from 'express';
import { sendCandidateUserJwt } from './controller';
import { initLocals, loadCandidateUser, validateCandidatePassword, validateLoginRequest } from './middleware';

let router = Router();

router.use('/',
  initLocals
);

router.post('/login',
  validateLoginRequest,
  loadCandidateUser,
  validateCandidatePassword,
  sendCandidateUserJwt
);

export default router;
