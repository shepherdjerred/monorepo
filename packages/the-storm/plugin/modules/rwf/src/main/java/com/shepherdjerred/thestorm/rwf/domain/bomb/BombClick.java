package com.shepherdjerred.thestorm.rwf.domain.bomb;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import java.time.Instant;
import java.util.Optional;

/**
 * A living combatant right-clicks a bomb while holding a Bomb Fuse.
 *
 * @param clicker who
 * @param team their team
 * @param fuse the bonus on their fuse, if any
 * @param now when
 */
public record BombClick(
    CombatantId clicker, TeamColor team, Optional<FuseBonus> fuse, Instant now) {}
