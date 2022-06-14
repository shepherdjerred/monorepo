import { Request, Response, NextFunction } from 'express';
import { Term } from './model';
import { ExpressError } from '../../middleware';

export async function getTermFromParameter (req: Request, res: Response, next: NextFunction, termUuid: string) {
  try {
    let term: Term | null = await Term.findById(termUuid);
    if (term) {
      res.locals.term = term;
      next();
    } else {
      next(new ExpressError('Term not found', 404));
    }
  } catch (err) {
    next(new ExpressError(err, 500));
  }
}
