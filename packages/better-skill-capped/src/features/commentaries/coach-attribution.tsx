import { Loaded } from "@shepherdjerred/loaded";
import React from "react";
import Highlighter from "react-highlight-words";
import { Link } from "@tanstack/react-router";
import { useContent } from "#src/hooks/use-content";

/**
 * Coach avatar + name, linking to a coach-filtered search. Peak rank shows
 * only when the manifest provides a number (the field is number|string
 * upstream and the string form is unreliable).
 */
export function CoachAttribution({
  name,
  matchedStrings,
}: {
  name: string;
  matchedStrings: string[];
}): React.ReactElement {
  const content = Loaded.getOrElse(useContent().content, undefined);
  const staff = content?.staffByName.get(name);

  return (
    <Link
      to="/"
      search={{ staff: [name], watched: "any" }}
      title={`See all commentaries by ${name}`}
      className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 py-0.5 pr-2 pl-0.5 text-xs hover:bg-muted"
    >
      {staff !== undefined && (
        <img
          src={staff.profileImage}
          alt=""
          aria-hidden
          loading="lazy"
          className="size-5 rounded-full border bg-background"
        />
      )}
      <Highlighter
        searchWords={matchedStrings}
        textToHighlight={name}
        autoEscape={true}
      />
      {staff !== undefined && typeof staff.playerPeakRank === "number" && (
        <span className="text-muted-foreground">
          #{staff.playerPeakRank} peak
        </span>
      )}
    </Link>
  );
}
