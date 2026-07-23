---
id: guide-2026-07-22-todoist-feature-comparison
type: guide
status: complete
board: false
---

# Tasks-for-Obsidian vs Todoist — docs-grounded feature comparison

Comparison of `packages/tasks-for-obsidian` against Todoist's **current**
feature set. App side: read from source (screens/components/hooks, 2026-07-22).
Todoist side: four parallel research agents over ~40 official help articles
(todoist.com/help, articles last updated Jun–Jul 2026); citations in the
per-area notes. Plans: Todoist tiers are Beginner (free) / Pro / Business.

Goal frame (from `plans/2026-07-03_tasknotes-first-in-class.md`): the app =
Todoist ergonomics (instant capture, trustworthy today view, full offline);
Obsidian = power interface. Collaboration/assignee features are out of scope.

## Scheduling & rescheduling

| Capability            | Todoist                                                                                                                                | Our app                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Reschedule picker     | NL text field + monthly calendar grid + Time + No Date + per-day task counts                                                           | 3 fixed presets (Today / Tomorrow / +7d) + None (`DatePicker.tsx`)                 |
| Quick reschedule      | Swipe (configurable "Schedule" action), right-click menu (Tomorrow / Next Week), drag-to-date in Upcoming, overdue "Reschedule" button | None (date editing only inside TaskDetail)                                         |
| "Next week" semantics | Next **Monday** (configurable); "this weekend" = Saturday                                                                              | Literal +7 days                                                                    |
| Date fields           | **Three**: Date (when to work), Deadline `{}` (hard cutoff, Pro+, added Jan 2025), Duration (`for 1h`, Pro+)                           | Model has `scheduled` + `due` (≈ Date + Deadline!) but the UI edits **only `due`** |
| Due times             | Yes (`tomorrow at 4pm`), drives auto-reminders                                                                                         | No (date-only format fields)                                                       |
| Recurrence authoring  | Rich NL grammar; `every` (calendar-fixed) vs `every!` (completion-based); "Complete forever"                                           | None by design (Obsidian authors rrules); display + per-occurrence completion work |
| Reminders             | Auto 30-min-before, custom/multiple (`!30m`, `!1hb`), recurring, location (Pro+)                                                       | None (plan-deferred)                                                               |

Stale-memory correction: Todoist's 2016 "Smart Schedule" AI rescheduling is
absent from current docs; only a generic Reschedule button on overdue sections
is confirmed.

## Capture / Quick Add

| Capability       | Todoist                                                                                                                          | Our app                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Date grammar     | Huge: `jan 27`, `in 5 days`, `mid January`, `end of month`, anchored math (`6 weeks before 21 Jul`), holidays, times, `someday`  | `today`, `tomorrow`, weekday names, `next week` only (`lib/nlp.ts`) |
| Symbols          | `#` project (autocomplete), `/` section, `@` label, `+` assignee, `p1–p3` priority (P4 default), `!` **reminder**, `{}` deadline | `p:` project, `@` context, `#` tag, `!high`/`!1`–`!4` priority      |
| Autocomplete     | Dropdown of existing projects/labels as you type                                                                                 | None (free-text; typos create new tags/projects)                    |
| Mis-parse escape | Tap highlighted word to un-parse; global toggle                                                                                  | None (word is consumed by grammar)                                  |
| Entry points     | Quick Add, global desktop hotkey, widget, share/email/browser ext., Ramble voice, AI photo capture                               | FAB, modal, Control Center (iOS 18+), Siri AddTask intent, widget   |

## Organization

| Capability           | Todoist                                                                                                                    | Our app                                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Projects             | 3-level nesting, favorites, archive, 300 tasks/project cap                                                                 | Flat wikilink projects (Obsidian notes); no in-app hierarchy                                                          |
| Sections             | 20/project; become board columns                                                                                           | None (no format equivalent used)                                                                                      |
| Subtasks             | 4 indent levels; scheduled subtasks appear in Today                                                                        | None (not in TaskNotes model)                                                                                         |
| Labels               | 500 cap, colors, favorites, rename/delete cascades                                                                         | Tags + contexts (two axes — Todoist has no contexts)                                                                  |
| Post-creation re-org | Move project/section from task view, `#` re-type, multi-select Move-to; labels editable everywhere                         | **Not possible** — TaskDetail edits title/priority/due/details only                                                   |
| Filters              | Full query language (`&`, `\|`, `!`, `##`, `date before:`, `search:`…), saved filters (3 free / 150 Pro), AI Filter Assist | Ad-hoc per-screen filter bar (project/context/tag/status/priority); 2 hardcoded saved views (`domain/saved-views.ts`) |
| Bulk edit            | Multi-select (all platforms): schedule, deadline, move, labels, priority, complete, delete, duplicate                      | None (observed cost: 2026-07-21 session = 28 tasks rescheduled one-by-one, 29 sequential PUTs)                        |

## Views & interaction

| Capability        | Todoist                                                                                                                                                         | Our app                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Layouts           | List / Board / Day / Week / Month per project **and** Today/Upcoming (calendar Pro+; board not in mobile Upcoming)                                              | Fixed list; one hardcoded kanban (job-search)                                                             |
| Upcoming          | Drag task to a day; Plan sidebar time-blocking (calendar)                                                                                                       | Static list                                                                                               |
| Completed history | Show-completed toggle per view (Today/Upcoming beta); Reporting (7d free / full Pro); un-complete                                                               | None (list filters archived/done out; no history view)                                                    |
| Undo model        | Delete = **confirm-first, no undo** (docs explicit); normal complete = no toast (un-complete via show-completed); **recurring complete = transient Undo popup** | Delete = confirm-first (**parity**); no undo for recurring completion (gap — it's the highest-stakes tap) |
| Swipe actions     | Configurable per direction: Complete / Schedule / Delete / Reminders / (Select)                                                                                 | Fixed: complete (L), delete (R)                                                                           |
| Gamification      | Karma (8 levels, streaks, goals, vacation mode) — current feature                                                                                               | None                                                                                                      |
| Templates         | Gallery + user templates + CSV                                                                                                                                  | None (Obsidian side could)                                                                                |

## Where we beat Todoist

- **Offline**: persisted command queue, exactly-once replay, dead-letter review
  UI. Todoist is offline-capable but our failure surfacing is stronger.
- **Time tracking / pomodoro / time reports** — native here; Todoist needs
  integrations.
- **Markdown on mobile**: Todoist rich text is desktop/web only; our
  TaskDetail renders markdown details on-device.
- **Data ownership**: plain markdown files, standard rrules (vs Todoist's
  proprietary recurrence strings), no per-plan caps.
- **Contexts** as a first-class axis alongside tags/projects.

## Corrections vs the earlier from-memory comparison (2026-07-22 session)

1. `!` in Todoist = reminders, not priority; priority is `p1–p3` tokens; no
   `//` description syntax.
2. Todoist has **no undo-after-delete** and no undo toast on normal
   completion — recommendation "replace confirm with undo toast" was wrong;
   our confirm-delete already matches. The one Todoist undo is recurring
   completion.
3. "Reschedule all overdue → today" / Smart Schedule: not in current docs.
4. Missed entirely: Deadlines field (2025), durations, Ramble voice capture,
   AI task capture, project descriptions via MCP, Filter Assist.
5. "Next week" = next Monday, not +7d.

## Prioritized gap list (for future planning)

1. **Reschedule sheet** (calendar grid + presets with Todoist semantics:
   next-Monday "next week", Saturday "this weekend") + expose `scheduled` vs
   `due` (model already has both ≈ Todoist Date/Deadline) + a Schedule swipe
   action. Reuse from TaskDetail, swipe, and context menu.
2. **Multi-select bulk edit** — schedule / complete / delete / move / priority.
3. **Post-creation organization editing** in TaskDetail (project, tags,
   contexts).
4. **NLP expansion + autocomplete** — `jan 27`, `in N days`, `this weekend`,
   month-day formats; autocomplete existing projects/tags/contexts; tap-to-
   unparse.
5. **Undo for recurring completion** (transient toast, matches Todoist).
6. **User-defined saved views** (subsumes the hardcoded job-search/school
   views; a per-view board layout would generalize JobSearchKanban).
7. Completed-history view + un-complete.
   Deferred (unchanged from plan): reminders/notifications + due times;
   subtasks/sections (format-level questions, not UI).
