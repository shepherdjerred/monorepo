INSERT INTO "Team" ("id", "key", "name") VALUES ('team-ai', 'AI', 'Agents'), ('team-sj', 'SJ', 'Jerred');

INSERT INTO "WorkflowState" ("id", "teamId", "name", "type", "color", "position")
SELECT t."id" || '-' || s.type, t."id", s.name, s.type::"StateType", s.color, s.position
FROM "Team" t CROSS JOIN (VALUES
  ('triage', 'Triage', '#a3a3a3', 0), ('backlog', 'Backlog', '#737373', 1),
  ('unstarted', 'Todo', '#94a3b8', 2), ('started', 'In progress', '#eab308', 3),
  ('completed', 'Done', '#8b5cf6', 4), ('canceled', 'Canceled', '#78716c', 5),
  ('duplicate', 'Duplicate', '#78716c', 6)
) s(type, name, color, position);

INSERT INTO "Project" ("id", "slug", "name", "color") VALUES
  ('project-the-storm', 'the-storm', 'The Storm', '#22c55e'),
  ('project-scout', 'scout', 'Scout', '#3b82f6'),
  ('project-homelab', 'homelab', 'Homelab', '#f59e0b'),
  ('project-toolkit', 'toolkit', 'Toolkit', '#8b5cf6'),
  ('project-developer-experience', 'developer-experience', 'Developer Experience', '#ec4899');

INSERT INTO "Actor" ("id", "key", "kind", "name", "firstMetadata", "metadata")
VALUES ('actor-system-migration', 'system:migration', 'runner', 'Migration', '{}', '{}');
