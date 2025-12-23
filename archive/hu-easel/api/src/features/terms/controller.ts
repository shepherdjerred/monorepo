import { NextFunction, Request, Response } from 'express';
import { Term, TermType } from './model';
import { ExpressError } from '../../middleware';

interface CreateTermRequest {
  type: TermType;
  startDate: Date;
  endDate: Date;
}

export async function createTerm (req: Request, res: Response, next: NextFunction) {
  let { type, startDate, endDate } = req.body as CreateTermRequest;
  try {
    let term = await Term.create({
      type,
      startDate,
      endDate
    });
    res.json(term);
  } catch (err) {
    next(new ExpressError(err, 500));
  }
}

export function readTerm (req: Request, res: Response, next: NextFunction) {
  let { term } = res.locals;
  res.json(term);
}

export async function readTerms (req: Request, res: Response, next: NextFunction) {
  try {
    let terms = await Term.findAll();
    res.json(terms);
  } catch (err) {
    next(new ExpressError(err, 500));
  }
}

interface UpdateTermRequest {
  type: TermType;
  startDate: Date;
  endDate: Date;
}

export async function updateTerm (req: Request, res: Response, next: NextFunction) {
  let term: Term = res.locals.term;
  let { type, startDate, endDate } = req.body as UpdateTermRequest;
  try {
    if (type) term.type = type;
    if (startDate) term.startDate = startDate;
    if (endDate) term.endDate = endDate;

    await term.save();
    res.json(term);
  } catch (err) {
    next(new ExpressError(err, 500));
  }
}

export async function deleteTerm (req: Request, res: Response, next: NextFunction) {
  let term = res.locals.term as Term;
  try {
    await term.destroy();
    res.json(term);
  } catch (err) {
    next(new ExpressError(err, 500));
  }
}
