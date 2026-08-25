-- PostgreSQL's trusted trigram extension provides typo-tolerant similarity for
-- the authenticated consumer player search. Authorization remains in the
-- server-scoped query; this extension only changes result ranking.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
