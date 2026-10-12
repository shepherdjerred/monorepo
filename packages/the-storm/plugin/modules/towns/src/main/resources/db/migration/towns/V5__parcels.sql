-- Historical holdings are configuration-owned; mutable rental state is not town membership.
CREATE TABLE towns_leases (
    parcel_id TEXT NOT NULL PRIMARY KEY,
    owner_id TEXT NOT NULL UNIQUE,
    paid_through BIGINT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('HELD', 'RESETTING'))
);

-- Persist the intended lease before charging the wallet. Its operation is the ledger key.
CREATE TABLE towns_lease_payments (
    operation_id TEXT NOT NULL PRIMARY KEY,
    parcel_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    paid_through BIGINT NOT NULL,
    amount BIGINT NOT NULL CHECK (amount > 0),
    state TEXT NOT NULL CHECK (state IN ('PENDING', 'APPLIED', 'REJECTED'))
);
CREATE UNIQUE INDEX towns_pending_plot_payment ON towns_lease_payments(parcel_id)
    WHERE state = 'PENDING';
CREATE UNIQUE INDEX towns_pending_player_payment ON towns_lease_payments(owner_id)
    WHERE state = 'PENDING';

CREATE TABLE towns_plot_baselines (
    parcel_id TEXT NOT NULL PRIMARY KEY,
    definition_hash TEXT NOT NULL,
    schematic BLOB NOT NULL
);

-- Snapshot precedes every world edit. Recovery stays unavailable until reset verifies.
CREATE TABLE towns_plot_recoveries (
    recovery_id TEXT NOT NULL PRIMARY KEY,
    parcel_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    schematic BLOB NOT NULL,
    materials BLOB NOT NULL,
    auxiliary BLOB NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('SNAPSHOT', 'AVAILABLE', 'PLACING', 'ROLLING_BACK', 'PLACED', 'MATERIALS')),
    token_id TEXT NOT NULL UNIQUE,
    mailed INTEGER NOT NULL DEFAULT 0 CHECK (mailed IN (0, 1)),
    destination TEXT,
    before_schematic BLOB
);
CREATE UNIQUE INDEX towns_active_plot_recovery ON towns_plot_recoveries(parcel_id)
    WHERE state = 'SNAPSHOT';
