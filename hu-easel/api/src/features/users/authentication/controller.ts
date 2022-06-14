import { NextFunction, Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { config } from '../../../dependencies';
import { User } from '../model';
import { AuthenticationResponseLocals } from './types';

const { jwtSecret, jwtIssuer } = config;

export async function sendCandidateUserJwt (req: Request, res: Response, next: NextFunction) {
  let authenticationLocals: AuthenticationResponseLocals = res.locals.authentication;
  let user = authenticationLocals.candidateUser as User;

  let { uuid, firstName, lastName, username } = user;

  let token = jwt.sign({
    uuid,
    firstName,
    lastName,
    username
  },
    jwtSecret,
    {
      issuer: jwtIssuer
    });

  res.json({
    token
  });
}
