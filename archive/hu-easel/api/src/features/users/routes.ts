import { Router } from 'express';
import { authorizeCreateUser, authorizeReadUser, authorizeUpdateUser, getUserFromParameter } from './middleware';
import { createUser, deleteUser, readUser, readUsers, updateUser} from './controller';
import authenticationRouter from './authentication/routes';
import { authenticate } from './authentication/middleware';
import { checkUserIsAuthorized } from './authorization/middleware';
import { UserRole } from './model';
import { validateCreateUserRequest } from './validator';

const { PROFESSOR, ADMIN } = UserRole;

let router = Router();

router.param('user_uuid',
  getUserFromParameter);

router.post('/',
  validateCreateUserRequest,
  authenticate(false),
  authorizeCreateUser(),
  createUser);

router.get('/:user_uuid',
  authenticate(true),
  authorizeReadUser(),
  readUser);

router.get('/',
  authenticate(true),
  checkUserIsAuthorized(PROFESSOR, 'READ', 'USER/*'),
  readUsers);

router.put('/:user_uuid',
  authenticate(true),
  authorizeUpdateUser(),
  updateUser);

router.delete('/:user_uuid',
  authenticate(true),
  checkUserIsAuthorized(ADMIN, 'DELETE', 'USER/*'),
  deleteUser);

router.use('/authentication', authenticationRouter);

export default router;
