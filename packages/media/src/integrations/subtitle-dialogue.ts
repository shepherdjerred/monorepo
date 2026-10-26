type Cue = { start: number; end: number; text: string };

/** Match each opener through its first following closer without rescanning an unmatched tail. */
function stripDelimited(text: string, opener: string, closer: string): string {
  const visible: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf(opener, cursor);
    if (start === -1) break;
    const end = text.indexOf(closer, start + 1);
    if (end === -1) break;
    visible.push(text.slice(cursor, start));
    cursor = end + 1;
  }
  visible.push(text.slice(cursor));
  return visible.join("");
}

function timestamp(value: string, format: "srt" | "vtt" | "ass"): number {
  const pattern =
    format === "ass"
      ? /^(\d{1,2}):([0-5]\d):([0-5]\d)\.(\d{2})$/u
      : format === "srt"
        ? /^(\d{2}):([0-5]\d):([0-5]\d),(\d{3})$/u
        : /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/u;
  const match = pattern.exec(value);
  if (match === null) throw new Error("Subtitle contains an invalid timestamp");
  return (
    (Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3])) *
      1000 +
    Number(match[4]) * (format === "ass" ? 10 : 1)
  );
}

/** Validates cue structure and extracts visible dialogue only, excluding style/header evidence. */
export function subtitleDialogue(
  text: string,
  format: "srt" | "vtt" | "ass" | "ssa",
): string {
  const cues =
    format === "ass" || format === "ssa"
      ? assCues(text)
      : blockCues(text, format);
  if (cues.length === 0 || cues.length > 100_000)
    throw new Error("Subtitle is missing bounded timed dialogue");
  let previousStart = -1;
  for (const cue of cues) {
    if (
      cue.start < previousStart ||
      cue.end <= cue.start ||
      cue.text.trim().length === 0
    )
      throw new Error("Subtitle contains invalid ordered dialogue");
    previousStart = cue.start;
  }
  return cues.map((cue) => cue.text).join("\n");
}

function blockCues(text: string, format: "srt" | "vtt"): Cue[] {
  const blocks = text.trim().split(/\n[\t ]*\n/u);
  if (format === "vtt") {
    const header = blocks.shift();
    if (
      header === undefined ||
      !/^WEBVTT(?:[\t \n]|$)/u.test(header) ||
      header.includes("-->")
    )
      throw new Error("Subtitle has an invalid WebVTT header");
  }
  const cues: Cue[] = [];
  for (const block of blocks) {
    if (
      format === "vtt" &&
      /^(?:NOTE(?:[\t \n]|$)|STYLE\n|REGION\n)/u.test(block)
    )
      continue;
    cues.push(blockCue(block, format));
  }
  return cues;
}

function blockCue(block: string, format: "srt" | "vtt"): Cue {
  const lines = block.split("\n");
  if (format === "srt") {
    if (!/^\d+$/u.test(lines.shift() ?? ""))
      throw new Error("Subtitle has an invalid cue identifier");
  } else if (lines[0]?.includes("-->") !== true) lines.shift();
  const timing = lines.shift() ?? "";
  const match = /^(\S+)[\t ]+-->[\t ]+(\S+)(?:[\t ]+(\S.*))?$/u.exec(timing);
  if (
    match?.[1] === undefined ||
    match[2] === undefined ||
    (format === "srt" && match[3] !== undefined)
  )
    throw new Error("Subtitle has malformed cue timing");
  if (
    format === "vtt" &&
    match[3] !== undefined &&
    !/^(?:(?:vertical|line|position|size|align):\S+\s*)+$/u.test(match[3])
  )
    throw new Error("Subtitle has malformed cue settings");
  const body = lines.join("\n");
  if (body.includes("-->"))
    throw new Error("Subtitle has malformed cue boundaries");
  return {
    start: timestamp(match[1], format),
    end: timestamp(match[2], format),
    text: stripDelimited(body, "<", ">"),
  };
}

function assCues(text: string): Cue[] {
  let events = false;
  let fields: string[] | undefined;
  const cues: Cue[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("[")) {
      events = line.toLowerCase() === "[events]";
      continue;
    }
    if (!events || line === "" || line.startsWith(";")) continue;
    if (line.startsWith("Format:")) {
      fields = line
        .slice(7)
        .split(",")
        .map((field) => field.trim().toLowerCase());
      if (
        new Set(fields).size !== fields.length ||
        fields.at(-1) !== "text" ||
        !fields.includes("start") ||
        !fields.includes("end")
      )
        throw new Error("Subtitle has an invalid Events format");
      continue;
    }
    if (line.startsWith("Comment:")) continue;
    if (fields === undefined || !line.startsWith("Dialogue:"))
      throw new Error("Subtitle has malformed Events dialogue");
    cues.push(assCue(line, fields));
  }
  return cues;
}

function assCue(line: string, fields: string[]): Cue {
  const values = line.slice(9).trimStart().split(",");
  if (values.length < fields.length)
    throw new Error("Subtitle has incomplete Events dialogue");
  const start = values[fields.indexOf("start")];
  const end = values[fields.indexOf("end")];
  if (start === undefined || end === undefined)
    throw new Error("Subtitle is missing Events timing");
  const body = values.slice(fields.length - 1).join(",");
  if (/\\p[1-9]/u.test(body))
    throw new Error("Subtitle drawing dialogue needs review");
  const visible = stripDelimited(body, "{", "}").replaceAll(/\\[Nnh]/gu, " ");
  return {
    start: timestamp(start.trim(), "ass"),
    end: timestamp(end.trim(), "ass"),
    text: visible,
  };
}
