---
title: Ask and follow up in Explore
description: Sign in as a Scout community member, ask a starter question over Scout's recorded match corpus, and refine the answer with a follow-up.
sidebar:
  order: 0
---

In this tutorial, you will ask Scout a question about the matches it has
recorded, read the evidence and caveats, and continue the same conversation
with a follow-up. You do not need to administer a Discord server.

You need a Discord account that belongs to a server where Scout is installed
and Explore is enabled.

## 1. Open Explore

Open [Scout Explore](/app/explore) and sign in with Discord. Scout returns you
to Explore after sign-in.

The first screen explains that Explore searches Scout's combined recorded
corpus. It does not search every League match or limit the question to one
Discord server.

## 2. Start with a suggested question

Choose a starter such as **Which champions have the highest win rate?** Choosing
a starter submits that question immediately. To change the wording first, type
your own question in the composer and then send it.

While Scout works, the conversation shows the query and analysis activity.
Leave the page open until the answer finishes.

## 3. Read the result as recorded evidence

Start with the answer, then check:

- the number of recorded games behind each result;
- any low-sample or coverage caveat;
- the stated queue and time window; and
- the reminder that Scout's corpus is not the full League ladder.

You now have an answer tied to the data Scout had recorded when the turn ran.

## 4. Ask a follow-up

Use one of Scout's suggested follow-ups, or ask your own. For example:

> Which champions lead in ranked solo only?

The follow-up stays in the same conversation, so Scout can refine the earlier
question instead of starting over. Compare the queue-specific answer with the
all-queue result.

## 5. Reopen the conversation

Return to Explore later and choose the conversation from your history. Your
questions, answers, caveats, and branches remain together.

If you choose to share a conversation, Scout creates a frozen view of the
currently shared branch. Later follow-ups do not silently change what the link
shows.

You have completed an Explore conversation: one question, one evidence-aware
answer, and one useful refinement.

## Optional: continue a Discord dare

In a Bryan Bucks server with Dare v2 enabled, `/bb dare` creates a separate
private Explore conversation and an unfunded draft. Open **Revise in Explore**
from Discord, then tell Scout what was wrong in ordinary language—for example,
“the CS and duration conditions must happen in the same game.”

To find the draft later, open Bryan Bucks, choose its server, and select the
**Dares** tab. **My Dares** contains your private draft; **Guild Dares** contains
the server's funded contracts. Open the draft there to inspect its evidence or
use the advanced editor, then return to Explore for another conversational
revision.

Before replacing the draft, inspect the card's explicit scope, targets,
participation relationship, queues, first-N or game cap, deadline, stake, plain
meaning, and canonical ScoutQL. Historical preview uses only matches and
timelines already present in Scout's lake; missing timeline coverage is shown as
unknown rather than as a failed condition. Save the revision only when the diff
matches the intended dare, then prepare and confirm funding. The confirmation
is single-use and expires after ten minutes.

## Set something up from the conversation

Where your server has this enabled, Explore can also prepare a scheduled report,
a tracked player, or a competition from the conversation you are already having,
instead of sending you to a form.

Ask for it in ordinary language—for example, “save this as a weekly report in
the #general channel.” Scout confirms the details it is missing, then shows a
confirmation card summarising exactly what it would create.

Nothing exists until you press **Confirm**. Scout re-checks your permissions in
that server at that moment, so a card prepared before your access changed still
cannot create anything you are no longer allowed to create. Like a Dare funding
confirmation, the card is single-use and expires after ten minutes; when it
expires, ask again to prepare a fresh one.

The card appears only for you, in your own conversation. Sharing or publishing
the conversation shows the question and answer without it, so nobody else is
offered a confirmation they cannot complete.

## Next steps

- [Find and interpret a player profile](/docs/how-to/find-player-profile/)
- [Explore limits and concurrency](/docs/reference/schedules-and-limits/)
- [Why Scout uses web-first workflows](/docs/explanation/web-first/)
