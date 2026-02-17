import { z } from "zod";
import type { GenerationProgress } from "@scout-for-lol/frontend/lib/review-tool/generator";

export const ErrorSchema = z.object({ message: z.string() });

export type ActiveGeneration = {
  id: string;
  progress?: GenerationProgress;
  startTime: number;
};

// Global timer for tracking elapsed time - updates every second
let timerTick = 0;
const timerSubscribers = new Set<() => void>();
let timerInterval: ReturnType<typeof setInterval> | null = null;

function startGlobalTimer() {
  timerInterval ??= setInterval(() => {
    timerTick += 1;
    timerSubscribers.forEach((callback) => {
      callback();
    });
  }, 1000);
}

function stopGlobalTimer() {
  if (timerInterval !== null && timerSubscribers.size === 0) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

export function subscribeToTimer(callback: () => void) {
  timerSubscribers.add(callback);
  startGlobalTimer();
  return () => {
    timerSubscribers.delete(callback);
    stopGlobalTimer();
  };
}

export function getTimerSnapshot() {
  return timerTick;
}
