// Row splitting for the CSV exports vendors download from a provider's site.
// Shared infrastructure, not a vendor: Venmo, Seattle City Light and Schwab
// each hand out a quoted-field CSV and were each carrying their own copy.

export function parseCsvRow(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (const char of line) {
    if (inQuotes) {
      if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  fields.push(current.trim());
  return fields;
}

// Non-blank lines, split into fields. Blank lines are dropped rather than
// yielding a one-empty-field row, which every caller would have to filter.
export function parseCsvRows(text: string): string[][] {
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => parseCsvRow(line));
}
