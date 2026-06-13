import { NextFunction, Request, Response } from "express";
import { Listing } from "./model";
import { ExpressError } from "../../../middleware";
import { ListingResponseLocals } from "./types";

export async function getListingFromParameter(
  req: Request,
  res: Response,
  next: NextFunction,
  listingUuid: string,
) {
  let locals = res.locals as ListingResponseLocals;
  try {
    let listing: Listing | null = await Listing.findById(listingUuid);
    if (listing) {
      locals.listingParam = listing;
      next();
    } else {
      next(new ExpressError("Listing not found", 404));
    }
  } catch (err) {
    next(new ExpressError(err, 500));
  }
}
