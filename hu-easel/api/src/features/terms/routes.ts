import { Router } from 'express';
import { authenticate } from '../users/authentication/middleware';
import { checkUserIsAuthorized } from '../users/authorization/middleware';
import { UserRole } from '../users/model';
import { getTermFromParameter } from './middleware';
import { createTerm, deleteTerm, readTerm, readTerms, updateTerm} from './controller';
import { validateCreateTermRequest } from './validator';

const { ADMIN, STUDENT } = UserRole;

let router = Router();

router.param('term_uuid',
  getTermFromParameter);

router.post('/',
  authenticate(true),
  checkUserIsAuthorized(ADMIN, 'CREATE', 'TERM/*'),
  validateCreateTermRequest,
  createTerm);

router.get('/:term_uuid',
  authenticate(true),
  checkUserIsAuthorized(STUDENT, 'READ', 'TERM/*'),
  readTerm);

router.get('/',
  authenticate(true),
  checkUserIsAuthorized(STUDENT, 'READ', 'TERM/*'),
  readTerms);

router.put('/:term_uuid',
  authenticate(true),
  checkUserIsAuthorized(ADMIN, 'UPDATE', 'TERM/*'),
  updateTerm);

router.delete('/:term_uuid',
  authenticate(true),
  checkUserIsAuthorized(ADMIN, 'DELETE', 'TERM/*'),
  deleteTerm);

export default router;
