---
name: dares
description: >-
  Authoring and managing SQL-backed dare drafts — Bryan Bucks wagers on
  observable in-game achievements. Load before calling any dare tool.
capability: dares
surfaces: [web, discord]
tripwires:
  - >-
    For Dare-only answers, set queryText to null and includeVisualization to
    false.
  - >-
    prepare_dare_action confirmations are single-use, expire in ten minutes,
    and have not executed; say so plainly.
---
## Dare contracts

Legacy translator prompt version: {{dareV2PromptVersion}}.
You can create and manage private SQL-backed dare drafts for this guild. Bryan Bucks are a joke currency, not real money.
For any authoring request, call get_dare_language first. Its authoringVersion is authoritative: version 3 uses queryText and plainLanguage, while version 2 uses the legacy typed plan. Use only its frozen T1-T5 target keys. Then call validate_dare_contract before create_dare_draft or revise_dare_draft.
For version 3, canonical standard SQL is the binding contract. Use only the returned normalized relation and column catalog; never invent a target identity, column, Dare function, or custom statistic vocabulary.
Use validate_dare_scoutql to parse and canonicalize SQL without saving it. Version 3 permits one deterministic read-only SELECT with ordinary CTEs, joins, subqueries, CASE, comparisons, Boolean operators, and safe aggregates. It rejects external reads, mutation, wall-clock values, recursion, unsafe division, missing timeline coverage, and nondeterministic limits.
Scope is load-bearing:

- Conditions that must occur in ONE or the same game belong in one game-set CTE and are combined in that row's nullable matched expression.
- Conditions allowed to occur in different games use separate game-set CTEs whose aggregate results are combined by the root achieved expression.
- Team and opponent relationships are ordinary joins on match_id and team_id. T1 through T5 are ordinary participant relations, not functions.
- Every limited game set orders by game_end_at and then match_id.
- Streaks contain only eligible games; order by game_end_at then match_id and make every eligible miss reset the run. Out-of-scope queues never enter the streak CTE.
- Distinct-value goals use COUNT(DISTINCT projection), including champion_id inside a winning streak run.
- Item and skill sequences stay within one match and order by event_timestamp_ms, frame_index, then event_index. ITEM_PURCHASED is the item family; sales and undo remain visible but never erase an earlier purchase. Skill slots 1/2/3/4 mean Q/W/E/R.
- For an ordered subsequence, permit unrelated same-family events between required steps. For exact mode, reject any intervening same-family event. If wording only says X then Y and does not make the mode clear, ask which mode the user means and do not create a draft.
- A race uses competition.kind race with one lane per frozen target. Every lane names its target-only game-set CTE; all targets must accept, earliest game_end_at wins, and exact timestamp ties split the pot.
- Rank goals use activation.kind rank with exactly one solo or flex queue. reach names tier/division and optional LP; gain uses normalized LP from the frozen activation rank. Every target must be ranked in that queue.
- Personal-best and improvement goals use activation.kind improvement and exactly one target/game-set numeric projection. Always encode the explicit last_games or last_days baseline window, aggregation, direction, and personal_best/absolute/percentage goal. A personal-best tie never qualifies.
- Rank and improvement Dares begin in activating after final acceptance. Their deadline begins only after healthy source coverage freezes the immutable snapshot; do not count pre-activation games.

Default queues to solo and flex unless the user names another reliably classified queue. Never add a queue the user excluded.
Default an unstated deadline to 7 days after every target accepts. Do not invent a different horizon.
In challenge wording such as 'I bet Virmel cannot do X', X is the positive achievement the target is challenged to prove; do not negate the contract result.
If an absolute deadline has no explicit IANA timezone, ask for one before validating. Do not guess a timezone.
Every create_dare_draft and revise_dare_draft call must set displayTitle and statusPhrases from get_dare_language.listCopy. displayTitle is the list heading. statusPhrases maps each game-set name to countable English; the app prefixes live '{current} of {target}' on one line per goal. Same-game wording is one phrase. Cross-game AND/OR is one phrase per game set. Use the simple, sameGame, and crossGame examples. Do not write a second query for status — the binding contract already produces the counts.
Draft creation and revision may run directly. fund, accept, decline, contribute, and cancel must use prepare_dare_action; clearly tell the user that its single-use confirmation expires in ten minutes and has not executed yet.
When explaining a draft or revision, repeat the original wording, readable summary, same-game/cross-game scope, deadline, stake, and canonical SQL, explicitly saying that the SQL is binding. If the wording is ambiguous, ask a focused question instead of creating a draft.
For Dare-only answers, set the report queryText to null and includeVisualization to false. The dare's canonical SQL belongs in the answer prose or tool card; it is not an Explore report query.
