-- Which server a ticket belongs to. Each server reads only its own
-- rows, so servers sharing a database never see each other's tickets.

ALTER TABLE ticket ADD COLUMN server TEXT NOT NULL DEFAULT 'survival';

CREATE INDEX ticket_server ON ticket (server);
