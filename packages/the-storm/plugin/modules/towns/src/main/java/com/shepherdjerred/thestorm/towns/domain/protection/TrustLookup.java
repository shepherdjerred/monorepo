package com.shepherdjerred.thestorm.towns.domain.protection;

import java.util.UUID;

/**
 * How much a town trusts a player. Today this comes from town membership roles; town ranks and
 * per-plot trust can replace it without changing the engine.
 */
@FunctionalInterface
public interface TrustLookup {

  TrustLevel trustOf(UUID player, UUID townId);
}
