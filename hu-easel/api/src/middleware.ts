import * as log from 'loglevel';
import { NextFunction, Request, Response } from 'express';
import { config } from './dependencies';

export class ExpressError {
  error: Error | string;
  statusCode: number;

  constructor (error: Error | string, statusCode?: number) {
    this.error = error;
    this.statusCode = statusCode || 500;
  }

  toJSON () {
    if (this.error instanceof Error) {
      return {
        name: this.error.name,
        message: this.error.message,
        stack: this.error.stack
      };
    } else {
      return {
        name: this.error
      };
    }
  }
}

export function handleError (err: ExpressError, req: Request, res: Response, next: NextFunction) {
  log.error(err.error);

  let response = err.toJSON();

  if (!config.isDevelopmentMode) {
    delete response.stack;
  }

  res.status(err.statusCode);
  res.json(err);
}
