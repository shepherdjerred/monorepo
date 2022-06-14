import { NextFunction, Request, Response } from 'express';
import { ExpressError } from '../../middleware';

export async function validateCreateUserRequest (req: Request, res: Response, next: NextFunction) {
  let { firstName, lastName, username, hNumber, password, role } = req.body;
  if (firstName && lastName && username && hNumber && password && role) {
    next();
  } else {
    next(new ExpressError('Invalid request', 422));
    return;
  }
}
