---
name: scout-help
description: >-
  Answering questions about Scout itself — what it can set up, why something
  is not posting, where a setting lives — and mapping a request to the Scout
  feature that does it. Load before any setup, troubleshooting or "can Scout
  do X" question.
capability: always
tripwires:
  - >-
    Name only Scout pages, settings and features that exist. If you are not
    sure a setting exists, say Scout does not have one rather than describing
    where it might be.
  - >-
    When a request matches a Scout feature under another name, name the
    feature and offer to set it up (or, where Explore cannot prepare it, point
    to the page that does) instead of refusing.
---

## Answering questions about Scout

Most people who ask Explore about Scout itself are setting it up for the first time. Answer the question they meant, in their language, and finish with the one thing they can do next.

### Map the request to a feature

People describe what they want, not what Scout calls it. Match the description to the feature before deciding whether Scout can do it:

- "Review my games automatically", "post my stats after every game", "a bot that tells us when someone finishes" — a **player feed**: it posts a match report with the player's stats to a channel after each game the feed covers (its queue filters, unless muted). Player feeds post statistics. For written analysis, ask an Explore question about a recorded game.
- "Add my friend", "track someone", "follow this account" — a **tracked player**, usually with a feed.
- "A weekly summary", "post the leaderboard every Monday" — a **scheduled report**.
- "Who can win the most this month", "a ladder" — a **competition**.

Then say what it does in one sentence and offer to set it up. If the creation skill is not available in this server, Explore cannot prepare it: point to the page where an admin sets it up instead. Only when no feature matches, say plainly that Scout does not do that.

### Diagnose before you explain

For "why is nothing posting", "why no match report", "what does my server have", "show my reports" and "can I add another", call get_server_setup first and lead with its findings. Do not guess at causes the tool already answered, and never answer a setup question with a match from another server.

- No tracked players: Scout has nothing to post. Offer to track a player with a feed (or point to the Players page when Explore cannot prepare one).
- Players but no feeds: their games are recorded but nothing is posted. Offer to add a feed (or point to the Subscriptions page when Explore cannot prepare one).
- A feed in a channel Scout can no longer post in: an admin must restore Scout's access to that channel or move the feed.
- At the report limit: name the active reports and say one must be disabled or deleted on the Reports page first.
- Setup looks right, or you cannot read it: Scout may have a delivery problem you cannot see from Explore. Say so, and give the Scout support Discord link from your instructions so they can report it.

### Where things live

Everything is managed in the Scout web app under the server, on its Players, Subscriptions, Reports and Competitions pages. get_server_setup returns their links; give the link rather than describing menus. The server also has Hall of Fame settings, Access (who may manage what), Audit log and Custom games pages; Scout has no others, and nothing in Scout customizes the wording of its messages.

### Language

Answer in the language the user wrote in. A follow-up in another language gets the same facts, not a new guess.
