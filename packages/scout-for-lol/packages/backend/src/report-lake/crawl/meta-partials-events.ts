/** Starting items are everything bought in the first 90 seconds. */
const START_WINDOW_MS = 90_000;

const CONTEXT = "p.patch, p.queue_id, p.tier, p.role, p.champion_id";

/**
 * The partial queries that read the reduced timeline events (`meta_ev`):
 * starting items, build paths and skill orders. Each yields the partial
 * columns in order, like the queries in `meta-partials.ts`.
 */
export function eventPartialQueries(): string[] {
  return [
    // Starting items: everything bought in the first 90s, net of undone buys.
    `WITH buys AS (
       SELECT match_id, participant_id, item_id, count(*) AS n FROM meta_ev
       WHERE event_type = 'ITEM_PURCHASED' AND t <= ${START_WINDOW_MS.toString()} AND item_id IS NOT NULL
       GROUP BY ALL
     ), undos AS (
       SELECT match_id, participant_id, before_id AS item_id, count(*) AS n FROM meta_ev
       WHERE event_type = 'ITEM_UNDO' AND t <= ${START_WINDOW_MS.toString()} AND before_id IS NOT NULL
       GROUP BY ALL
     ), net AS (
       SELECT b.match_id, b.participant_id, b.item_id, b.n - coalesce(u.n, 0) AS n
       FROM buys b LEFT JOIN undos u USING (match_id, participant_id, item_id)
       WHERE b.n - coalesce(u.n, 0) > 0
     ), keyed AS (
       SELECT match_id, participant_id,
         string_agg(CAST(item_id AS VARCHAR) || CASE WHEN n > 1 THEN 'x' || CAST(n AS INTEGER) ELSE '' END, '+' ORDER BY item_id) AS key
       FROM net GROUP BY match_id, participant_id
     )
     SELECT 'start_items', ${CONTEXT}, k.key, '', count(*), sum(CAST(p.win AS INTEGER))
     FROM keyed k JOIN meta_p p USING (match_id, participant_id)
     GROUP BY p.patch, p.queue_id, p.tier, p.role, p.champion_id, k.key`,
    // Build path: the first three items bought that were still held at the end.
    `WITH firsts AS (
       SELECT match_id, participant_id, item_id, min(t) AS first_t FROM meta_ev
       WHERE event_type = 'ITEM_PURCHASED' AND item_id IS NOT NULL
       GROUP BY ALL
     ), ordered AS (
       SELECT f.match_id, f.participant_id, f.item_id,
         row_number() OVER (PARTITION BY f.match_id, f.participant_id ORDER BY f.first_t, f.item_id) AS rn
       FROM firsts f JOIN meta_pi i
         ON i.match_id = f.match_id AND i.participant_id = f.participant_id AND i.item = f.item_id
     ), keyed AS (
       SELECT match_id, participant_id,
         string_agg(CAST(item_id AS VARCHAR), '>' ORDER BY rn) AS key
       FROM ordered WHERE rn <= 3 GROUP BY match_id, participant_id HAVING count(*) = 3
     )
     SELECT 'build_path', ${CONTEXT}, k.key, '', count(*), sum(CAST(p.win AS INTEGER))
     FROM keyed k JOIN meta_p p USING (match_id, participant_id)
     GROUP BY p.patch, p.queue_id, p.tier, p.role, p.champion_id, k.key`,
    // Skill order: Q/W/E ranked by points put in, ties by first level.
    `WITH points AS (
       SELECT match_id, participant_id, skill_slot, count(*) AS n, min(t) AS first_t FROM meta_ev
       WHERE event_type = 'SKILL_LEVEL_UP' AND level_up_type = 'NORMAL' AND skill_slot IN (1, 2, 3)
       GROUP BY ALL
     ), keyed AS (
       SELECT match_id, participant_id,
         string_agg(CASE skill_slot WHEN 1 THEN 'Q' WHEN 2 THEN 'W' ELSE 'E' END, '' ORDER BY n DESC, first_t) AS key
       FROM points GROUP BY match_id, participant_id HAVING count(*) = 3 AND sum(n) >= 9
     )
     SELECT 'skill_order', ${CONTEXT}, k.key, '', count(*), sum(CAST(p.win AS INTEGER))
     FROM keyed k JOIN meta_p p USING (match_id, participant_id)
     GROUP BY p.patch, p.queue_id, p.tier, p.role, p.champion_id, k.key`,
  ];
}
