import { NextFunction, Request, Response } from 'express';
import { ExpressError } from '../../../middleware';
import { Listing } from './model';
import { ListingResponseLocals } from './types';

interface CreateListingRequest {
  department: string;
  identifier: number;
}

export async function createListing (req: Request, res: Response, next: NextFunction) {
  let { department, identifier } = req.body as CreateListingRequest;
  try {
    let listing = await Listing.create({
      department,
      identifier
    });
    res.json(listing);
  } catch (err) {
    next(new ExpressError(err, 500));
  }
}

export async function readListing (req: Request, res: Response, next: NextFunction) {
  let { listingParam } = res.locals as ListingResponseLocals;
  res.json(listingParam);
}

export async function readListings (req: Request, res: Response, next: NextFunction) {
  try {
    let listings = await Listing.findAll();
    res.json(listings);
  } catch (err) {
    next(new ExpressError(err, 500));
  }
}

interface UpdateListingRequest {
  department?: string;
  identifier?: number;
}

export async function updateListing (req: Request, res: Response, next: NextFunction) {
  // TODO can this line be cleaned up?
  let listing = (res.locals as ListingResponseLocals).listingParam as Listing;
  let { department, identifier } = req.body as UpdateListingRequest;
  if (department) listing.department = department;
  if (identifier) listing.identifier = identifier;
  try {
    await listing.save();
  } catch (err) {
    next(new ExpressError(err, 500));
  }
}

export async function deleteListing (req: Request, res: Response, next: NextFunction) {
  let listing = (res.locals as ListingResponseLocals).listingParam as Listing;
  try {
    await listing.destroy();
    res.json(listing);
  } catch (err) {
    next(new ExpressError(err, 500));
  }
}
