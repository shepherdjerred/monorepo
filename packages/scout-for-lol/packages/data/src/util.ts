export function startCase(str: string): string {
  return str
    .replace(/([A-Z])/g, " $1") // insert a space before all caps
    .replace(/^./, (firstChar) => firstChar.toUpperCase()) // capitalize the first character
    .trim();
}
