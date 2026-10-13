// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/TeamGame.java, checkGameState/onDeathPrefix,
// redwarfare-arcade/src/me/libraryaddict/arcade/game/Game.java,
// onKillstreakDeath/giveKillstreak/deathHealth, and
// redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/SearchAndDestroy.java,
// checkLastMan/onTeamDeath);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.match;

import com.shepherdjerred.thestorm.rwf.domain.bomb.FuseBonus;
import com.shepherdjerred.thestorm.rwf.domain.bomb.FuseType;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.Attribution;
import com.shepherdjerred.thestorm.rwf.domain.combat.DamageLog;
import com.shepherdjerred.thestorm.rwf.domain.combat.KillCredit;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.killstreak.Killstreak;
import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalDouble;
import java.util.Set;

/** Damage, deaths, kills and assists, eliminations, the last man standing and the end. */
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

  /** A living combatant was hurt in a live match: the damage log remembers it. */
  static void damaged(Draft draft, MatchEvent.Damaged damaged) {
    if (!(draft.phase instanceof Phase.Live)) {
      return;
    }
    if (draft.member(damaged.victim()).filter(Combatant::alive).isEmpty()) {
      return;
    }
    draft.damage =
        draft.damage.hurt(
            damaged.victim(),
            new DamageLog.Entry(
                damaged.attacker().filter(attacker -> draft.member(attacker).isPresent()),
                damaged.damage(),
                damaged.cause(),
                damaged.now()),
            damaged.healthBefore(),
            damaged.maxHealth());
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
    var attribution = credit(draft, died, true);
    Kits.died(draft, new Kits.Loss(died.victim(), attribution, died.now()));
    recordDeath(draft, died.now());
    check(draft, died.now());
  }

  /**
   * A bomb killed {@code victim}: the kill goes to the last combatant to hurt them, while that hit
   * still counts (see {@link KillCredit}).
   */
  static Attribution killedByBomb(
      Draft draft, CombatantId victim, Optional<Vitals> vitals, Instant now) {
    var killer =
        draft
            .damage
            .lastAttack(victim)
            .filter(
                hit ->
                    vitals
                        .map(
                            v ->
                                !KillCredit.hit(hit.at())
                                    .pruned(now, v.maxHealth() - v.health(), true))
                        .orElse(true))
            .flatMap(DamageLog.Entry::attacker);
    // Red Warfare turned death messages off while a bomb killed its team.
    return credit(
        draft,
        new MatchEvent.Died(
            victim, Attribution.of(killer, AttackType.BOMB_EXPLODE), OptionalDouble.empty(), now),
        false);
  }

  /**
   * Shares a death out as Red Warfare's {@code onKillstreakDeath} did: the killer gets a whole
   * kill, and everyone else who hurt the victim gets their share of the damage towards their
   * killstreak, counted as an assist above {@link DamageLog#STOLEN_SHARE}. A killer who did no more
   * than that share stole the kill. A {@code witnessed} death nobody was seen to cause (a fall, the
   * border) goes to the last combatant in the victim's log, as Red Warfare's log credited it, and
   * its message goes out in team colours; a bomb's deaths are neither.
   */
  static Attribution credit(Draft draft, MatchEvent.Died died, boolean witnessed) {
    var victimId = died.victim();
    var seen = died.attribution();
    var killerHealth = died.killerHealth();
    var shares = draft.damage.responsibility(victimId);
    var killer =
        seen.killer()
            .or(
                () ->
                    witnessed
                        ? draft.damage.lastAttack(victimId).flatMap(DamageLog.Entry::attacker)
                        : Optional.empty())
            .filter(id -> !id.equals(victimId))
            .filter(id -> draft.member(id).isPresent());
    var assists = new LinkedHashMap<CombatantId, Double>();
    shares.forEach(
        (id, share) -> {
          if (!id.equals(victimId)
              && killer.filter(id::equals).isEmpty()
              && share > 0
              && draft.member(id).isPresent()) {
            assists.put(id, share);
          }
        });
    killer.ifPresent(
        id -> {
          var by = draft.member(id).orElseThrow();
          scored(draft, by, by.score().kill());
          draft.effect(new MatchEffect.RecordStat(id, "Kills"));
          if (shares.getOrDefault(id, 0.0) <= DamageLog.STOLEN_SHARE && shares.containsKey(id)) {
            draft.tell(id, Notice.of(NoticeKind.STOLEN_KILL));
          }
        });
    assists.forEach(
        (id, share) -> {
          var by = draft.member(id).orElseThrow();
          var counts = share > DamageLog.STOLEN_SHARE && share < 1;
          scored(draft, by, by.score().assist(share, counts));
          if (counts) {
            draft.tell(
                id,
                Notice.of(NoticeKind.KILL_ASSIST, "share", tenths(Math.floor(share * 10) / 10)));
          }
        });
    if (killer.isPresent() && killerHealth.isPresent()) {
      draft.tell(
          victimId,
          Notice.of(NoticeKind.KILLER_HEALTH, "hearts", tenths(killerHealth.getAsDouble() / 2)));
    }
    var attribution = seen.withKiller(killer).withAssists(assists);
    if (witnessed) {
      draft.announce(deathNotice(draft, victimId, attribution));
    }
    draft.effect(new MatchEffect.Death(victimId, attribution));
    draft.damage = draft.damage.forget(victimId);
    return attribution;
  }

  /**
   * {@code by} now has {@code score}; each killstreak reward its new whole steps reach goes to them
   * while they are alive, as Red Warfare's {@code KillstreakManager} gave them.
   */
  private static void scored(Draft draft, Combatant by, Score score) {
    draft.put(by.scored(score));
    if (!by.alive()) {
      return;
    }
    for (var earned : Killstreak.earned(by.score().streak(), score.streak())) {
      draft.effect(new MatchEffect.KillstreakEarned(by.id(), earned));
    }
  }

  private static Notice deathNotice(Draft draft, CombatantId victimId, Attribution attribution) {
    var values = new HashMap<String, String>();
    values.put("template", attribution.cause().deathMessage());
    var victim = memberOrDeparted(draft, victimId);
    values.put("killed", victim.map(Combatant::name).orElse("?"));
    values.put("killedTeam", victim.flatMap(Combatant::team).map(Enum::name).orElse(""));
    var killer = attribution.killer().flatMap(id -> memberOrDeparted(draft, id));
    values.put("killer", killer.map(Combatant::name).orElse(""));
    values.put("killerTeam", killer.flatMap(Combatant::team).map(Enum::name).orElse(""));
    return Notice.of(NoticeKind.DEATH, values);
  }

  private static Optional<Combatant> memberOrDeparted(Draft draft, CombatantId id) {
    return draft
        .member(id)
        .or(() -> draft.departed().stream().filter(m -> m.id().equals(id)).findFirst());
  }

  /** One decimal place, without a trailing ".0": Red Warfare's {@code #.#}. */
  static String tenths(double value) {
    var rounded = Math.round(value * 10) / 10.0;
    return rounded == Math.rint(rounded) ? String.valueOf((long) rounded) : String.valueOf(rounded);
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
