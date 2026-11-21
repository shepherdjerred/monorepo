import { expect, test } from "vitest";
import {
  INTEREST_ACTION_NAMES,
  LIBRARY_KEEPING_NAMES,
  LIBRARY_VIEW_NAMES,
} from "#shared/household/names.ts";
import { interestCheckText, retentionWarningText } from "./copy.ts";

const link = "https://media.example.test/requests?interest=abc";

/** Names of pages and controls the client had before the Library's views. */
const RETIRED = [
  "My requests",
  "Leaving Soon",
  "Keep indefinitely",
  "Finished or Drop",
  "quarantine",
  "permanent Keep",
];

test("a still-watching check names the buttons and views that are on screen", () => {
  const text = interestCheckText({ title: "Severance", link });
  expect(text).toBe(
    [
      "You have unwatched content available for Severance.",
      "Choose Keep watching within 7 days to continue following it, or I have finished it or Stop following if you are done. Watching also renews your interest.",
      "If you do not reply, your temporary interest will expire. The title stays while anyone else still wants it. Otherwise it spends 7 days under Leaving soon in the Library, and its files can be restored for 7 days after that.",
      "Opening this link does not change your request. It shows the request under Mine in the Library.",
      link,
    ].join("\n\n"),
  );
  for (const name of [
    INTEREST_ACTION_NAMES.continue,
    INTEREST_ACTION_NAMES.finished,
    INTEREST_ACTION_NAMES.drop,
    LIBRARY_VIEW_NAMES.leaving,
    LIBRARY_VIEW_NAMES.mine,
  ]) {
    expect(text).toContain(name);
  }
  for (const name of RETIRED) expect(text).not.toContain(name);
  // The link is the last line, alone, where a mail client makes it a link.
  expect(text.split("\n").at(-1)).toBe(link);
});

test("a leaving warning tells a member how to follow the title again", () => {
  const text = retentionWarningText({
    title: "Arrival (Director's cut)",
    owner: false,
    link: "https://media.example.test/requests",
  });
  expect(text).toBe(
    "Arrival (Director's cut) is not kept for good and nobody follows it any more. It can leave the library after at least seven days, and its files can be restored for another seven days after that. Choose Keep watching under Mine in the Library to follow it again. Opening this link changes nothing.\nhttps://media.example.test/requests",
  );
  expect(text).not.toContain(LIBRARY_KEEPING_NAMES.keep);
  for (const name of RETIRED) expect(text).not.toContain(name);
});

test("the owner is also told where the library's own keeping is changed", () => {
  const text = retentionWarningText({
    title: "Arrival",
    owner: true,
    link: "https://media.example.test/library",
  });
  expect(text).toContain(
    "Choose Keep watching under Mine in the Library to follow it again, or Keep for good in the Library's compact list to keep it whoever follows it.",
  );
  expect(text.split("\n").at(-1)).toBe("https://media.example.test/library");
  for (const name of RETIRED) expect(text).not.toContain(name);
});
