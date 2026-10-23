package com.shepherdjerred.thestorm.rwf.domain.record;

import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import java.util.Locale;

/**
 * Something that happened, at tick resolution.
 *
 * @param tick ticks since the match went live
 * @param kind a short kind such as {@code died}, {@code armed}, {@code defused}, {@code exploded}
 * @param subject the pseudonym or bomb id it happened to
 * @param detail free text such as the killer's pseudonym or the attack type; may be empty
 */
public record RecordEvent(long tick, String kind, String subject, String detail) {

  /** The kind of the event a hit between members is recorded as; see {@link #hitDetail}. */
  public static final String HIT = "hit";

  /**
   * The kind of the event, at tick 0 with subject {@value #MATCH}, that names what a recording
   * writes beyond its rows' schema; its detail is a comma-separated list such as {@value
   * #CAPABILITY_HITS}. A reader treats a capability as absent unless this event names it, so a
   * recording written before the capability existed is not mistaken for one that saw none.
   */
  public static final String CAPABILITIES = "capabilities";

  /** The subject of a match-wide event such as {@value #CAPABILITIES}. */
  public static final String MATCH = "match";

  /** The capability of writing a {@value #HIT} event for every hit between members. */
  public static final String CAPABILITY_HITS = "hits";

  public RecordEvent {
    if (tick < 0) {
      throw new IllegalArgumentException("tick must not be negative");
    }
    if (kind.isBlank() || subject.isBlank()) {
      throw new IllegalArgumentException("kind and subject must not be blank");
    }
  }

  /**
   * The detail of one member's damage landing on another member, recorded as an event of kind
   * {@value #HIT} with the attacker's pseudonym as subject: {@code victim;class;cause;damage}. The
   * class is {@code projectile} or {@code melee} by the cause's flags ({@code other} for neither),
   * the cause is {@link AttackType#name()} and the damage is the health it took, to two decimals.
   * Arrows, crossbow bolts and tridents are all {@code projectile}; readers counting ranged contact
   * read the class.
   */
  public static String hitDetail(String victim, AttackType cause, double damage) {
    if (victim.isBlank() || victim.contains(";")) {
      throw new IllegalArgumentException("the hit victim must be a pseudonym: " + victim);
    }
    String type;
    if (cause.has(AttackType.Flag.PROJECTILE)) {
      type = "projectile";
    } else if (cause.has(AttackType.Flag.MELEE)) {
      type = "melee";
    } else {
      type = "other";
    }
    return String.join(";", victim, type, cause.name(), String.format(Locale.ROOT, "%.2f", damage));
  }
}
