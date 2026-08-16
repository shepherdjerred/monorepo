import React from "react";
import { CircleHelp } from "lucide-react";
import { Button } from "#components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#components/ui/dialog";

const OPERATORS: { operator: string; example: string; description: string }[] =
  [
    {
      operator: "none",
      example: "Tryndamere",
      description: "Results that fuzzy match 'Tryndamere'",
    },
    {
      operator: "=",
      example: "=Jax Tips",
      description: "Results that exactly match 'Jax Tips'",
    },
    {
      operator: "'",
      example: "'Jungle",
      description: "Results that include 'Jungle'",
    },
    {
      operator: "!",
      example: "!Evelyn",
      description: "Results that do not include 'Evelyn'",
    },
    {
      operator: "^",
      example: "^How to",
      description: "Results that start with 'How to'",
    },
    {
      operator: "!^",
      example: "!^Season 10",
      description: "Results that do not start with 'Season 10'",
    },
    {
      operator: "$",
      example: "Item Guide$",
      description: "Results that end with 'Item Guide'",
    },
    {
      operator: "!$",
      example: "!Pro Strategy$",
      description: "Results that do not end with 'Pro Strategy'",
    },
  ];

export function TipsDialog(): React.ReactElement {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            variant="secondary"
            size="icon"
            className="fixed right-5 bottom-3 z-40 rounded-full shadow-lg"
            title="Search tips"
          >
            <CircleHelp />
          </Button>
        }
      />
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Search Tips</DialogTitle>
          <DialogDescription>
            Search is fuzzy: exact matches rank first, near-misses still show,
            and typos are okay. Advanced operators:
          </DialogDescription>
        </DialogHeader>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1.5 pr-2">Operator</th>
              <th className="py-1.5 pr-2">Example</th>
              <th className="py-1.5">Description</th>
            </tr>
          </thead>
          <tbody>
            {OPERATORS.map((row) => (
              <tr key={row.example} className="border-b last:border-0">
                <td className="py-1.5 pr-2 font-mono">{row.operator}</td>
                <td className="py-1.5 pr-2 font-mono">{row.example}</td>
                <td className="py-1.5">{row.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-sm text-muted-foreground">
          Whitespace acts as AND; a pipe (|) acts as OR. Example:
          &ldquo;Tryndamere Strategy&rdquo; matches results containing both
          words, while &ldquo;Item|Guide&rdquo; matches results containing
          either.
        </p>
      </DialogContent>
    </Dialog>
  );
}
