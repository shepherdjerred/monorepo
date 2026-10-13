import path from "node:path";
import { createTwoslasher } from "twoslash";
import type { NodeHover, TwoslashReturn } from "twoslash";
import { codeToTokens } from "shiki";
import type { ThemedToken } from "shiki";
import ts from "typescript";
import { lessonRoot } from "#lib/article.ts";
import type { Wave, CodeStep } from "#lib/article.ts";
import { matchLines } from "#lib/lines.ts";
import type { CodeState, Token, WaveData } from "#lib/lines.ts";

const twoslash = createTwoslasher({
  compilerOptions: {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.React,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
    types: [],
  },
});
const jsx = await Bun.file(path.resolve(lessonRoot, "jsx.d.ts")).text();

export function checkStep(step: CodeStep): TwoslashReturn {
  return twoslash(
    `${step.support}\n${jsx}\n// ---cut---\n${step.visible}`,
    step.lang,
  );
}

function syntaxTokens(input: ThemedToken[]): Token[] {
  let offset = 0;
  return input.map((token) => {
    const start = offset;
    offset += token.content.length;
    const color = token.color ?? "#dfddd9";
    return { text: token.content, color, start };
  });
}

function collectHovers(
  data: WaveData,
  hovers: NodeHover[],
  infos: Map<string, number>,
): CodeState["hovers"] {
  const result: CodeState["hovers"] = {};
  for (const hover of hovers) {
    // DOM documentation repeats kilobytes per identifier. Preserve the actual type.
    let key = infos.get(hover.text);
    if (key === undefined) {
      key = data.hovers.length;
      infos.set(hover.text, key);
      data.hovers.push(hover.text);
    }
    (result[hover.line] ??= []).push({
      start: hover.character,
      end: hover.character + hover.length,
      info: key,
    });
  }
  return result;
}

function semanticInfo(
  step: CodeStep,
  sources: Map<string, TwoslashReturn>,
): TwoslashReturn {
  const cached = sources.get(step.source);
  if (cached !== undefined) return cached;
  let result: TwoslashReturn;
  try {
    result = checkStep(step);
  } catch (error) {
    throw new Error(`Typecheck failed in ${step.file ?? "inline example"}`, {
      cause: error,
    });
  }
  if (result.code.trimEnd() !== step.visible)
    throw new Error("Twoslash changed displayed source");
  sources.set(step.source, result);
  return result;
}

export async function renderWave(wave: Wave): Promise<WaveData> {
  const data: WaveData = { lines: [], states: [], hovers: [] };
  const infos = new Map<string, number>(),
    sources = new Map<string, TwoslashReturn>();
  let previous: string[] = [],
    previousIds: number[] = [];
  for (const step of wave.steps) {
    if (step.kind === "image") {
      data.states.push({ kind: "image", src: step.src, alt: step.alt });
      continue;
    }
    const semantic = semanticInfo(step, sources);
    const hovers = collectHovers(data, semantic.hovers, infos);
    const current = step.visible.split("\n"),
      matches = matchLines(previous, current);
    const highlighted = await codeToTokens(step.visible, {
      lang: step.lang,
      theme: "one-dark-pro",
    });
    const changed = current.flatMap((_, index) =>
      matches.has(index) ? [] : [{ line: index + 1 }],
    );
    const state: CodeState = {
      kind: "code",
      lines: [],
      focus: step.focus.length > 0 ? step.focus : changed,
      hovers: {},
    };
    for (const [index, text] of current.entries()) {
      const match = matches.get(index);
      let id = match === undefined ? undefined : previousIds[match];
      if (id === undefined) {
        id = data.lines.length;
        data.lines.push({
          id,
          text,
          tokens: syntaxTokens(highlighted.tokens[index] ?? []),
        });
      }
      state.lines.push(id);
      state.hovers[id] = hovers[index] ?? [];
    }
    data.states.push(state);
    previous = current;
    previousIds = state.lines;
  }
  return data;
}
