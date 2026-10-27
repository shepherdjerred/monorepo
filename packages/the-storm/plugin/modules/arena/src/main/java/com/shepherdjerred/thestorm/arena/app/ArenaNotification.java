package com.shepherdjerred.thestorm.arena.app;

import com.shepherdjerred.thestorm.arena.domain.game.ArenaGame;
import com.shepherdjerred.thestorm.arena.domain.game.GameEffect;
import com.shepherdjerred.thestorm.arena.domain.game.GameEvent;
import com.shepherdjerred.thestorm.arena.domain.game.Member;
import com.shepherdjerred.thestorm.arena.domain.game.Notice;
import com.shepherdjerred.thestorm.arena.domain.game.NoticeKind;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * One accepted arena transition, delivered to {@link ArenaEvents} subscribers on the main thread
 * after every effect has been carried out.
 *
 * @param event the event the game accepted
 * @param effects what the server did in response, in order
 * @param before the game before the event
 * @param after the game afterwards
 */
public record ArenaNotification(
    GameEvent event, List<GameEffect> effects, ArenaGame before, ArenaGame after) {

  public ArenaNotification {
    effects = List.copyOf(effects);
  }

  /**
   * Wave clears and the final victory. Fighters are whoever was in the arena before the transition,
   * because victory removes them. A cleared wave that does not name its number is corrupt.
   */
  public List<Milestone> milestones() {
    var fighters = before.fighters().stream().map(Member.Fighter::id).toList();
    var earned = new ArrayList<Milestone>();
    for (var effect : effects) {
      if (!(effect instanceof GameEffect.Announce(var _, var notice))) {
        continue;
      }
      var kind = notice.kind();
      if (kind == NoticeKind.WAVE_CLEARED) {
        earned.add(new Milestone(kind.name(), wave(notice), fighters));
      } else if (kind == NoticeKind.VICTORY) {
        earned.add(new Milestone(kind.name(), 0, fighters));
      }
    }
    return List.copyOf(earned);
  }

  private static int wave(Notice notice) {
    var raw = notice.values().get("wave");
    if (raw == null) {
      throw new IllegalStateException("a cleared wave did not say which wave");
    }
    return Integer.parseInt(raw);
  }

  /** One wave clear or a final-wave victory, and who was fighting. */
  public record Milestone(String kind, int wave, List<UUID> fighters) {
    public Milestone {
      fighters = List.copyOf(fighters);
    }
  }
}
