import { NextFunction, Request, RequestHandler, Response } from "express";
import * as jwt from "jsonwebtoken";
import { config } from "../../../dependencies";
import { User } from "../model";
import { ExpressError } from "../../../middleware";
import { AuthenticationResponseLocals } from "./types";

export function initLocals(req: Request, res: Response, next: NextFunction) {
  res.locals.authentication = {};
  next();
}

interface LoginRequest {
  username: string;
  password: string;
}

export function validateLoginRequest(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  let { username, password } = req.body;
  if (!username || !password) {
    next(new ExpressError("Username or password not sent in request", 400));
    return;
  } else {
    next();
  }
}

export async function loadCandidateUser(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  let locals: AuthenticationResponseLocals = res.locals.authentication;
  let loginRequest: LoginRequest = req.body;
  let user: User | null;

  try {
    user = await User.findOne({
      where: {
        username: loginRequest.username,
      },
    });
  } catch (err) {
    next(new ExpressError(err, 500));
    return;
  }

  if (user) {
    locals.candidateUser = user;
    next();
  } else {
    next(new ExpressError("User not found", 404));
  }
}

export async function validateCandidatePassword(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  let loginRequest: LoginRequest = req.body;
  let authenticationLocals: AuthenticationResponseLocals =
    res.locals.authentication;
  let user = authenticationLocals.candidateUser as User;

  if (await user.validatePassword(loginRequest.password)) {
    res.locals.user = user;
    next();
  } else {
    next(new ExpressError("Invalid password", 401));
  }
}

export function authenticate(required: boolean): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!config.isAuthenticationEnabled) {
      next();
      return;
    }
    let token: any = req.header("Authorization") as string;
    if (!token) {
      if (required) {
        next(new ExpressError("No jwt sent with request", 401));
      } else {
        next();
      }
      return;
    }
    token = token.replace("Bearer ", "");
    try {
      token = await jwt.verify(token, config.jwtSecret, {
        issuer: config.jwtIssuer,
      });
      try {
        let user = await User.findById(token.uuid);
        res.locals.auth = {
          user: user,
        };
        if (user === null) {
          next(new ExpressError("Invalid jwt; user does not exist", 401));
        }
        next();
      } catch (err) {
        next(new ExpressError(err, 400));
      }
    } catch (err) {
      next(new ExpressError(err, 400));
    }
  };
}
