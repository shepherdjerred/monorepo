import { Settings } from "./settings";

export function save(settings: Settings): void {
  localStorage.setItem("settings", JSON.stringify(settings));
}

export function load(): Settings {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return (
    JSON.parse(localStorage.getItem("settings") || "0") || {
      instance: "",
      awsSecretAccessKey: "",
      awsAccessKeyId: "",
    }
  );
}
