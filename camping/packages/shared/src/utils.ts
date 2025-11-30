// Utility functions for camping reservation system

/**
 * Format a date as YYYY-MM-DD
 */
export function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * Parse a YYYY-MM-DD string to a Date object
 */
export function parseDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Get an array of dates between start and end (inclusive)
 */
export function getDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const current = parseDate(startDate);
  const end = parseDate(endDate);

  while (current <= end) {
    dates.push(formatDate(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

/**
 * Find consecutive available dates within a range
 */
export function findConsecutiveAvailability(
  availableDates: string[],
  minNights: number
): string[][] {
  if (availableDates.length < minNights) {
    return [];
  }

  const sorted = [...availableDates].sort();
  const sequences: string[][] = [];
  let currentSequence: string[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prevDate = parseDate(sorted[i - 1]);
    const currDate = parseDate(sorted[i]);
    const diffDays = Math.round(
      (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (diffDays === 1) {
      currentSequence.push(sorted[i]);
    } else {
      if (currentSequence.length >= minNights) {
        sequences.push(currentSequence);
      }
      currentSequence = [sorted[i]];
    }
  }

  if (currentSequence.length >= minNights) {
    sequences.push(currentSequence);
  }

  return sequences;
}

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Check if a time is within quiet hours
 */
export function isWithinQuietHours(
  quietStart?: string,
  quietEnd?: string
): boolean {
  if (!quietStart || !quietEnd) {
    return false;
  }

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [startHour, startMin] = quietStart.split(":").map(Number);
  const [endHour, endMin] = quietEnd.split(":").map(Number);

  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;

  if (startMinutes <= endMinutes) {
    // Normal range (e.g., 22:00 to 07:00 doesn't cross midnight... wait, that does)
    // Actually for 22:00 to 07:00, start > end, so we use the else branch
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Crosses midnight (e.g., 22:00 to 07:00)
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}
