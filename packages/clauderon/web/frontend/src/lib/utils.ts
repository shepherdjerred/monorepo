import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);
}

export function formatRelativeTime(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60_000);

  if (diffMins < 1) {return "just now";}
  if (diffMins < 60) {return `${String(diffMins)}m ago`;}

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) {return `${String(diffHours)}h ago`;}

  const diffDays = Math.floor(diffHours / 24);
  return `${String(diffDays)}d ago`;
}

/**
 * Extracts the base repository URL from a PR URL
 * E.g., "https://github.com/owner/repo/pull/123" -> "https://github.com/owner/repo"
 */
export function getRepoUrlFromPrUrl(prUrl: string): string | null {
  try {
    const regex = /^(https?:\/\/[^/]+\/[^/]+\/[^/]+)\/pull\/\d+/;
    const match = regex.exec(prUrl);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
