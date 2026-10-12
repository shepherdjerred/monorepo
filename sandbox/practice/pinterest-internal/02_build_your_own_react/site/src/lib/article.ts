import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMdx from "remark-mdx";
import type { Code, RootContent } from "mdast";
import { defined } from "#lib/invariant.ts";

export const lessonRoot = fileURLToPath(new URL("../../../", import.meta.url));
export type Focus = { line: number; columns?: [number, number] };
export type CodeStep = {
  kind: "code";
  source: string;
  visible: string;
  support: string;
  lang: "ts" | "tsx";
  file: string | null;
  focus: Focus[];
};
export type ImageStep = { kind: "image"; src: string; alt: string };
export type Step = { id: string; markdown: string } & (CodeStep | ImageStep);
export type Wave = { kind: "wave"; id: string; steps: Step[] };
export type Prose = { kind: "prose"; markdown: string };
export type Article = {
  title: string;
  blocks: (Wave | Prose)[];
  examples: CodeStep[];
};
type ReadSource = (file: string) => string;

function focusLine(
  line: number,
  text: string,
  start: string | undefined,
  end: string | undefined,
): Focus {
  if (start === undefined) return { line };
  const a = Number(start),
    b = Number(end);
  if (a < 1 || b < a || b > text.length)
    throw new Error("Focus columns outside line");
  return { line, columns: [a, b] };
}

/** Focus is authored against visible TypeScript: 1-based lines and columns. */
export function parseFocus(spec: string, visible: string): Focus[] {
  const lines = visible.split("\n"),
    result: Focus[] = [];
  const pattern = /(\d+)(?::(\d+))?(?:\[(\d+):(\d+)\])?(?:,|$)/gy;
  let offset = 0;
  while (offset < spec.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(spec);
    if (match === null) throw new Error(`Invalid focus: ${spec}`);
    const start = Number(match[1]),
      end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start || end > lines.length)
      throw new Error(`Focus outside snippet: ${spec}`);
    for (let line = start; line <= end; line++)
      result.push(
        focusLine(line, defined(lines[line - 1]), match[3], match[4]),
      );
    offset = pattern.lastIndex;
  }
  return result;
}

export function splitSource(source: string): {
  support: string;
  visible: string;
} {
  const parts = source.split("// @lesson-start\n");
  if (parts.length !== 2)
    throw new Error("A snapshot needs exactly one @lesson-start marker");
  return {
    support: defined(parts[0]).trim(),
    visible: defined(parts[1]).trimEnd(),
  };
}

const inlineContext = `/** @jsx React.createElement */
export {};
declare const React: {
  createElement(type: string, props?: object | null, ...children: unknown[]): JSX.Element
};
declare const ReactDOM: { render(element: object, container: HTMLElement | null): void };
declare const Didact: {
  createElement(type: string | ((props: {name?: string}) => JSX.Element), props: object | null, ...children: unknown[]): JSX.Element;
  render(element: JSX.Element, container: HTMLElement): void
};
declare const container: HTMLElement;
type Fiber = { child?: Fiber; sibling?: Fiber; parent?: Fiber };
declare let nextUnitOfWork: Fiber | null;
declare function performUnitOfWork(fiber: Fiber): Fiber | null;`;

function inlineStep(visible: string, lang: string): CodeStep {
  const support = inlineContext.replace(
    "declare const container: HTMLElement;",
    /\bconst container\b/.test(visible)
      ? ""
      : "declare const container: HTMLElement;",
  );
  return {
    kind: "code",
    visible,
    support,
    source: `${support}\n// @lesson-start\n${visible}`,
    file: null,
    lang: lang === "ts" || lang === "js" ? "ts" : "tsx",
    focus: [],
  };
}

function collectExamples(nodes: RootContent[]): CodeStep[] {
  return nodes.flatMap((node) => {
    if (node.type === "mdxJsxFlowElement")
      return collectExamples(node.children);
    return node.type !== "code" ||
      node.lang === "json" ||
      node.meta?.includes("file=") === true
      ? []
      : [inlineStep(node.value, node.lang ?? "ts")];
  });
}

function textOf(body: string, node: RootContent): string {
  if (node.type === "mdxJsxFlowElement" && node.name === "div")
    return node.children.map((child) => textOf(body, child)).join("\n\n");
  const position = defined(node.position);
  return body.slice(
    defined(position.start.offset),
    defined(position.end.offset),
  );
}

function codeStep(node: Code, read: ReadSource): CodeStep {
  const meta = node.meta ?? "";
  const file = /(?:^| )file=(\.\/[\w.]+\.tsx?)(?: |$)/.exec(meta)?.[1] ?? null;
  if (file === null && meta.includes("file="))
    throw new Error(`Invalid typed source reference: ${meta}`);
  const step =
    file === null
      ? inlineStep(node.value, node.lang ?? "ts")
      : {
          kind: "code" as const,
          source: read(file),
          ...splitSource(read(file)),
          file,
          lang: file.endsWith(".tsx") ? ("tsx" as const) : ("ts" as const),
          focus: [],
        };
  const spec =
    /(?:^| )focus=(\S+)/.exec(meta)?.[1] ?? meta.replace(/file=\S+/, "").trim();
  return { ...step, focus: parseFocus(spec, step.visible) };
}

function imageStep(node: RootContent): ImageStep | null {
  if (node.type !== "paragraph" || node.children.length !== 1) return null;
  const image = node.children[0];
  return image?.type === "image"
    ? {
        kind: "image",
        src: image.url.replace(/^\.\//, ""),
        alt: image.alt ?? "",
      }
    : null;
}

function parseWave(
  nodes: RootContent[],
  id: string,
  kind: "CodeWave" | "ImageWave",
  options: { body: string; read: ReadSource },
): Wave {
  const { body, read } = options;
  const wave: Wave = { kind: "wave", id, steps: [] };
  for (const node of nodes) {
    const image = kind === "ImageWave" ? imageStep(node) : null;
    const code =
      kind === "CodeWave" && node.type === "code" ? codeStep(node, read) : null;
    const content = image ?? code;
    if (content === null) {
      defined(wave.steps.at(-1)).markdown += `${textOf(body, node)}\n\n`;
    } else {
      wave.steps.push({
        ...content,
        id: `${id}-${String(wave.steps.length)}`,
        markdown: "",
      });
    }
  }
  if (wave.steps.length === 0) throw new Error(`Empty wave: ${id}`);
  return wave;
}

export function parseArticle(mdx: string, read: ReadSource): Article {
  const title = /^title: (.+)$/m.exec(mdx)?.[1] ?? "Build your own React";
  const body = mdx.replace(/^---\n[\s\S]*?\n---\n/, "");
  const tree = unified().use(remarkParse).use(remarkMdx).parse(body);
  const blocks: Article["blocks"] = [];
  let waveIndex = 0;
  for (const node of tree.children) {
    if (node.type === "mdxjsEsm") continue;
    if (
      node.type === "mdxJsxFlowElement" &&
      (node.name === "CodeWave" || node.name === "ImageWave")
    ) {
      blocks.push(
        parseWave(node.children, `wave-${String(waveIndex++)}`, node.name, {
          body,
          read,
        }),
      );
    } else blocks.push({ kind: "prose", markdown: textOf(body, node) });
  }
  return { title, blocks, examples: collectExamples(tree.children) };
}

export async function loadArticleSource(): Promise<Article> {
  const names = await readdir(lessonRoot);
  const files = names.filter((name) => /^\d.*\.tsx?$/.test(name));
  const sources = new Map(
    await Promise.all(
      files.map(
        async (name) =>
          [
            name,
            await Bun.file(path.resolve(lessonRoot, name)).text(),
          ] as const,
      ),
    ),
  );
  return parseArticle(
    await Bun.file(path.resolve(lessonRoot, "article.mdx")).text(),
    (file) => defined(sources.get(file.replace(/^\.\//, ""))),
  );
}
