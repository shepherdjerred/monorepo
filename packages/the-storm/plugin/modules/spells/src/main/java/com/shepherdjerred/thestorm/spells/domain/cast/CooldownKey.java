package com.shepherdjerred.thestorm.spells.domain.cast;

import java.util.UUID;

/**
 * One player's cooldown in one cooldown group. Spells that share a group (Dawn and Dusk) share the
 * cooldown, exactly like the client's item cooldown overlay for that group.
 */
public record CooldownKey(UUID player, String group) {}
