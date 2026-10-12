package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.app.store.MatchStats;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.domain.match.Ballot;
import com.shepherdjerred.thestorm.rwf.domain.match.Combatant;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect;
import com.shepherdjerred.thestorm.rwf.domain.match.Outcome;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalDouble;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * What the match itself does not keep but its statistics want: damage dealt and taken, bombs armed,
 * defused and set off, shots, steaks, Time Machine uses, distance walked, kit changes, and the
 * ordered event log. Reset as each match opens; read once as it ends. Kills, assists and deaths
 * come from the match. Main thread only.
 */
final class MatchLedger {

  /** One combatant's running counts. */
  private static final class Line {
    double dealt;
    double taken;
    int arms;
    int defuses;
    int explosions;
    int abilities;
    int shotsFired;
    int shotsHit;
    int steaks;
    int kitSwitches;
    double distance;
    boolean suicide;
    Optional<Vec3> last = Optional.empty();
  }

  private final Map<CombatantId, Line> lines = new HashMap<>();
  private final Map<String, Set<CombatantId>> armers = new HashMap<>();
  private final List<MatchStats.EventRow> events = new ArrayList<>();
  private Optional<String> armedBomb = Optional.empty();
  private Optional<String> ballot = Optional.empty();

  /** A new match opens. */
  void reset() {
    lines.clear();
    armers.clear();
    events.clear();
    armedBomb = Optional.empty();
    ballot = Optional.empty();
  }

  private Line line(CombatantId id) {
    return lines.computeIfAbsent(id, ignored -> new Line());
  }

  void kitSwitched(CombatantId id) {
    line(id).kitSwitches++;
  }

  void damaged(Optional<CombatantId> attacker, CombatantId victim, double amount) {
    line(victim).taken += amount;
    attacker.filter(a -> !a.equals(victim)).ifPresent(a -> line(a).dealt += amount);
  }

  void shot(CombatantId id) {
    line(id).shotsFired++;
  }

  void hit(CombatantId id) {
    line(id).shotsHit++;
  }

  void steak(CombatantId id) {
    line(id).steaks++;
  }

  void ability(CombatantId id) {
    line(id).abilities++;
  }

  /** A living fighter is at {@code at}: the distance from where they last stood is added. */
  void walked(CombatantId id, Vec3 at) {
    var line = line(id);
    line.last.ifPresent(
        last -> {
          var step = last.distanceTo(at);
          // A teleport (the Time Machine, the spawn) is not a walk.
          if (step < 10) {
            line.distance += step;
          }
        });
    line.last = Optional.of(at);
  }

  /** A bomb was armed; the armers the rules count next belong to it. */
  void bombArmed(String bombId, Instant at) {
    armedBomb = Optional.of(bombId);
    event(at, "arm", Subject.on(bombId), "{}");
  }

  /** The rules counted a stat such as {@code Armed} or {@code Defused}. */
  void stat(CombatantId id, String stat, Instant at) {
    switch (stat) {
      case "Armed" -> {
        line(id).arms++;
        armedBomb.ifPresent(bomb -> armers.computeIfAbsent(bomb, b -> new HashSet<>()).add(id));
      }
      case "Defused" -> {
        line(id).defuses++;
        event(at, "defuse", Subject.by(id), "{}");
      }
      default -> {}
    }
  }

  void exploded(String bombId, Instant at) {
    for (var armer : armers.getOrDefault(bombId, Set.of())) {
      line(armer).explosions++;
    }
    event(at, "explosion", Subject.on(bombId), "{}");
  }

  void ballotClosed(Ballot closed, Instant at) {
    var votes =
        closed.candidates().stream()
            .map(c -> quote(c.mapId()) + ":" + closed.count(c.mapId()))
            .collect(Collectors.joining(","));
    var candidates =
        closed.candidates().stream().map(c -> quote(c.mapId())).collect(Collectors.joining(","));
    var json =
        "{\"candidates\":["
            + candidates
            + "],\"votes\":{"
            + votes
            + "},\"chosen\":"
            + quote(closed.chosen().orElseThrow())
            + "}";
    ballot = Optional.of(json);
    event(at, "ballot", new Subject(Optional.empty(), closed.chosen()), json);
  }

  /** A death, with who killed whom with what. */
  void death(
      MatchEffect.Death death, Optional<String> killerKit, Optional<Vec3> where, Instant at) {
    var victim = death.victim();
    var attribution = death.attribution();
    if (attribution.killer().isEmpty()
        && (attribution.cause().equals(AttackType.SUICIDE)
            || attribution.cause().equals(AttackType.QUIT))) {
      line(victim).suicide = true;
    }
    var assists =
        attribution.assists().entrySet().stream()
            .map(e -> quote(e.getKey().uuid().toString()) + ":" + round(e.getValue()))
            .collect(Collectors.joining(","));
    var json =
        "{\"assists\":{"
            + assists
            + "}"
            + attribution.weapon().map(w -> ",\"weapon\":" + quote(w)).orElse("")
            + (attribution.distance().isPresent()
                ? ",\"distance\":" + round(attribution.distance().getAsDouble())
                : "")
            + "}";
    events.add(
        new MatchStats.EventRow(
            events.size(),
            at,
            "kill",
            attribution.killer().map(CombatantId::uuid),
            Optional.of(victim.uuid().toString()),
            killerKit,
            Optional.of(attribution.cause().name()),
            where.map(v -> OptionalDouble.of(v.x())).orElseGet(OptionalDouble::empty),
            where.map(v -> OptionalDouble.of(v.y())).orElseGet(OptionalDouble::empty),
            where.map(v -> OptionalDouble.of(v.z())).orElseGet(OptionalDouble::empty),
            json));
  }

  /** Who acted and what on, for an event row. */
  private record Subject(Optional<UUID> actor, Optional<String> target) {
    static Subject on(String target) {
      return new Subject(Optional.empty(), Optional.of(target));
    }

    static Subject by(CombatantId actor) {
      return new Subject(Optional.of(actor.uuid()), Optional.empty());
    }
  }

  private void event(Instant at, String kind, Subject subject, String data) {
    events.add(
        new MatchStats.EventRow(
            events.size(),
            at,
            kind,
            subject.actor(),
            subject.target(),
            Optional.empty(),
            Optional.empty(),
            OptionalDouble.empty(),
            OptionalDouble.empty(),
            OptionalDouble.empty(),
            data));
  }

  private static String quote(String value) {
    return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
  }

  private static String round(double value) {
    return String.format(Locale.ROOT, "%.3f", value);
  }

  /** The vote as written to the match row, once it closed. */
  Optional<String> ballot() {
    return ballot;
  }

  /**
   * The statistics of a finished match.
   *
   * @param humans every human who played, still in or departed
   * @param outcome how it ended, or empty for a stop
   * @param liveAt when it went live
   * @param endedAt when it ended
   */
  List<MatchStats.PlayerLine> players(
      List<Combatant> humans, Optional<Outcome> outcome, Instant liveAt, Instant endedAt) {
    var out = new ArrayList<MatchStats.PlayerLine>();
    for (var member : humans) {
      if (member.id().isBot() || member.team().isEmpty() || member.kit().isEmpty()) {
        continue;
      }
      var line = line(member.id());
      var result =
          outcome
              .filter(o -> !(o instanceof Outcome.Stopped))
              .filter(o -> member.leftAt().isEmpty() || member.diedAt().isPresent())
              .map(
                  o ->
                      o.winner().filter(member::onTeam).isPresent()
                          ? MatchStats.Result.WIN
                          : MatchStats.Result.LOSS)
              .orElse(MatchStats.Result.NONE);
      var gone = member.diedAt().or(member::leftAt).orElse(endedAt);
      var alive = gone.isBefore(liveAt) ? Duration.ZERO : Duration.between(liveAt, gone);
      out.add(
          new MatchStats.PlayerLine(
              member.id().uuid(),
              member.name(),
              member.kit().orElseThrow(),
              result,
              member.score().kills(),
              member.score().assists(),
              member.diedAt().isPresent() ? 1 : 0,
              line.suicide,
              member.score().streak(),
              line.dealt,
              line.taken,
              line.arms,
              line.defuses,
              line.explosions,
              line.abilities,
              line.shotsFired,
              line.shotsHit,
              line.steaks,
              alive,
              line.distance,
              line.kitSwitches));
    }
    return out;
  }

  List<MatchStats.EventRow> events() {
    return List.copyOf(events);
  }
}
