import { JSDOM } from "jsdom";
import { expect, test, vi } from "vitest";
import { customProperty } from "./custom-property.tsx";

vi.mock("./simple-blog.tsx", () => ({
  simpleBlog: ({ description }: { description?: string }) => description,
}));

function descriptionFor(body: string): unknown {
  const { document } = new JSDOM(`<body>${body}</body>`).window;
  return customProperty({
    pathname: "/",
    dir: new URL("file:///dist/"),
    document,
    title: "Title",
    url: "https://example.com/",
    type: "website",
    image: "https://example.com/og.png",
  });
}

test.each([
  { name: "short body", body: "hello", expected: "hello" },
  { name: "exactly 50", body: "a".repeat(50), expected: "a".repeat(50) },
  {
    name: "ASCII over 50",
    body: "a".repeat(60),
    expected: `${"a".repeat(50)}...`,
  },
  {
    name: "emoji straddling UTF-16 unit 50",
    body: `${"a".repeat(49)}😀${"b".repeat(5)}`,
    expected: `${"a".repeat(49)}😀...`,
  },
  {
    name: "ZWJ family emoji",
    body: "👨‍👩‍👧‍👦".repeat(60),
    expected: `${"👨‍👩‍👧‍👦".repeat(50)}...`,
  },
])("truncates the body by grapheme: $name", ({ body, expected }) => {
  const description = descriptionFor(body);
  expect(description).toBe(expected);
  expect(typeof description === "string" && description.isWellFormed()).toBe(
    true,
  );
});
