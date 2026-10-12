/** Common original v3 all-bot recording envelope; each case checks its own ending and roster. */
export function botRecording(recording: string, match: string) {
  const rows = recording
    .trim()
    .split("\n")
    .map((row) => row.split("\t"));
  const header = rows[0];
  const members = rows.filter((row) => row[0] === "R");
  const endings = rows.filter((row) => row[0] === "X");
  if (
    header?.[0] !== "H" ||
    header[1] !== "3" ||
    header[2] !== match ||
    header[3] !== "training-yard" ||
    members.length !== 16 ||
    rows.some((row) => row[0] === "N")
  )
    throw new Error("Original all-bot recording header or membership differs");
  return { members, endings };
}
