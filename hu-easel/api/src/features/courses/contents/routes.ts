import { UserRole } from '../../users/model';
import { Router } from 'express';
import { getContentFromParameter } from './middleware';
import { authenticate } from '../../users/authentication/middleware';
import { checkUserIsAuthorized } from '../../users/authorization/middleware';
import { validateCreateContentRequest } from './validator';
import { createContent, deleteContent, readContent, readContents, updateContent } from './controller';

let router = Router();

const { PROFESSOR, STUDENT } = UserRole;

router.param('content_uuid',
  getContentFromParameter);

router.post('/',
  authenticate(true),
  checkUserIsAuthorized(PROFESSOR, 'CREATE', 'CONTENT/*'),
  validateCreateContentRequest,
  createContent);

router.get('/:content_uuid',
  authenticate(true),
  checkUserIsAuthorized(STUDENT, 'READ', 'CONTENT/*'),
  readContent);

router.get('/',
  authenticate(true),
  checkUserIsAuthorized(STUDENT, 'READ', 'CONTENT/*'),
  readContents);

router.put('/:content_uuid',
  authenticate(true),
  checkUserIsAuthorized(PROFESSOR, 'UPDATE', 'CONTENT/*'),
  updateContent);

router.delete('/:content_uuid',
  authenticate(true),
  checkUserIsAuthorized(PROFESSOR, 'DELETE', 'CONTENT/*'),
  deleteContent);

export default router;
