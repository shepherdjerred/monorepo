import { expect, test } from "vitest";
import { PublicationAuthorityReadBudget } from "./read-budget.ts";

test("one whole-closure allowance counts repeated and unmatched authority reads", () => {
  const budget = new PublicationAuthorityReadBudget();
  const lookup = (returned: number) => budget.consume(returned);
  lookup(25);
  lookup(25);
  lookup(49);
  expect(budget.take).toBe(2);
  lookup(1);
  expect(budget.take).toBe(1);
  expect(() => lookup(1)).toThrow("100 total queried records");
});

test("a bounded list fetch includes the overflow sentinel and never silently truncates", () => {
  const budget = new PublicationAuthorityReadBudget();
  expect(budget.take).toBe(101);
  expect(() => budget.consume(101)).toThrow("100 total queried records");
  const separateInvocation = new PublicationAuthorityReadBudget();
  expect(() => separateInvocation.consume(100)).not.toThrow();
});
