package com.shepherdjerred.thestorm.rwfbots.domain.team;

import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Quirk;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import java.util.Map;
import java.util.Set;

/**
 * How well a bot suits a slot, 0..about 2: its archetype's taste for the kind of position, its
 * personality's role weights, its kit (bows like long sightlines) and the {@link Quirk#LOVES_NUKE}
 * quirk, which wants the slot that arms the nuke.
 */
public final class SlotFit {

  /** How much the archetype's taste counts against the personality's role weights. */
  static final double ARCHETYPE_WEIGHT = 0.6;

  static final double ROLE_WEIGHT = 0.4;
  static final double BOW_OVERWATCH = 0.3;
  static final double NUKE_LOVE = 0.6;

  private SlotFit() {}

  /**
   * Who is being fitted.
   *
   * @param archetype the personality's archetype
   * @param quirks its habits
   * @param roleWeights its role weights
   * @param kit the kit it plays
   * @param startDelayTicks how long its opening pause still lasts, or zero when ready
   */
  public record Member(
      Archetype archetype,
      Set<Quirk> quirks,
      Map<Role, Double> roleWeights,
      Kit kit,
      int startDelayTicks) {

    public Member {
      quirks = Set.copyOf(quirks);
      roleWeights = Map.copyOf(roleWeights);
      if (startDelayTicks < 0) {
        throw new IllegalArgumentException("start delay must be nonnegative");
      }
    }
  }

  /** The fit of {@code member} for {@code slot}; {@code nuke} says whether it arms the nuke. */
  public static double of(Member member, Slot slot, boolean nuke) {
    var maxWeight = member.roleWeights().values().stream().mapToDouble(d -> d).max().orElseThrow();
    var role = member.roleWeights().getOrDefault(slot.role(), 0.0) / maxWeight;
    var fit = ARCHETYPE_WEIGHT * taste(member.archetype(), slot.kind()) + ROLE_WEIGHT * role;
    if (member.kit().hasBow() && slot.kind() == SlotKind.OVERWATCH) {
      fit += BOW_OVERWATCH;
    }
    if (nuke && member.quirks().contains(Quirk.LOVES_NUKE)) {
      fit += NUKE_LOVE;
    }
    return fit;
  }

  /** How much an archetype likes a kind of slot, 0..1. */
  public static double taste(Archetype archetype, SlotKind kind) {
    return switch (archetype) {
      // Plant, escort, lane, flank, overwatch, anchor, sweep.
      case RUSHER -> pick(kind, 0.6, 0.5, 1.0, 0.4, 0.1, 0.1, 0.6);
      case LURKER -> pick(kind, 0.2, 0.2, 0.4, 1.0, 0.4, 0.3, 0.5);
      case SNIPER -> pick(kind, 0.1, 0.1, 0.3, 0.4, 1.0, 0.5, 0.2);
      case BOMB_DIVER -> pick(kind, 1.0, 0.5, 0.4, 0.3, 0.1, 0.1, 0.2);
      case ANCHOR -> pick(kind, 0.1, 0.3, 0.2, 0.1, 0.5, 1.0, 0.1);
      case TURTLE -> pick(kind, 0.1, 0.2, 0.1, 0.1, 0.6, 1.0, 0.1);
      case FLANKER -> pick(kind, 0.3, 0.2, 0.6, 1.0, 0.3, 0.1, 0.4);
      case SUPPORT -> pick(kind, 0.4, 1.0, 0.5, 0.2, 0.3, 0.4, 0.2);
      case DUELIST -> pick(kind, 0.3, 0.5, 0.9, 0.5, 0.1, 0.2, 0.8);
      case HUNTER -> pick(kind, 0.2, 0.3, 0.5, 0.5, 0.2, 0.1, 1.0);
      case TROLL -> 0.5;
      case TACTICIAN -> 0.6;
    };
  }

  /** The taste for {@code kind} out of one per kind, in the order plant to sweep. */
  private static double pick(SlotKind kind, double... byKind) {
    if (byKind.length != SlotKind.values().length) {
      throw new IllegalArgumentException("one taste per slot kind");
    }
    var index =
        switch (kind) {
          case PLANT -> 0;
          case ESCORT -> 1;
          case LANE -> 2;
          case FLANK -> 3;
          case OVERWATCH -> 4;
          case ANCHOR -> 5;
          case SWEEP -> 6;
        };
    return byKind[index];
  }
}
