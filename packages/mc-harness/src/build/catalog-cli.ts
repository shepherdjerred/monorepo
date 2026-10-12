/**
 * `toolkit mc build library …` and `toolkit mc build component …`: browsing
 * curated programs and shared components, copying a program into a build
 * and proposing a build-local helper as a component.
 */
import {
  componentList,
  componentPropose,
  componentRender,
  componentShow,
  type ComponentRow,
} from "./component.ts";
import {
  libraryList,
  libraryShow,
  libraryUse,
  type LibraryRow,
} from "./library.ts";

export type CatalogValues = {
  json: boolean;
  tag?: string[] | undefined;
  text?: string | undefined;
  force: boolean;
  name?: string | undefined;
  description?: string | undefined;
};

type Print = (json: boolean, value: unknown, human: string) => void;
type Required = (value: string | undefined, name: string) => string;

export type CatalogIo = { print: Print; required: Required; usage: string };

function libraryTable(rows: LibraryRow[]): string {
  return rows
    .map(
      (r) =>
        `${r.slug.padEnd(18)} ${r.style.padEnd(9)} ${`${r.footprint.w.toString()}×${r.footprint.d.toString()}×${r.footprint.h.toString()}`.padEnd(9)} ${r.title} — ${r.tags.join(", ")}`,
    )
    .join("\n");
}

function componentTable(rows: ComponentRow[]): string {
  return rows
    .map(
      (r) =>
        `${r.name.padEnd(12)} ${r.description}\n${" ".repeat(13)}import from "${r.specifier}"`,
    )
    .join("\n");
}

function query(values: CatalogValues): { tags: string[]; text?: string } {
  return {
    tags: (values.tag ?? []).flatMap((tag) => tag.split(",")),
    ...(values.text === undefined ? {} : { text: values.text }),
  };
}

export async function libraryCommand(
  io: CatalogIo,
  sub: string,
  values: CatalogValues,
  rest: string[],
): Promise<number> {
  if (sub === "ls" || sub === "search") {
    const rows = await libraryList(query(values));
    io.print(
      values.json,
      rows,
      rows.length === 0 ? "no matching library entries" : libraryTable(rows),
    );
    return 0;
  }
  if (sub === "show") {
    const entry = await libraryShow(io.required(rest[0], "<slug>"));
    io.print(
      values.json,
      entry,
      `${libraryTable([entry])}\n\n${entry.notes}\n\nprogram: ${entry.program}\n\n${entry.source}`,
    );
    return 0;
  }
  if (sub === "use") {
    const result = await libraryUse(
      io.required(rest[0], "<slug>"),
      io.required(rest[1], "<dir>"),
      {
        force: values.force,
      },
    );
    io.print(
      values.json,
      result,
      `copied library/${result.slug} → ${result.program}; adapt it, then toolkit mc build compile`,
    );
    return 0;
  }
  throw new Error(`unknown library command "${sub}"\n${io.usage}`);
}

export async function componentCommand(
  io: CatalogIo,
  sub: string,
  values: CatalogValues,
  rest: string[],
): Promise<number> {
  if (sub === "ls" || sub === "search") {
    const rows = await componentList(query(values));
    io.print(
      values.json,
      rows,
      rows.length === 0 ? "no matching components" : componentTable(rows),
    );
    return 0;
  }
  if (sub === "show") {
    const entry = await componentShow(io.required(rest[0], "<name>"));
    io.print(
      values.json,
      entry,
      `${componentTable([entry])}\n\n${entry.exports.map((line) => `  ${line}`).join("\n")}\n\ndemo: ${entry.demo}\nrender: ${entry.render}\n\n${entry.source}`,
    );
    return 0;
  }
  if (sub === "render") {
    const out = await componentRender(io.required(rest[0], "<name>"));
    io.print(values.json, { render: out }, `render: ${out}`);
    return 0;
  }
  if (sub === "propose") {
    const result = await componentPropose({
      dir: io.required(rest[0], "<dir>"),
      file: io.required(rest[1], "<file>"),
      name: io.required(values.name, "--name"),
      description: io.required(values.description, "--description"),
      tags: query(values).tags,
    });
    io.print(
      values.json,
      result,
      [
        `proposed component ${result.name} → ${result.dir}`,
        `  import from "${result.specifier}"`,
        result.render === null
          ? `  demo skeleton: ${result.demo}`
          : `  render: ${result.render}`,
        "",
        "Before opening a PR:",
        ...result.checklist.map((item) => `  [ ] ${item}`),
      ].join("\n"),
    );
    return 0;
  }
  throw new Error(`unknown component command "${sub}"\n${io.usage}`);
}
