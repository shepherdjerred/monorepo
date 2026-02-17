import { Request, Response, NextFunction } from "express";
import { ExpressError } from "../../middleware";

export function validateCreateCourseRequest(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  let { contentUuid, termUuid, section } = req.body;
  if (contentUuid && termUuid && section !== undefined) {
    next();
  } else {
    next(new ExpressError("Invalid request", 422));
    return;
  }
}
