import {
  createBirthday,
  getBirthday,
  updateBirthday,
  deleteBirthday,
  getBirthdaysToday,
  getUpcomingBirthdays,
  getBirthdaysByMonth,
} from "@shepherdjerred/birmel/database/repositories/birthdays.ts";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";

const logger = loggers.tools.child("birthdays");

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

type BirthdayResult = {
  success: boolean;
  message: string;
  data?:
    | {
        userId: string;
        birthMonth: number;
        birthDay: number;
        birthYear?: number;
        timezone: string;
      }
    | {
        birthdays: {
          userId: string;
          birthMonth: number;
          birthDay: number;
          birthYear?: number;
          daysUntil?: number;
        }[];
      };
};

type SetBirthdayOptions = {
  guildId: string;
  userId: string | undefined;
  birthMonth: number | undefined;
  birthDay: number | undefined;
  birthYear: number | undefined;
  timezone: string | undefined;
};

export async function handleSetBirthday(
  options: SetBirthdayOptions,
): Promise<BirthdayResult> {
  const { guildId, userId, birthMonth, birthDay, birthYear, timezone } =
    options;
  if (
    userId == null ||
    userId.length === 0 ||
    birthMonth == null ||
    birthDay == null
  ) {
    return {
      success: false,
      message: "userId, birthMonth, and birthDay are required for set",
    };
  }
  const birthday = await createBirthday({
    userId,
    guildId,
    birthMonth,
    birthDay,
    ...(birthYear !== undefined && { birthYear }),
    timezone: timezone ?? "UTC",
  });
  logger.info("Birthday set", { guildId, userId });
  return {
    success: true,
    message: `Birthday set to ${birthMonth.toString()}/${birthDay.toString()}${birthYear == null ? "" : `/${birthYear.toString()}`}`,
    data: {
      userId: birthday.userId,
      birthMonth: birthday.birthMonth,
      birthDay: birthday.birthDay,
      ...(birthday.birthYear != null && { birthYear: birthday.birthYear }),
      timezone: birthday.timezone,
    },
  };
}

export async function handleGetBirthday(
  guildId: string,
  userId: string | undefined,
): Promise<BirthdayResult> {
  if (userId == null || userId.length === 0) {
    return { success: false, message: "userId is required for get" };
  }
  const birthday = await getBirthday(userId, guildId);
  if (birthday == null) {
    return { success: false, message: "No birthday found for this user" };
  }
  return {
    success: true,
    message: `Birthday is ${birthday.birthMonth.toString()}/${birthday.birthDay.toString()}${birthday.birthYear == null ? "" : `/${birthday.birthYear.toString()}`}`,
    data: {
      userId: birthday.userId,
      birthMonth: birthday.birthMonth,
      birthDay: birthday.birthDay,
      ...(birthday.birthYear != null && { birthYear: birthday.birthYear }),
      timezone: birthday.timezone,
    },
  };
}

type UpdateBirthdayOptions = {
  guildId: string;
  userId: string | undefined;
  birthMonth: number | undefined;
  birthDay: number | undefined;
  birthYear: number | undefined;
  timezone: string | undefined;
};

export async function handleUpdateBirthday(
  options: UpdateBirthdayOptions,
): Promise<BirthdayResult> {
  const { guildId, userId, birthMonth, birthDay, birthYear, timezone } =
    options;
  if (userId == null || userId.length === 0) {
    return { success: false, message: "userId is required for update" };
  }
  const birthday = await updateBirthday(userId, guildId, {
    ...(birthMonth !== undefined && { birthMonth }),
    ...(birthDay !== undefined && { birthDay }),
    ...(birthYear !== undefined && { birthYear }),
    ...(timezone !== undefined && { timezone }),
  });
  logger.info("Birthday updated", { guildId, userId });
  return {
    success: true,
    message: `Birthday updated to ${birthday.birthMonth.toString()}/${birthday.birthDay.toString()}`,
    data: {
      userId: birthday.userId,
      birthMonth: birthday.birthMonth,
      birthDay: birthday.birthDay,
      ...(birthday.birthYear != null && { birthYear: birthday.birthYear }),
      timezone: birthday.timezone,
    },
  };
}

export async function handleDeleteBirthday(
  guildId: string,
  userId: string | undefined,
): Promise<BirthdayResult> {
  if (userId == null || userId.length === 0) {
    return { success: false, message: "userId is required for delete" };
  }
  const deleted = await deleteBirthday(userId, guildId);
  if (!deleted) {
    return { success: false, message: "No birthday found for this user" };
  }
  logger.info("Birthday deleted", { guildId, userId });
  return { success: true, message: "Birthday deleted successfully" };
}

export async function handleTodayBirthdays(
  guildId: string,
): Promise<BirthdayResult> {
  const birthdays = await getBirthdaysToday(guildId);
  const data = birthdays.map((b) => ({
    userId: b.userId,
    birthMonth: b.birthMonth,
    birthDay: b.birthDay,
    ...(b.birthYear != null && { birthYear: b.birthYear }),
  }));
  return {
    success: true,
    message:
      birthdays.length > 0
        ? `Found ${birthdays.length.toString()} birthday(s) today`
        : "No birthdays today",
    data: { birthdays: data },
  };
}

export async function handleUpcomingBirthdays(
  guildId: string,
  daysAhead = 7,
): Promise<BirthdayResult> {
  const birthdays = await getUpcomingBirthdays(guildId, daysAhead);
  return {
    success: true,
    message:
      birthdays.length > 0
        ? `Found ${birthdays.length.toString()} upcoming birthday(s)`
        : `No birthdays in the next ${daysAhead.toString()} days`,
    data: { birthdays },
  };
}

export async function handleBirthdaysByMonth(
  guildId: string,
  month: number | undefined,
): Promise<BirthdayResult> {
  if (month == null) {
    return { success: false, message: "month is required for by-month" };
  }
  const birthdays = await getBirthdaysByMonth(guildId, month);
  const data = birthdays.map((b) => ({
    userId: b.userId,
    birthMonth: b.birthMonth,
    birthDay: b.birthDay,
    ...(b.birthYear != null && { birthYear: b.birthYear }),
  }));
  const monthName = monthNames[month - 1];
  return {
    success: true,
    message:
      birthdays.length > 0
        ? `Found ${birthdays.length.toString()} birthday(s) in ${monthName ?? "this month"}`
        : `No birthdays in ${monthName ?? "this month"}`,
    data: { birthdays: data },
  };
}
