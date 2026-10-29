import { spawn } from "node:child_process";
import { expect, test } from "vitest";
import { subtitleDialogue } from "./subtitle-dialogue.ts";
import { validateSubtitle } from "./subtitle-validation.ts";

type Format = "srt" | "vtt" | "ass" | "ssa";
function subtitle(body: string, format: Format) {
  if (format === "srt") return `1\n00:00:00,000 --> 00:00:01,000\n${body}`;
  return format === "vtt"
    ? `WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n${body}`
    : `[Events]\nFormat: Start, End, Text\nDialogue: 0:00:00.00,0:00:01.00,${body}`;
}

test.each(["srt", "vtt"] as const)(
  "%s removes exactly complete markup spans and preserves unmatched tails",
  (format) => {
    for (const [body, expected] of [
      ["Plain dialogue", "Plain dialogue"],
      ["<i>Hello</i><b> world</b>", "Hello world"],
      ["Before<a<b>inside>after", "Beforeinside>after"],
      ["Before<><i></i>after", "Beforeafter"],
      ["Before>after<unmatched<tail", "Before>after<unmatched<tail"],
      ["First\n<i\nclass=subtitle>second</i>\nthird", "First\nsecond\nthird"],
      ["Unicode 😀<i>世界</i>𐐀", "Unicode 😀世界𐐀"],
    ] as const) {
      expect(subtitleDialogue(subtitle(body, format), format)).toBe(expected);
    }
  },
);

test.each(["ass", "ssa"] as const)(
  "%s removes exactly complete override spans and retains escape handling",
  (format) => {
    for (const [body, expected] of [
      ["Plain dialogue", "Plain dialogue"],
      [String.raw`{\i1}Hello{\i0}{\b1} world{\b0}`, "Hello world"],
      ["Before{a{b}inside}after", "Beforeinside}after"],
      [String.raw`Before{}{\i1}{\i0}after`, "Beforeafter"],
      ["Before}after{unmatched{tail", "Before}after{unmatched{tail"],
      [
        String.raw`First\N{\i1}second{\i0}\nthird\hword`,
        "First second third word",
      ],
      [String.raw`Unicode 😀{\i1}世界{\i0}𐐀`, "Unicode 😀世界𐐀"],
    ] as const) {
      expect(subtitleDialogue(subtitle(body, format), format)).toBe(expected);
    }
    expect(() =>
      subtitleDialogue(subtitle(String.raw`{\p1}Drawing`, format), format),
    ).toThrow("drawing");
  },
);

test.each(["srt", "vtt", "ass", "ssa"] as const)(
  "%s still rejects empty visible dialogue and counts only visible script evidence",
  (format) => {
    const hidden =
      format === "srt" || format === "vtt"
        ? "<这是我们的国家，欢迎来到这里>"
        : "{这是我们的国家，欢迎来到这里}";
    expect(() => subtitleDialogue(subtitle(hidden, format), format)).toThrow(
      "ordered dialogue",
    );
    expect(() =>
      validateSubtitle({
        bytes: new TextEncoder().encode(subtitle(`${hidden}Hello`, format)),
        filename: `fixture.${format}`,
        requireSimplified: true,
        provenanceText: "",
      }),
    ).toThrow("Simplified");
  },
);

test("long unmatched cues finish through the actual parser inside an independently time-bounded child", async () => {
  const moduleUrl = new URL("subtitle-validation.ts", import.meta.url).href;
  const source = String.raw`import {validateSubtitle} from ${JSON.stringify(moduleUrl)};
    for (const format of ["srt","vtt","ass","ssa"]) {
      const body=(format==="srt"||format==="vtt"?"<":"{").repeat(1024*1024);
      const content=format==="srt"?"1\n00:00:00,000 --> 00:00:01,000\n"+body:
        format==="vtt"?"WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n"+body:
        "[Events]\nFormat: Start, End, Text\nDialogue: 0:00:00.00,0:00:01.00,"+body;
      const result=validateSubtitle({bytes:new TextEncoder().encode(content),filename:"fixture."+format,requireSimplified:false,provenanceText:""});
      if(result.format!==format||result.text!==content) throw new Error("Long cue result changed");
    }
    process.stdout.write("parsed:4");`;
  expect(await boundedParserChild(source)).toBe("parsed:4");
});

function boundedParserChild(source: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", source],
      {
        env: {},
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    let output = "",
      failure: Error | undefined;
    const deadline = setTimeout(() => {
      failure = new Error(
        "Actual subtitle parser exceeded its bounded child deadline",
      );
      child.kill("SIGKILL");
    }, 2000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: unknown) => {
      if (typeof chunk !== "string" || output.length + chunk.length > 128) {
        failure = new Error("Unexpected subtitle parser child output");
        child.kill("SIGKILL");
      } else output += chunk;
    });
    child.once("error", (error) => {
      failure = error;
    });
    child.once("close", (code) => {
      clearTimeout(deadline);
      if (failure === undefined && code === 0) resolve(output);
      else reject(failure ?? new Error("Subtitle parser child failed"));
    });
  });
}
