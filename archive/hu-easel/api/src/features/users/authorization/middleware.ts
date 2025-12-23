import { NextFunction, Request, RequestHandler, Response } from 'express';
import { User, UserRole } from '../model';
import { config } from '../../../dependencies';
import { ExpressError } from '../../../middleware';
import * as log from 'loglevel';

const { STUDENT, PROFESSOR, ADMIN } = UserRole;

let UserRoleValues = {
  [STUDENT]: 0,
  [PROFESSOR]: 1,
  [ADMIN]: 2
};

export function checkUserIsAuthorized (requiredRole: UserRole, action: string, resource: string): RequestHandler {
  return checkAuthorizationIsEnabled(async function (req: Request, res: Response, next: NextFunction) {
    let { role, username } = res.locals.auth.user as User;

    if (UserRoleValues[requiredRole] <= UserRoleValues[role]) {
      next();
    } else {
      log.error('User ' + username + ' attempted to ' + action + ' ' + resource + ' without authorization');
      next(new ExpressError('You must be a ' + requiredRole + ' to ' + action + ' ' + resource + '. You are a ' + role,
        400));
    }
  });
}

export function checkAuthorizationIsEnabled (middleware: RequestHandler): RequestHandler {
  if (config.isAuthorizationEnabled) {
    return middleware;
  } else {
    return (req: Request, res: Response, next: NextFunction) => {
      next();
    };
  }
}
