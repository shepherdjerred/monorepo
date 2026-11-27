import { z } from "zod";

/** The numbers every board shape is made of. */
export const Coordinate = z.number();
export const Size = z.number().positive();
export const Unit = z.number().min(0).max(1);
export const PageIndex = z.number().int().min(0);
