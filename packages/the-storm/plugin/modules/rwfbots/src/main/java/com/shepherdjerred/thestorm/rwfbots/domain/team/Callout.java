package com.shepherdjerred.thestorm.rwfbots.domain.team;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import java.util.Optional;

/**
 * One thing a bot tells its team in team chat.
 *
 * @param kind what it is about
 * @param speaker the bot that says it
 * @param team the speaker's team
 * @param pos where it is about: the enemy, the bomb, the speaker in trouble
 * @param place {@code pos} as a player calls it ({@link Places})
 * @param subject whom it is addressed to or about: the human an enemy is near or a bot covers, or
 *     the teammate working a fuse when another bot calls it
 * @param bearing where the enemy is from {@code subject}'s point of view, such as {@code behind
 *     you}
 * @param tick when it was seen
 */
public record Callout(
    Kind kind,
    CombatantId speaker,
    TeamId team,
    Vec3 pos,
    String place,
    Optional<CombatantId> subject,
    Optional<String> bearing,
    long tick) {

  public Callout {
    if (place.isBlank()) throw new IllegalArgumentException("a callout names its place");
    if (bearing.isPresent() && subject.isEmpty())
      throw new IllegalArgumentException("a bearing is from someone's point of view");
  }

  /** What a callout is about, most urgent first. */
  public enum Kind {
    /** The enemy is arming the team's own bomb. */
    ENEMY_PLANTING,
    /** The own bomb burns down with nobody on the fuse. */
    NEED_DEFUSE,
    /** The own bomb was armed: the team retakes it. */
    RETAKING,
    /** A teammate makes for the own bomb's fuse. */
    DEFUSING,
    /** A teammate makes for an enemy bomb to arm it. */
    PLANTING,
    /** A bot comes to cover a human arming a bomb. */
    COVERING,
    /** A bot comes to help a human with an enemy on them. */
    HELPING,
    /** A bot stuck in a losing fight. */
    NEED_HELP,
    /** An enemy sighting. */
    ENEMY;

    /** Whether it is about the round's objective or a teammate in need, not a plain sighting. */
    public boolean urgent() {
      return this != ENEMY;
    }
  }
}
