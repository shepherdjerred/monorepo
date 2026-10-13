package com.shepherdjerred.thestorm.rwf.domain.record;

import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.poison.PoisonClock;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalDouble;
import java.util.TreeMap;
import java.util.regex.Pattern;

/**
 * The structured rows a schema 4 recording adds beside its events: world changes, projectiles,
 * abilities, effects, killstreaks, chat, the ballot, kills and a periodic pulse of the match. Each
 * names combatants only by pseudonym, and each carries the tick it happened on, counted from the
 * moment the match went live.
 */
public sealed interface Occurrence {

  /** A short machine name: lower-case letters, digits, dashes, dots, underscores or colons. */
  Pattern NAME = Pattern.compile("[a-z0-9][a-z0-9_.:-]{0,63}");

  /** Ticks since the match went live. */
  long tick();

  private static void checkTick(long tick) {
    if (tick < 0) {
      throw new IllegalArgumentException("tick must not be negative");
    }
  }

  private static void checkPseudonym(String pseudonym) {
    if (!RosterEntry.PSEUDONYM.matcher(pseudonym).matches()) {
      throw new IllegalArgumentException("pseudonym must be short lower-case alphanumeric");
    }
  }

  private static void checkName(String what, String name) {
    if (!NAME.matcher(name).matches()) {
      throw new IllegalArgumentException(what + " must be a short machine name: " + name);
    }
  }

  private static void checkFinite(double... values) {
    for (var value : values) {
      if (!Double.isFinite(value)) {
        throw new IllegalArgumentException("values must be finite");
      }
    }
  }

  /**
   * A block the match changed or put back.
   *
   * @param tick when
   * @param x block x
   * @param y block y
   * @param z block z
   * @param state the new block state, as Minecraft writes it ({@code minecraft:coal_block})
   * @param reason why it changed
   */
  record BlockChange(long tick, int x, int y, int z, String state, Reason reason)
      implements Occurrence {

    /** Why a block changed. */
    public enum Reason {
      /** A bomb's crater. */
      CRATER,
      /** The crater put back after the match. */
      REVERT,
      /** A temporary barricade. */
      BARRICADE,
      /** A planted banner. */
      BANNER,
    }

    public BlockChange {
      checkTick(tick);
      if (state.isBlank() || state.chars().anyMatch(Character::isWhitespace)) {
        throw new IllegalArgumentException("block state must be one word: " + state);
      }
    }
  }

  /**
   * A projectile leaving its shooter.
   *
   * @param tick when
   * @param shooter who fired it
   * @param kind what it is ({@code arrow}, {@code snowball})
   * @param x launch x
   * @param y launch y
   * @param z launch z
   * @param vx velocity x in blocks per tick
   * @param vy velocity y in blocks per tick
   * @param vz velocity z in blocks per tick
   */
  record Projectile(
      long tick,
      String shooter,
      String kind,
      double x,
      double y,
      double z,
      double vx,
      double vy,
      double vz)
      implements Occurrence {

    public Projectile {
      checkTick(tick);
      checkPseudonym(shooter);
      checkName("projectile kind", kind);
      checkFinite(x, y, z, vx, vy, vz);
    }
  }

  /**
   * A kit ability used.
   *
   * @param tick when
   * @param user who used it
   * @param ability the ability id ({@code rewind})
   * @param target the pseudonym, bomb id or spot it aimed at; empty when it had none
   */
  record AbilityUse(long tick, String user, String ability, Optional<String> target)
      implements Occurrence {

    public AbilityUse {
      checkTick(tick);
      checkPseudonym(user);
      checkName("ability", ability);
      target.ifPresent(t -> checkName("ability target", t));
    }
  }

  /**
   * A potion or status effect applied to a combatant.
   *
   * @param tick when
   * @param subject who has it
   * @param effect the effect id ({@code speed})
   * @param amplifier its level, from 0
   * @param durationTicks how long it lasts
   */
  record EffectApplied(long tick, String subject, String effect, int amplifier, int durationTicks)
      implements Occurrence {

    public EffectApplied {
      checkTick(tick);
      checkPseudonym(subject);
      checkName("effect", effect);
      if (amplifier < 0 || durationTicks < 0) {
        throw new IllegalArgumentException("amplifier and duration must not be negative");
      }
    }
  }

  /**
   * A killstreak reward earned.
   *
   * @param tick when
   * @param earner who earned it
   * @param streak the reward id ({@code compass}, {@code wolves})
   * @param kills the streak count that earned it
   */
  record Killstreak(long tick, String earner, String streak, int kills) implements Occurrence {

    public Killstreak {
      checkTick(tick);
      checkPseudonym(earner);
      checkName("streak", streak);
      if (kills < 1) {
        throw new IllegalArgumentException("a streak needs at least one kill");
      }
    }
  }

  /**
   * A chat line. A human's words are never recorded: only the channel and the length. A bot's line
   * is recorded in full, since it was generated, not written by a person.
   *
   * @param tick when
   * @param speaker who spoke
   * @param channel where ({@code global}, {@code team}, {@code dead})
   * @param length the line's length in characters
   * @param text the line itself, only for a bot
   */
  record Chat(long tick, String speaker, String channel, int length, Optional<String> text)
      implements Occurrence {

    public Chat {
      checkTick(tick);
      checkPseudonym(speaker);
      checkName("channel", channel);
      if (length < 1) {
        throw new IllegalArgumentException("a chat line has at least one character");
      }
      if (text.isPresent() && text.orElseThrow().length() != length) {
        throw new IllegalArgumentException("a recorded line's length must match its text");
      }
    }
  }

  /**
   * How the map vote came out. Votes are made before the match goes live, so the ballot is written
   * at tick 0 of the match it chose.
   *
   * @param tick when it was recorded
   * @param votes the candidates in ballot order with the votes each received
   * @param chosen the map the match is played on
   */
  record Ballot(long tick, List<Candidate> votes, String chosen) implements Occurrence {

    /** A map id: lower-case kebab-case. */
    static final Pattern MAP_ID = Pattern.compile("[a-z0-9]+(?:-[a-z0-9]+)*");

    /**
     * One candidate map.
     *
     * @param mapId the map
     * @param votes how many voted for it
     */
    public record Candidate(String mapId, int votes) {

      public Candidate {
        if (!MAP_ID.matcher(mapId).matches()) {
          throw new IllegalArgumentException("map id must be lower-case kebab-case: " + mapId);
        }
        if (votes < 0) {
          throw new IllegalArgumentException("votes must not be negative");
        }
      }
    }

    public Ballot {
      checkTick(tick);
      votes = List.copyOf(votes);
      if (votes.isEmpty()) {
        throw new IllegalArgumentException("a ballot has at least one candidate");
      }
      if (votes.stream().map(Candidate::mapId).distinct().count() != votes.size()) {
        throw new IllegalArgumentException("ballot candidates must be distinct");
      }
      if (votes.stream().noneMatch(candidate -> candidate.mapId().equals(chosen))) {
        throw new IllegalArgumentException("the chosen map must be a candidate: " + chosen);
      }
    }
  }

  /**
   * A combatant killed, with who is credited.
   *
   * @param tick when
   * @param victim who died
   * @param killer who gets the kill; empty for a death nobody caused
   * @param cause the attack type's name ({@code Melee}, {@code Bomb Exploded})
   * @param weapon what the killer held or fired ({@code iron_sword}, {@code arrow})
   * @param distance how far apart killer and victim were, in blocks
   * @param assists everyone else who hurt the victim, with their share of the damage (0 to 1]
   */
  record Kill(
      long tick,
      String victim,
      Optional<String> killer,
      String cause,
      Optional<String> weapon,
      OptionalDouble distance,
      Map<String, Double> assists)
      implements Occurrence {

    public Kill {
      checkTick(tick);
      checkPseudonym(victim);
      killer.ifPresent(Occurrence::checkPseudonym);
      if (cause.isBlank() || cause.contains("\t") || cause.contains("\n")) {
        throw new IllegalArgumentException("cause must be a plain name");
      }
      weapon.ifPresent(w -> checkName("weapon", w));
      if (distance.isPresent()
          && (!Double.isFinite(distance.getAsDouble()) || distance.getAsDouble() < 0)) {
        throw new IllegalArgumentException("distance must be finite and not negative");
      }
      assists = Map.copyOf(new TreeMap<>(assists));
      for (var assist : assists.entrySet()) {
        checkPseudonym(assist.getKey());
        var share = assist.getValue();
        if (!(share > 0 && share <= 1)) {
          throw new IllegalArgumentException("an assist share is in (0, 1]: " + share);
        }
      }
      if (assists.containsKey(victim) || killer.filter(assists::containsKey).isPresent()) {
        throw new IllegalArgumentException("neither victim nor killer assists their own kill");
      }
    }
  }

  /**
   * A periodic picture of the match, every {@link #EVERY_TICKS} ticks while it is live.
   *
   * @param tick when
   * @param alive living combatants per team
   * @param bombs every bomb's state, by bomb id
   * @param poison where the end-of-game poison is
   */
  record Pulse(
      long tick,
      Map<TeamColor, Integer> alive,
      Map<String, BombStatus> bombs,
      PoisonClock.Stage poison)
      implements Occurrence {

    /** Five seconds. */
    public static final int EVERY_TICKS = 100;

    /** A bomb id: lower-case kebab-case. */
    static final Pattern BOMB_ID = Pattern.compile("[a-z0-9][a-z0-9-]*");

    /** A bomb as the pulse sees it. */
    public enum BombStatus {
      IDLE,
      ARMING,
      ARMED,
      DEFUSING,
      DESTROYED,
    }

    public Pulse {
      checkTick(tick);
      if (alive.isEmpty()) {
        throw new IllegalArgumentException("a pulse names every team");
      }
      if (alive.values().stream().anyMatch(count -> count < 0)) {
        throw new IllegalArgumentException("alive counts must not be negative");
      }
      alive = Map.copyOf(new EnumMap<>(alive));
      for (var id : bombs.keySet()) {
        if (!BOMB_ID.matcher(id).matches()) {
          throw new IllegalArgumentException("bomb id must be lower-case kebab-case: " + id);
        }
      }
      bombs = Map.copyOf(new TreeMap<>(bombs));
    }

    /** Whether a pulse is due on {@code tick}. */
    public static boolean due(long tick) {
      return tick % EVERY_TICKS == 0;
    }
  }
}
