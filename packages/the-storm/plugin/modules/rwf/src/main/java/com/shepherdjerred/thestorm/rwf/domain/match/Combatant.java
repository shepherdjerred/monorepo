package com.shepherdjerred.thestorm.rwf.domain.match;

import com.shepherdjerred.thestorm.rwf.domain.bomb.FuseBonus;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import java.time.Instant;
import java.util.Optional;

/**
 * Someone in a match.
 *
 * @param id who
 * @param name their name, for announcements
 * @param joinedAt when they joined
 * @param kit the kit they picked, or were given when the match started
 * @param team their team once the match has started
 * @param alive whether they are still fighting; false before the match starts and after death
 * @param fuse the bonus on their Bomb Fuse
 * @param diedAt when they died
 * @param leftAt when they left or disconnected
 * @param forfeited whether they threw the match away: a suicide or a quit while it was live
 * @param afk whether they have not looked around since the match went live (Red Warfare's AFK
 *     check); false before it starts
 */
public record Combatant(
    CombatantId id,
    String name,
    Instant joinedAt,
    Optional<String> kit,
    Optional<TeamColor> team,
    boolean alive,
    Optional<FuseBonus> fuse,
    Optional<Instant> diedAt,
    Optional<Instant> leftAt,
    boolean forfeited,
    boolean afk) {

  public Combatant {
    if (name.isBlank()) {
      throw new IllegalArgumentException("name must not be blank");
    }
  }

  /** A newly joined lobby member. */
  public static Combatant joining(CombatantId id, String name, Instant now) {
    return new Combatant(
        id,
        name,
        now,
        Optional.empty(),
        Optional.empty(),
        false,
        Optional.empty(),
        Optional.empty(),
        Optional.empty(),
        false,
        false);
  }

  public boolean onTeam(TeamColor color) {
    return team.filter(t -> t == color).isPresent();
  }

  Combatant withKit(String kitId) {
    return new Combatant(
        id, name, joinedAt, Optional.of(kitId), team, alive, fuse, diedAt, leftAt, forfeited, afk);
  }

  /**
   * Placed on a team and sent to fight with {@code kitId} and its fuse. Everyone starts the live
   * match AFK until they look around, as in Red Warfare.
   */
  Combatant fighting(TeamColor color, String kitId, Optional<FuseBonus> kitFuse) {
    return new Combatant(
        id,
        name,
        joinedAt,
        Optional.of(kitId),
        Optional.of(color),
        true,
        kitFuse,
        diedAt,
        leftAt,
        forfeited,
        true);
  }

  Combatant withFuse(FuseBonus bonus) {
    return new Combatant(
        id, name, joinedAt, kit, team, alive, Optional.of(bonus), diedAt, leftAt, forfeited, afk);
  }

  /** They looked around, so they are not AFK. */
  Combatant active() {
    return new Combatant(
        id, name, joinedAt, kit, team, alive, fuse, diedAt, leftAt, forfeited, false);
  }

  /**
   * Dead. A forfeit (a suicide or a quit) also clears AFK: the match is thrown away, not idled
   * through, as Red Warfare's {@code onAfkDeath} had it.
   */
  Combatant dead(Instant now, boolean forfeit) {
    return new Combatant(
        id,
        name,
        joinedAt,
        kit,
        team,
        false,
        fuse,
        Optional.of(now),
        leftAt,
        forfeited || forfeit,
        afk && !forfeit);
  }

  /** Gone from the match; leaving a live match forfeits its rewards. */
  Combatant left(Instant now, boolean forfeit) {
    return new Combatant(
        id,
        name,
        joinedAt,
        kit,
        team,
        false,
        fuse,
        diedAt,
        Optional.of(now),
        forfeited || forfeit,
        afk && !forfeit);
  }
}
