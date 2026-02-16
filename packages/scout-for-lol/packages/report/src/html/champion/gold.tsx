import { Stat } from "@scout-for-lol/report/html/champion/shared/stat.tsx";

// TODO(https://github.com/shepherdjerred/scout-for-lol/issues/183): Add gold coin icon for better visual hierarchy
export function Gold({ value, durationInMinutes }: { value: number; durationInMinutes: number }) {
  const rateValue = value / durationInMinutes || 0;
  const mainValue = `${value.toLocaleString()} gold`;

  return <Stat mainValue={mainValue} rateValue={rateValue} rateLabel="/ min" ratePrecision={0} />;
}
