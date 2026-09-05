import { describe, expect, test } from "vitest";
import { cookParser, type CookStream } from "./cook-tokenizer.ts";

function tokenNames(lines: string[]): string[][] {
  const state = cookParser.startState();

  return lines.map((line) => {
    let position = 0;
    let lastToken: string | undefined;
    const names: string[] = [];
    const stream: CookStream = {
      sol: () => position === 0,
      match: (pattern) => {
        const match = pattern.exec(line.slice(position));
        if (match?.index !== 0) return null;
        position += match[0].length;
        return match;
      },
      next: () => {
        const character = line[position];
        if (character === undefined) return null;
        position += 1;
        return character;
      },
    };

    while (position < line.length) {
      const token = cookParser.token(stream, state);
      if (token !== null && lastToken !== token) names.push(token);
      lastToken = token ?? lastToken;
    }

    return names;
  });
}

describe("cookParser", () => {
  test("highlights section headers at the start of a line", () => {
    expect(tokenNames(["= Ingredients"])).toEqual([["heading"]]);
  });

  test("highlights Cooklang tokens", () => {
    expect(
      tokenNames(["Add @flour{200%g} to the #bowl{} for ~{5%min}."]),
    ).toEqual([["variableName", "keyword", "number"]]);
  });

  test("highlights frontmatter delimiters, keys, and values", () => {
    expect(tokenNames(["---", "title: Pancakes", "---"])).toEqual([
      ["meta"],
      ["atom", "string"],
      ["meta"],
    ]);
  });

  test("highlights frontmatter URLs and block values", () => {
    expect(
      tokenNames([
        "---",
        "source.url: https://example.com/recipe",
        "nutrition: |",
        "  Calories: 100",
        "---",
      ]),
    ).toEqual([
      ["meta"],
      ["atom", "url"],
      ["atom", "operator"],
      ["docString"],
      ["meta"],
    ]);
  });

  test("highlights comments", () => {
    expect(tokenNames(["-- recipe note"])).toEqual([["comment"]]);
  });
});
