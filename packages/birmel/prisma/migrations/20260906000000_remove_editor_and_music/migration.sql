-- Birmel no longer ships the editor or music specialists. Their tables are
-- dropped here; no other model references them, so no foreign keys unwind.
DROP TABLE "EditorSession";
DROP TABLE "GitHubAuth";
DROP TABLE "MusicHistory";
