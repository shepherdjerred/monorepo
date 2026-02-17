import { NextFunction, Request, Response } from "express";
import { Content } from "./model";
import { ExpressError } from "../../../middleware";
import { ContentResponseLocals } from "./types";

export async function getContentFromParameter(
  req: Request,
  res: Response,
  next: NextFunction,
  contentUuid: string,
) {
  let locals = res.locals as ContentResponseLocals;
  try {
    let content: Content | null = await Content.findById(contentUuid);
    if (content) {
      locals.contentParam = content;
      next();
    } else {
      next(new ExpressError("Content not found", 404));
    }
  } catch (err) {
    next(new ExpressError(err, 500));
  }
}
