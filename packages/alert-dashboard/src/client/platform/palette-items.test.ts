import { GaugeIcon } from "lucide-react";
import { describe, expect, it } from "vitest";

import { resolveModules, type ClientModule } from "./module.ts";
import { paletteSections, searchableModules } from "./palette-items.ts";

function Page(): null {
  return null;
}

function runNothing(): void {
  // A command with no effect.
}

const notes: ClientModule = {
  id: "notes",
  title: "Notes",
  icon: GaugeIcon,
  basePath: "/notes",
  routes: [
    { path: "", page: Page },
    { path: "archive", page: Page },
  ],
  nav: [
    { label: "Notes", icon: GaugeIcon, path: "" },
    { label: "Archive", icon: GaugeIcon, path: "archive" },
  ],
  commands: [
    {
      id: "new",
      label: "New note",
      keywords: ["create"],
      run: runNothing,
    },
  ],
  search: () => Promise.resolve([]),
};
const journal: ClientModule = {
  id: "journal",
  title: "Journal",
  icon: GaugeIcon,
  basePath: "/journal",
  routes: [{ path: "", page: Page }],
  nav: [{ label: "Journal", icon: GaugeIcon, path: "" }],
};
const registry = resolveModules([notes, journal]);

function labels(
  query: string,
  searched: Parameters<typeof paletteSections>[2],
) {
  return paletteSections(registry, query, searched).map((section) => ({
    heading: section.heading,
    labels: section.items.map((item) => item.label),
  }));
}

describe("palette sections", () => {
  it("lists every module's pages and commands for an empty query", () => {
    expect(labels("", [])).toEqual([
      {
        heading: "Pages",
        labels: ["Go to Notes", "Go to Archive", "Go to Journal"],
      },
      { heading: "Commands", labels: ["New note"] },
    ]);
  });

  it("matches pages by label and commands by label or keyword", () => {
    expect(labels("ARCH", [])).toEqual([
      { heading: "Pages", labels: ["Go to Archive"] },
    ]);
    expect(labels("create", [])).toEqual([
      { heading: "Commands", labels: ["New note"] },
    ]);
  });

  it("puts search results first, grouped under their own headings", () => {
    const searched = [
      {
        moduleId: "notes",
        results: [
          { id: "1", group: "Notes", label: "Groceries", to: "/notes/1" },
          { id: "2", group: "Tags", label: "home", to: "/notes?tag=home" },
          { id: "3", group: "Notes", label: "Garden", to: "/notes/3" },
        ],
      },
    ];

    expect(labels("g", searched).map((section) => section.heading)).toEqual([
      "Notes",
      "Tags",
      "Pages",
    ]);
    expect(labels("g", searched)[0]?.labels).toEqual(["Groceries", "Garden"]);
  });

  it("gives every item a palette-wide unique id", () => {
    const ids = paletteSections(registry, "", [
      {
        moduleId: "notes",
        results: [{ id: "1", group: "Notes", label: "One", to: "/notes/1" }],
      },
      {
        moduleId: "journal",
        results: [{ id: "1", group: "Notes", label: "Uno", to: "/journal/1" }],
      },
    ]).flatMap((section) => section.items.map((item) => item.id));

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("navigates to a page or a search result when run", async () => {
    const visited: string[] = [];
    const context = {
      navigate: (to: string) => {
        visited.push(to);
      },
    };
    const sections = paletteSections(registry, "garden", [
      {
        moduleId: "notes",
        results: [{ id: "3", group: "Notes", label: "Garden", to: "/notes/3" }],
      },
    ]);
    await sections[0]?.items[0]?.run(context);
    await paletteSections(registry, "archive", [])[0]?.items[0]?.run(context);

    expect(visited).toEqual(["/notes/3", "/notes/archive"]);
  });

  it("asks only the modules that can search", () => {
    expect(searchableModules(registry).map((module) => module.id)).toEqual([
      "notes",
    ]);
  });
});
