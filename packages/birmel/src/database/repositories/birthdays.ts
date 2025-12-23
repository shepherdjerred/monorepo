import { prisma } from "../index.js";
import type { Birthday } from "@prisma/client";
import { loggers } from "../../utils/logger.js";

const logger = loggers.database.child("birthdays");

export type CreateBirthdayInput = {
  userId: string;
  guildId: string;
  birthMonth: number; // 1-12
  birthDay: number; // 1-31
  birthYear?: number; // Optional for age calculation
  timezone?: string;
}

export type UpdateBirthdayInput = {
  birthMonth?: number;
  birthDay?: number;
  birthYear?: number;
  timezone?: string;
}

export type UpcomingBirthday = {
  userId: string;
  birthMonth: number;
  birthDay: number;
  birthYear?: number;
  daysUntil: number;
}

/**
 * Create a new birthday entry for a user
 */
export async function createBirthday(input: CreateBirthdayInput): Promise<Birthday> {
  logger.debug("Creating birthday", { userId: input.userId, guildId: input.guildId });

  // Validate month and day
  if (input.birthMonth < 1 || input.birthMonth > 12) {
    throw new Error("Birth month must be between 1 and 12");
  }
  if (input.birthDay < 1 || input.birthDay > 31) {
    throw new Error("Birth day must be between 1 and 31");
  }

  const birthday = await prisma.birthday.create({
    data: {
      userId: input.userId,
      guildId: input.guildId,
      birthMonth: input.birthMonth,
      birthDay: input.birthDay,
      birthYear: input.birthYear ?? null,
      timezone: input.timezone ?? "UTC",
    },
  });

  logger.info("Birthday created", {
    userId: input.userId,
    guildId: input.guildId,
    date: `${input.birthMonth.toString()}/${input.birthDay.toString()}`,
  });

  return birthday;
}

/**
 * Get a birthday for a specific user in a guild
 */
export async function getBirthday(
  userId: string,
  guildId: string
): Promise<Birthday | null> {
  return prisma.birthday.findUnique({
    where: {
      userId_guildId: {
        userId,
        guildId,
      },
    },
  });
}

/**
 * Update an existing birthday
 */
export async function updateBirthday(
  userId: string,
  guildId: string,
  data: UpdateBirthdayInput
): Promise<Birthday> {
  logger.debug("Updating birthday", { userId, guildId });

  // Validate if provided
  if (data.birthMonth !== undefined && (data.birthMonth < 1 || data.birthMonth > 12)) {
    throw new Error("Birth month must be between 1 and 12");
  }
  if (data.birthDay !== undefined && (data.birthDay < 1 || data.birthDay > 31)) {
    throw new Error("Birth day must be between 1 and 31");
  }

  const birthday = await prisma.birthday.update({
    where: {
      userId_guildId: {
        userId,
        guildId,
      },
    },
    data,
  });

  logger.info("Birthday updated", { userId, guildId });

  return birthday;
}

/**
 * Delete a birthday entry
 */
export async function deleteBirthday(
  userId: string,
  guildId: string
): Promise<boolean> {
  try {
    await prisma.birthday.delete({
      where: {
        userId_guildId: {
          userId,
          guildId,
        },
      },
    });
    logger.info("Birthday deleted", { userId, guildId });
    return true;
  } catch (error) {
    logger.warn("Failed to delete birthday", { userId, guildId, error });
    return false;
  }
}

/**
 * Get all birthdays happening today in a guild
 */
export async function getBirthdaysToday(guildId: string): Promise<Birthday[]> {
  const now = new Date();
  const month = now.getMonth() + 1; // JS months are 0-indexed
  const day = now.getDate();

  return prisma.birthday.findMany({
    where: {
      guildId,
      birthMonth: month,
      birthDay: day,
    },
  });
}

/**
 * Get upcoming birthdays in the next N days
 */
export async function getUpcomingBirthdays(
  guildId: string,
  daysAhead = 7
): Promise<UpcomingBirthday[]> {
  const birthdays = await prisma.birthday.findMany({
    where: { guildId },
    select: {
      userId: true,
      birthMonth: true,
      birthDay: true,
      birthYear: true,
    },
  });

  const now = new Date();
  const upcoming: UpcomingBirthday[] = [];

  for (const birthday of birthdays) {
    const thisYear = now.getFullYear();

    // Calculate next occurrence of this birthday
    let nextBirthday = new Date(thisYear, birthday.birthMonth - 1, birthday.birthDay);

    // If birthday already passed this year, check next year
    if (nextBirthday < now) {
      nextBirthday = new Date(thisYear + 1, birthday.birthMonth - 1, birthday.birthDay);
    }

    const daysUntil = Math.floor(
      (nextBirthday.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysUntil >= 0 && daysUntil <= daysAhead) {
      const upcomingBirthday: UpcomingBirthday = {
        userId: birthday.userId,
        birthMonth: birthday.birthMonth,
        birthDay: birthday.birthDay,
        daysUntil,
      };
      if (birthday.birthYear !== null) {
        upcomingBirthday.birthYear = birthday.birthYear;
      }
      upcoming.push(upcomingBirthday);
    }
  }

  // Sort by days until birthday
  upcoming.sort((a, b) => a.daysUntil - b.daysUntil);

  return upcoming;
}

/**
 * Get all birthdays in a specific month
 */
export async function getBirthdaysByMonth(
  guildId: string,
  month: number
): Promise<Birthday[]> {
  if (month < 1 || month > 12) {
    throw new Error("Month must be between 1 and 12");
  }

  return prisma.birthday.findMany({
    where: {
      guildId,
      birthMonth: month,
    },
    orderBy: {
      birthDay: "asc",
    },
  });
}
