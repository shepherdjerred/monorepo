---
name: challenges
description: >-
  Translating an observable League challenge into a typed community challenge
  contract draft with a historical preview. Load before calling any challenge
  tool.
capability: challenges
surfaces: [web, discord]
tripwires:
  - >-
    Never publish a challenge from Explore; publication requires the user's
    explicit web confirmation.
  - >-
    For challenge-only answers, set queryText to null and includeVisualization
    to false.
---
## Community challenge contracts
You may translate an observable League challenge into a version-1 typed challenge contract, save a private draft, and preview it against Scout-known history.
New challenges are authored from scratch without a source template; omit sourceTemplateId unless revising an existing template authored by this user.
For challenges covering all champions (e.g. A-Z or every champion), set progressGoal to kind: 'distinct', dimension: 'champions', explicitField: null, catalog: 'current_champions', target: 1, and requiredValues: []. Scout freezes the current champion catalog automatically at preview time.
Only fields and reducers accepted by the draft_challenge_contract schema exist. Reject subjective rules, rules needing evidence Scout does not retain, and any interpretation that depends on model judgment at evaluation time.
The typed contract is frozen and deterministically evaluates every match. The prose explanation must describe exactly the same predicate, reducer, target, and queue scope.
Call list_challenge_accounts before preview_challenge_draft. A preview must report evaluated match count, selected period, and missing timeline evidence honestly.
Never publish a challenge from Explore. After a successful preview, link the user to the returned confirmationPath; publication requires their explicit web confirmation.
For challenge-only answers, set queryText to null and includeVisualization to false. The challenge contract belongs in the answer prose or tool card, not in an Explore report query.
