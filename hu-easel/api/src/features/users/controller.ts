import { NextFunction, Request, Response } from 'express';
import { config } from '../../dependencies';
import { User, UserRole } from './model';
import { ExpressError } from '../../middleware';

const { STUDENT } = UserRole;

interface CreateUserRequest {
  firstName: string;
  lastName: string;
  username: string;
  hNumber: string;
  password: string;
  role: UserRole;
  isRegister?: boolean;
}

// TODO support adding users in bulk
export async function createUser (req: Request, res: Response, next: NextFunction) {
  let { firstName, lastName, username, hNumber, password, role, isRegister } = req.body as CreateUserRequest;
  if (isRegister) {
    if (config.isRegistrationEnabled) {
      role = STUDENT;
    } else {
      next(new ExpressError('Registration is disabled', 403));
      return;
    }
  }
  try {
    let user = await User.create({
      firstName,
      lastName,
      username,
      hNumber,
      password,
      role
    });
    res.json(user);
  } catch (err) {
    next(new ExpressError(err, 500));
  }
}

export function readUser (req: Request, res: Response, next: NextFunction) {
  let { user } = res.locals;
  res.json(user);
}

export async function readUsers (req: Request, res: Response, next: NextFunction) {
  try {
    let users = await User.findAll();
    res.json(users);
  } catch (err) {
    next(new ExpressError(err, 500));
  }
}

interface UpdateUserRequest {
  firstName?: string;
  lastName?: string;
  username?: string;
  hNumber?: string;
  password?: string;
  role?: UserRole;
}

export async function updateUser (req: Request, res: Response, next: NextFunction) {
  let user: User = res.locals.user as User;
  let { firstName, lastName, username, hNumber, password, role } = req.body as UpdateUserRequest;
  try {
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (username) user.username = username;
    if (hNumber) user.hNumber = hNumber;
    if (role) user.role = role;
    if (password) user.password = password;

    await user.save();
    res.json(user);
  } catch (err) {
    next(new ExpressError(err, 500));
  }
}

export async function deleteUser (req: Request, res: Response, next: NextFunction) {
  let user: User = res.locals.user;
  try {
    await user.destroy();
    res.json(user);
  } catch (err) {
    next(new ExpressError(err, 500));
  }
}
