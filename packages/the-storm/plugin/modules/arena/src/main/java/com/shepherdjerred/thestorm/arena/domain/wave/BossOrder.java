package com.shepherdjerred.thestorm.arena.domain.wave;

/**
 * A boss to spawn, already scaled.
 *
 * @param id the boss id
 * @param boss its definition
 * @param maxHealth its absolute max health
 * @param damage multiplier on its archetype's vanilla attack damage
 * @param entities how many entities it is, riders included
 */
public record BossOrder(
    String id, BossDefinition boss, double maxHealth, double damage, int entities) {}
