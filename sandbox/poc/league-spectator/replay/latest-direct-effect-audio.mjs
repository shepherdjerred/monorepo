const keys = ["soundOnCreateDefault", "soundPersistentDefault"];
const encoder = new TextEncoder();
const string = (value) =>
  typeof value === "string" &&
  !value.includes("\0") &&
  encoder.encode(value).length <= 4095;

export function normalizeDirectSystemAudio(definition) {
  // Original String fields at root+0x78/+0x98. These exact declarations are
  // retained while the ordinary visual slice explicitly omits audio behavior.
  return Object.fromEntries(
    keys.map((key) => {
      const authored = Object.hasOwn(definition, key);
      const value = authored ? definition[key] : "";
      if (!string(value))
        throw Error(
          "Direct effect root audio must be a bounded String without NUL",
        );
      return [key, { value, authored }];
    }),
  );
}

export function validateDirectSystemAudio(audio) {
  if (
    !audio ||
    typeof audio !== "object" ||
    Array.isArray(audio) ||
    Object.keys(audio).length !== keys.length ||
    keys.some((key) => {
      if (!Object.hasOwn(audio, key)) return true;
      const field = audio[key];
      return (
        !field ||
        typeof field !== "object" ||
        Array.isArray(field) ||
        Object.keys(field).length !== 2 ||
        !Object.hasOwn(field, "value") ||
        !Object.hasOwn(field, "authored") ||
        typeof field.authored !== "boolean" ||
        !string(field.value) ||
        (!field.authored && field.value !== "")
      );
    })
  )
    throw Error("Invalid compiled direct effect systemAudio metadata");
}
