import { NextFunction, Request, RequestHandler, Response } from 'express';
import { User, UserRole } from './model';
import { ExpressError } from '../../middleware';
import { checkAuthorizationIsEnabled, checkUserIsAuthorized } from './authorization/middleware';

export async function getUserFromParameter (req: Request, res: Response, next: NextFunction, userUuid: string) {
  try {
    let user: User | null = await User.findById(userUuid);
    if (user) {
      res.locals.user = user;
      next();
    } else {
      next(new ExpressError('User not found', 404));
    }
  } catch (err) {
    next(new ExpressError(err, 500));
  }
}

/**
 * Require that a user be an admin if registration is not enabled
 */
export function authorizeCreateUser (): RequestHandler {
  return checkAuthorizationIsEnabled((req: Request, res: Response, next: NextFunction) => {
    if (!req.body.isRegister) {
      checkUserIsAuthorized(UserRole.ADMIN, 'CREATE', 'USER/*')(req, res, next);
    } else {
      next();
    }
  });
}

/**
 * Require that the user is an admin if reading a user other than themself
 */
export function authorizeReadUser (): RequestHandler {
  return checkAuthorizationIsEnabled((req: Request, res: Response, next: NextFunction) => {
    let targetUser = res.locals.user;
    let authenticatedUser = res.locals.auth.user;
    if (targetUser.uuid === authenticatedUser.uuid) {
      next();
    } else {
      checkUserIsAuthorized(UserRole.PROFESSOR, 'READ/' + targetUser.username, targetUser.username)(req, res, next);
    }
  });
}

/**
 * Require the user is an admin if changing a user's role or hNumber, or updating another user
 */
export function authorizeUpdateUser (): RequestHandler {
  return checkAuthorizationIsEnabled((req: Request, res: Response, next: NextFunction) => {
    let { role, hNumber } = req.body;
    let targetUser = res.locals.user;
    let authenticatedUser = res.locals.auth.user;

    if (role || hNumber || targetUser.uuid !== authenticatedUser.uuid) {
      checkUserIsAuthorized(UserRole.ADMIN, 'UPDATE', 'USER/' + targetUser.username)(req, res, next);
    } else {
      next();
    }
  });
}
