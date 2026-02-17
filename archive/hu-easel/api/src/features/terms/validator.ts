import { NextFunction, Request, Response } from "express";
import { ExpressError } from "../../middleware";

export function validateCreateTermRequest(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  let { type, startDate, endDate } = req.body;
  if (type !== undefined && startDate && endDate) {
    next();
  } else {
    next(new ExpressError("Invalid request", 422));
    return;
  }
}
