import { Stat } from "@scout-for-lol/report/html/champion/shared/stat.tsx";

export function CreepScore({ value, durationInMinutes }: { value: number; durationInMinutes: number }) {
  const rateValue = value / durationInMinutes || 0;
  const mainValue = `${value.toLocaleString()} CS`;

  return <Stat mainValue={mainValue} rateValue={rateValue} rateLabel="/ min" ratePrecision={1} />;
}
