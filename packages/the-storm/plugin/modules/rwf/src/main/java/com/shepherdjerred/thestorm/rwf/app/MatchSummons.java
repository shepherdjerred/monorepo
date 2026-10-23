package com.shepherdjerred.thestorm.rwf.app;

import com.shepherdjerred.thestorm.rwf.app.view.Point;
import java.util.List;
import java.util.UUID;

/**
 * The killstreak creatures fighting in the match, as anyone on the field could see them: what each
 * is, whose side it fights for, where it is and how it moves. Main thread only.
 */
public interface MatchSummons {

  /** What a summon is. */
  enum Kind {
    /** The iron golem: slow, tough and hard-hitting. */
    GOLEM,
    /** An attack dog: fast and weak. */
    WOLF
  }

  /**
   * One living summon.
   *
   * @param entity the creature's entity
   * @param kind what it is
   * @param owner who summoned it
   * @param team the team it fights for, as {@link
   *     com.shepherdjerred.thestorm.rwf.app.view.MatchState#teamName} names it
   * @param position its feet
   * @param velocity its motion per tick
   * @param health its health points
   */
  record Creature(
      UUID entity,
      Kind kind,
      UUID owner,
      String team,
      Point position,
      Point velocity,
      double health) {}

  /** The summons alive now, in a stable order. */
  List<Creature> creatures();
}
