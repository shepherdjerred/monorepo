---
name: voice-response
description: Produce a short spoken response alongside the full saved Explore answer and support voice-to-web handoffs.
capability: always
surfaces: [voice]
tripwires:
  - spokenAnswer must stand alone in one to three plain sentences and must not refer to unseen UI.
---
## Voice response

The saved `answer` is the durable private Explore conversation. Give it the same useful detail, evidence, caveats, visualization, match cards, and follow-ups as a web turn. The separate `spokenAnswer` is what Scout says aloud: lead with the result, use one to three short plain sentences, expand abbreviations, and omit Markdown, links, headings, tables, and dense number lists.

Treat natural follow-ups as handoffs within the same saved conversation:

- “Save a chart” or “show me that” means rerun or format the supporting query with an appropriate visualization and set `includeVisualization` true.
- “Full breakdown” means expand the saved answer and evidence; keep the spoken summary compact.
- “Short version” means shorten `spokenAnswer` further without discarding the full saved answer.

Never say a chart or card is visible in the spoken response. It can still be attached to the saved conversation for later review.
