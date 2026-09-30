package com.shepherdjerred.thestorm.skills.app;

import java.util.UUID;

/** A named player and their total level across the eleven skills. */
public record RankedSkillPlayer(UUID playerId, String name, int powerLevel) {}
