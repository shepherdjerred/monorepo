// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/TeamGame.java, checkGameState,
// and redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/SearchAndDestroy.java,
// checkLastMan/onTeamDeath);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.match;

import com.shepherdjerred.thestorm.rwf.domain.bomb.FuseBonus;
import com.shepherdjerred.thestorm.rwf.domain.bomb.FuseType;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import java.time.Instant;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/** Deaths, eliminations, the last man standing and the end of a live match. */
final class Standings {

  /** The fuse a team's last living member is given: an instant arm. */
  static final FuseBonus LAST_MAN_FUSE = new FuseBonus(FuseType.BOMB_ARMING, FuseBonus.INSTANT);

  /**
   * Deaths that throw the match away and forfeit its rewards: a suicide or a quit at any point
   * while it is live. (Red Warfare forfeited only a suicide in the first minute.)
   */
  static final Set<AttackType> FORFEITS = Set.of(AttackType.SUICIDE, AttackType.QUIT);

  private Standings() {}

  /**
   * A living combatant looked around, so they are not AFK. Red Warfare's {@code onAfkMove}: only a
   * live match and a living combatant count.
   */
  static void lookedAround(Draft draft, CombatantId id) {
    if (!(draft.phase instanceof Phase.Live)) {
      return;
    }
    draft
        .member(id)
        .filter(member -> member.alive() && member.afk())
        .ifPresent(member -> draft.put(member.active()));
  }

  /** A combatant died. Already-dead combatants (killed by an explosion this tick) are ignored. */
  static void died(Draft draft, MatchEvent.Died died) {
    if (!(draft.phase instanceof Phase.Live)) {
      return;
    }
    var member = draft.member(died.victim());
    if (member.isEmpty() || !member.orElseThrow().alive()) {
      return;
    }
    var forfeit = FORFEITS.contains(died.cause());
    draft.put(member.orElseThrow().dead(died.now(), forfeit));
    draft.effect(new MatchEffect.Spectate(died.victim(), draft.map().spectatorPoint()));
    died.killer().ifPresent(killer -> draft.effect(new MatchEffect.RecordStat(killer, "Kills")));
    recordDeath(draft, died.now());
    check(draft, died.now());
  }

  /** The poison's quiet timer restarts. */
  static void recordDeath(Draft draft, Instant now) {
    if (draft.phase instanceof Phase.Live live) {
      draft.phase =
          new Phase.Live(
              live.startedAt(),
              live.poison().deathAt(now),
              live.nextPoisonSecond(),
              live.lastManAnnounced(),
              live.defeated());
    }
  }

  /** Eliminates teams with nobody left, arms the last man standing, and ends a decided match. */
  static void check(Draft draft, Instant now) {
    if (!(draft.phase instanceof Phase.Live live)) {
      return;
    }
    var defeated = new HashSet<>(live.defeated());
    var lastMan = new HashSet<>(live.lastManAnnounced());
    for (var team : draft.map().teamColors()) {
      var alive = draft.aliveOn(team);
      if (!defeated.contains(team) && alive.isEmpty()) {
        defeated.add(team);
        draft.announce(Notice.of(NoticeKind.TEAM_DEFEATED, "team", team.displayName()));
        Bombs.clearTeamBombs(draft, team, false);
      } else if (!defeated.contains(team) && alive.size() == 1 && !lastMan.contains(team)) {
        lastMan.add(team);
        var last = alive.getFirst();
        draft.put(last.withFuse(LAST_MAN_FUSE));
        draft.effect(new MatchEffect.GiveFuse(last.id(), LAST_MAN_FUSE));
        draft.announce(
            Notice.of(
                NoticeKind.LAST_MAN_STANDING,
                Map.of("player", last.name(), "team", team.displayName())));
      }
    }
    var still =
        new Phase.Live(live.startedAt(), live.poison(), live.nextPoisonSecond(), lastMan, defeated);
    draft.phase = still;
    var standing =
        draft.map().teamColors().stream().filter(team -> !defeated.contains(team)).toList();
    if (standing.size() == 1) {
      Flow.end(draft, still, new Outcome.Winner(standing.getFirst()), now);
    } else if (standing.isEmpty()) {
      Flow.end(draft, still, new Outcome.Draw(), now);
    }
  }
}
