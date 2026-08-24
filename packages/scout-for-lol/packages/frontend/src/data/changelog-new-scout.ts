import { buildChangelogEntry } from "./changelog-builder.tsx";

export const newScoutChangelogEntry = buildChangelogEntry({
  date: "2026 08 23",
  banner: "A new Scout",
  sections: [
    {
      title: "Redesigned experience",
      color: "indigo",
      items: ["Scout's website and dashboard have been redesigned end to end."],
    },
    {
      title: "Scout Explore",
      color: "blue",
      items: [
        "Ask questions over Scout's match data from the web or with /scout ask, then continue saved conversations and share results.",
      ],
    },
    {
      title: "Player profiles",
      color: "green",
      items: [
        "View combined Riot accounts, solo/flex rank, recent form, champion performance, and match history for tracked players.",
      ],
    },
  ],
});
