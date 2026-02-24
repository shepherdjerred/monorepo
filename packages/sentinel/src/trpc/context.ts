import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "@shepherdjerred/sentinel/database/index.ts";

export type Context = {
  prisma: PrismaClient;
};

export function createContext(): Context {
  return { prisma: getPrisma() };
}
