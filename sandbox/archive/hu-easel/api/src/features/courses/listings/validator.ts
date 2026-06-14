import { NextFunction, Request, Response } from "express";
import { ExpressError } from "../../../middleware";

export function validateCreateListingRequest(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  let { department, identifier } = req.body;
  if (department && identifier) {
    next();
  } else {
    next(new ExpressError("Invalid request", 422));
    return;
  }
}
