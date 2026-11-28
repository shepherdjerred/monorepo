-- Prisma wraps multi-statement migrations in a transaction. Keep this
-- statement separate so the receipt table can continue accepting writes.
CREATE INDEX CONCURRENTLY "MatchProcessingReceipt_writerGitSha_createdAt_id_idx"
ON "MatchProcessingReceipt"("writerGitSha", "createdAt" DESC, "id" DESC);
