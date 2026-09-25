package com.shepherdjerred.thestorm.towns.domain.protection;

import com.shepherdjerred.thestorm.towns.domain.land.Claim;
import java.util.UUID;

/**
 * How much a claim's town trusts a player for one act. Today this comes from town membership roles;
 * town ranks, per-plot trust and per-act permissions can replace it without changing the engine,
 * since it sees the claim and the act.
 */
@FunctionalInterface
public interface TrustLookup {

  TrustLevel trustOf(UUID player, Claim claim, Act act);
}
