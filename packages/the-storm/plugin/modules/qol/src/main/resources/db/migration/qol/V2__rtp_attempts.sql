-- An RTP charge remains recoverable until delivery or compensation is settled.
CREATE TABLE qol_rtp_attempt (
    id     TEXT    NOT NULL PRIMARY KEY,
    player TEXT    NOT NULL,
    cost   BIGINT  NOT NULL CHECK (cost > 0)
);

CREATE INDEX qol_rtp_attempt_player ON qol_rtp_attempt (player);
