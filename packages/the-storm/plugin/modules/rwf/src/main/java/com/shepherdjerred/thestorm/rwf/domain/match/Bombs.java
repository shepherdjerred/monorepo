// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/SearchAndDestroy.java,
// onBombInteract/onBombTick/onExplode, and TeamBomb.java); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.match;

import com.shepherdjerred.thestorm.rwf.domain.bomb.Bomb;
import com.shepherdjerred.thestorm.rwf.domain.bomb.BombClick;
import com.shepherdjerred.thestorm.rwf.domain.bomb.BombError;
import com.shepherdjerred.thestorm.rwf.domain.bomb.BombOutcome;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Bombs being armed, defused, burning down and exploding inside a live match. */
final class Bombs {

  private Bombs() {}

  static Optional<MatchError> click(Draft draft, MatchEvent.BombClicked click) {
    if (!(draft.phase instanceof Phase.Live)) {
      return Optional.of(MatchError.NOT_LIVE);
    }
    var member = draft.member(click.id());
    if (member.isEmpty()) {
      return Optional.of(MatchError.NOT_A_MEMBER);
    }
    var clicker = member.orElseThrow();
    if (!clicker.alive()) {
      return Optional.of(MatchError.NOT_ALIVE);
    }
    var bomb = draft.bomb(click.bombId());
    if (bomb.isEmpty()) {
      return Optional.of(MatchError.UNKNOWN_BOMB);
    }
    var before = bomb.orElseThrow();
    var team = clicker.team().orElseThrow();
    var result = before.click(new BombClick(clicker.id(), team, clicker.fuse(), click.now()));
    return result.fold(
        step -> {
          draft.putBomb(step.bomb());
          draft.effect(new MatchEffect.SoundAt(before.site().position(), SoundCue.FUSE_HISS));
          for (var outcome : step.outcomes()) {
            apply(draft, before, step.bomb(), outcome);
          }
          return Optional.empty();
        },
        error -> Optional.of(translate(error)));
  }

  private static MatchError translate(BombError error) {
    return switch (error) {
      case CANNOT_ARM_OWN_BOMB -> MatchError.CANNOT_ARM_OWN_BOMB;
      case CANNOT_DEFUSE_ENEMY_BOMB -> MatchError.CANNOT_DEFUSE_ENEMY_BOMB;
      case CANNOT_DEFUSE_OWN_NUKE -> MatchError.CANNOT_DEFUSE_OWN_NUKE;
      case DESTROYED -> MatchError.BOMB_DESTROYED;
    };
  }

  /** Every bomb ticks; explosions take effect in order, and a bomb removed by one is skipped. */
  static void tick(Draft draft, Instant now) {
    for (var snapshot : draft.bombs()) {
      var current = draft.bomb(snapshot.id()).orElseThrow();
      if (current.destroyed() || !(draft.phase instanceof Phase.Live)) {
        continue;
      }
      var step = current.tick(now);
      draft.putBomb(step.bomb());
      for (var outcome : step.outcomes()) {
        if (outcome instanceof BombOutcome.Exploded) {
          explode(draft, step.bomb(), now);
        } else {
          apply(draft, current, step.bomb(), outcome);
        }
      }
    }
  }

  private static void apply(Draft draft, Bomb before, Bomb after, BombOutcome outcome) {
    switch (outcome) {
      case BombOutcome.Armed armed -> onArmed(draft, after, armed);
      case BombOutcome.Defused defused -> onDefused(draft, before, defused);
      case BombOutcome.Burned burned -> onBurned(draft, after, burned);
      case BombOutcome.Exploded _ ->
          throw new IllegalStateException("only a tick can explode " + after.id());
    }
  }

  private static void onArmed(Draft draft, Bomb bomb, BombOutcome.Armed armed) {
    var team = bomb.team().orElseThrow();
    if (bomb.isNuke()) {
      draft.announce(Notice.of(NoticeKind.NUKE_ARMED, "team", armed.by().displayName()));
    } else {
      draft.announce(
          Notice.of(
              NoticeKind.BOMB_ARMED,
              Map.of("team", armed.by().displayName(), "owner", team.displayName())));
    }
    draft.effect(new MatchEffect.BombArmed(bomb.id()));
    draft.sound(threatened(draft, bomb), SoundCue.BOMB_ARMED_AGAINST_YOU);
    draft.sound(unthreatened(draft, bomb), SoundCue.BOMB_ARMED_FOR_YOU);
    for (var armer : armed.armers()) {
      draft.effect(new MatchEffect.RecordStat(armer, "Armed"));
    }
  }

  private static void onDefused(Draft draft, Bomb before, BombOutcome.Defused defused) {
    var owner = before.team().orElseThrow();
    if (before.isNuke()) {
      draft.announce(
          Notice.of(
              NoticeKind.NUKE_DEFUSED,
              Map.of("team", defused.by().displayName(), "owner", owner.displayName())));
    } else {
      draft.announce(Notice.of(NoticeKind.BOMB_DEFUSED, "team", owner.displayName()));
    }
    draft.effect(new MatchEffect.BombRestored(before.id()));
    for (var defuser : defused.defusers()) {
      draft.effect(new MatchEffect.RecordStat(defuser, "Defused"));
    }
  }

  private static void onBurned(Draft draft, Bomb bomb, BombOutcome.Burned burned) {
    draft.effect(new MatchEffect.SoundAt(bomb.site().position(), SoundCue.FUSE_TICK));
    if (!burned.announced()) {
      return;
    }
    var team = bomb.team().orElseThrow();
    draft.announce(
        Notice.of(
            NoticeKind.FUSE_WARNING,
            Map.of(
                "seconds", String.valueOf(burned.remaining()),
                "team", team.displayName(),
                "bomb", bomb.isNuke() ? "nuke" : "bomb")));
    draft.sound(threatened(draft, bomb), SoundCue.FUSE_WARNING);
  }

  /** Who an armed bomb threatens: its owners, or for a nuke everyone off the arming team. */
  private static List<CombatantId> threatened(Draft draft, Bomb bomb) {
    var team = bomb.team().orElseThrow();
    return draft.members().stream()
        .filter(member -> member.onTeam(team) != bomb.isNuke())
        .map(Combatant::id)
        .toList();
  }

  private static List<CombatantId> unthreatened(Draft draft, Bomb bomb) {
    var threatened = threatened(draft, bomb);
    return draft.ids().stream().filter(id -> !threatened.contains(id)).toList();
  }

  /** The fuse ran out. */
  static void explode(Draft draft, Bomb bomb, Instant now) {
    var team = bomb.team().orElseThrow();
    var at = bomb.site().position();
    draft.effect(new MatchEffect.Explode(bomb.id(), at));
    draft.effect(new MatchEffect.Crater(at, Bomb.CRATER_RADIUS));
    draft.announce(
        Notice.of(
            bomb.isNuke() ? NoticeKind.NUKE_EXPLODED : NoticeKind.BOMB_EXPLODED,
            "team",
            team.displayName()));
    var victims = new ArrayList<CombatantId>();
    for (var member : draft.alive()) {
      if (member.onTeam(team) != bomb.isNuke()) {
        victims.add(member.id());
        draft.put(member.dead(now, false));
        draft.effect(new MatchEffect.Spectate(member.id(), draft.map().spectatorPoint()));
      }
    }
    if (!victims.isEmpty()) {
      draft.effect(new MatchEffect.Kill(victims, AttackType.BOMB_EXPLODE));
      Standings.recordDeath(draft, now);
    }
    clearTeamBombs(draft, team, bomb.isNuke());
  }

  /**
   * After an explosion or a defeat, {@code team}'s bombs go: its own bombs are removed and a nuke
   * it armed is restored, unless the nuke itself is what went off.
   */
  static void clearTeamBombs(Draft draft, TeamColor team, boolean nukeExploded) {
    for (var bomb : draft.bombs()) {
      if (bomb.destroyed() || bomb.team().filter(t -> t == team).isEmpty()) {
        continue;
      }
      if (bomb.isNuke() && !nukeExploded) {
        draft.putBomb(bomb.restore());
        draft.effect(new MatchEffect.BombRestored(bomb.id()));
      } else {
        draft.putBomb(bomb.destroy());
        draft.effect(new MatchEffect.BombRemoved(bomb.id()));
      }
    }
  }
}
