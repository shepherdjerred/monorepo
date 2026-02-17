import lodash from "lodash";

export function wait(wait: number) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(undefined), wait);
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
  window.URL.revokeObjectURL(url);
  a.remove();
}
