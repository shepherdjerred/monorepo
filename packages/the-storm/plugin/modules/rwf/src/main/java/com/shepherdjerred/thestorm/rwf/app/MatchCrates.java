package com.shepherdjerred.thestorm.rwf.app;

import com.shepherdjerred.thestorm.rwf.app.view.Point;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Supply crates that have landed, as anyone on the field could see them. Main thread only. One
 * method so a harness can provide {@code List::of}.
 */
public interface MatchCrates {

  /**
   * One landed crate.
   *
   * @param owner who called it in
   * @param team their team as {@link com.shepherdjerred.thestorm.rwf.app.view.MatchState#teamName}
   *     names it
   * @param position the block center of the chest
   * @param landed when it landed
   * @param teamLoots when the owner's team may loot it
   * @param anyoneLoots when anyone may loot it
   */
  record Landed(
      UUID owner,
      String team,
      Point position,
      Instant landed,
      Instant teamLoots,
      Instant anyoneLoots) {}

  /** The crates on the ground now, in a stable order. */
  List<Landed> landed();
}
