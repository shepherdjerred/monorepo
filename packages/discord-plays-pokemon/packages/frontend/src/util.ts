import lodash from "lodash";

export function wait(wait: number) {
  return new Promise<void>((resolve) => {
    setTimeout(() => { resolve(); }, wait);
  });
}

export function randomId(): string {
  return lodash.random(Number.MAX_VALUE).toString();
}

export function downloadScreenshot(data: string) {
  const blob = new Blob([data], { type: "image/png" });
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = "dscrdplyspkmn-screenshot.png";
  a.click();
  globalThis.URL.revokeObjectURL(url);
  a.remove();
}
