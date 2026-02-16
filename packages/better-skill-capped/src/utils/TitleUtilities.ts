export function rawTitleToDisplayTitle(rawTitle: string): string {
  const title = rawTitle.replace(/\$/g, "").replace(/{[a-zA-Z]*}/, "");
  return toTitleCase(title);
}

function toTitleCase(input: string): string {
  input = input.toLowerCase();
  const words = input.split(" ");
  const results = [];
  for (const word of words) {
    const letter = word.charAt(0).toUpperCase();
    results.push(letter + word.slice(1));
  }
  return results.join(" ");
}
