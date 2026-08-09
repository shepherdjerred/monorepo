---
title: About Scout's access model
description: Why Scout has its own permissions instead of relying on Discord roles, and the reasoning behind roles, delegation limits, and the audit log.
sidebar:
  order: 3
---

Scout could have used Discord's permission system: check whether someone is an
administrator and let them do anything if so. The reason it does not is that
"can configure Scout" and "can administer this Discord server" are not the same
job, and conflating them forces an unpleasant choice — either you hand out
Discord Administrator to whoever maintains the player roster, or you do all the
maintenance yourself.

So Scout defines its own permissions, over its own resources.

## Permissions describe Scout, not Discord

A permission is a `resource:action` pair — `players:merge`, `reports:run`,
`roles:grant`. The resources are Scout's own concepts, which means a grant can
be as narrow as the job actually is: someone who runs the weekly report needs
`reports:read` and `reports:run` and nothing else.

Discord administrators and the server owner keep full access regardless. That is
not a loophole so much as an acknowledgement that whoever controls the server
controls the bot in it — they can remove Scout entirely — so pretending Scout
could restrict them would be theatre.

## Roles are presets, not containers

Scout ships three roles — Viewer, Manager, Admin — but they are not stored on
anyone. A grant writes one row per permission, and a role is just a named bundle
expanded at grant time. A set that happens to match a bundle exactly is
_displayed_ as that role; anything else is displayed as custom.

This is a deliberate trade. A stored-role design gives cleaner reporting ("this
person is a Manager") and makes it easy to redefine what Manager means later.
Scout's design gives precision instead: you are never forced to over-grant
because the closest preset happens to include something extra. Since
over-granting is the failure mode that actually causes harm, and roles rarely
need redefining, precision won.

Manager is the interesting case: it is everything _except_ managing access. It
is the role for someone who genuinely helps run the server, and it draws the
boundary that matters — they can change configuration, but not who else can.

## You cannot grant what you do not hold

Scout refuses to let anyone delegate a permission they do not have themselves. A
Manager cannot create an Admin.

Without this rule, permission to grant access would implicitly be permission to
grant _every_ access, since the holder could promote themselves through someone
else. With it, delegation can only ever narrow. That is what makes it safe to
hand out the roles permission at all.

## The audit log is what makes delegation reasonable

Access control decides what someone _can_ do. The audit log records what they
_did_ — every mutation, with the actor and the time, including changes made
through Discord commands rather than the dashboard.

The log is the more important half. Permissions alone force you to predict every
way someone might cause damage, and predicting badly gives you either an
over-restricted setup nobody can work in or an over-permissive one you cannot
reason about afterwards. A complete log makes mistakes diagnosable and
reversible, so you can afford to grant generously and correct later.

That is the intended posture: grant people the access their job needs, rely on
the log rather than on restriction, and reserve tight scoping for operations
that are genuinely hard to undo — merges, transfers, and deletions.

## Related

- [Grant dashboard access without Discord admin](/docs/how-to/grant-access/)
- [Permission reference](/docs/reference/permissions/)
