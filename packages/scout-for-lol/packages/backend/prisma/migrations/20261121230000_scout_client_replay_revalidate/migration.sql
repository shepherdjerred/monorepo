-- Reopen every replay the container validator refused, so each is checked
-- again by the corrected one. From patch 16.21 a one-byte tag sits between
-- each chunk header and its body, and a remake replay names a leaver's result
-- "LeaverFail"; the validator rejected both, and a rejection is final, so the
-- client was told never to offer those replays again. Earlier validator bugs
-- (a zero-padded build, an aliased player UUID) left rejections of the same
-- kind behind.
--
-- FAILED is the retryable state: the next offer answers "want" when evidence
-- is on file, and the upload validates the bytes afresh. A replay that is
-- really invalid is rejected again. Rejections for other reasons (quota,
-- size, digest) are left alone.
UPDATE "ScoutClientReplayArtifact"
SET "uploadState" = 'FAILED'
WHERE "uploadState" = 'REJECTED'
  AND "lastError" IN (
    'Replay chunk compression is invalid',
    'Replay chunk count is invalid',
    'Replay chunk table is invalid',
    'Replay container is too short',
    'Replay container is truncated',
    'Replay does not contain the device player''s observed identity',
    'Replay duration does not match the observed match',
    'Replay header is invalid',
    'Replay metadata boundary is invalid',
    'Replay metadata is invalid',
    'Replay participant does not match the observed match',
    'Replay participant metadata is invalid',
    'Replay patch does not match the observed match',
    'Replay version is invalid'
  );
