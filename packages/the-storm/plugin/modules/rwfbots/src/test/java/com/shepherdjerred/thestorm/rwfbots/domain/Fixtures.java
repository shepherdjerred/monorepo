package com.shepherdjerred.thestorm.rwfbots.domain;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverCurves;
import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverOffsets;
import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Levers;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Lines;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Personality;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Quirk;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Voice;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Builders for the value types tests need over and over. */
public final class Fixtures {

  public static final TeamId RED = new TeamId("red");
  public static final TeamId BLUE = new TeamId("blue");

  private Fixtures() {}

  /** A living, healthy trooper of {@code team} standing at {@code pos} facing south. */
  public static CombatantView combatant(int id, TeamId team, Vec3 pos) {
    return new CombatantView(
        new CombatantId(id),
        team,
        false,
        Kit.TROOPER,
        true,
        pos,
        Vec3.ZERO,
        0,
        0,
        20,
        0,
        15,
        0,
        false,
        true,
        false,
        false,
        -1);
  }

  public static Levers levers(double skill) {
    return LeverCurves.at(skill);
  }

  public static Personality personality(String id, String name, double skill) {
    return new Personality(
        id,
        name,
        "texture-value",
        "texture-signature",
        skill,
        Archetype.TACTICIAN,
        LeverOffsets.NONE,
        Map.of(Kit.TROOPER, 1.0),
        Map.of(Role.PLANT, 1.0, Role.ESCORT, 0.8, Role.DEFEND, 0.6),
        new Style(0.5, 0.5, 0.5, 0.5),
        new Voice(List.of("dry"), Voice.Verbosity.NORMAL, "short and dry"),
        lines(),
        Set.of(Quirk.ALWAYS_GG),
        List.of(),
        "A test bot.",
        1,
        false);
  }

  /** {@code base} with other kit and role weights. */
  public static Personality withWeights(
      Personality base, Map<Kit, Double> kits, Map<Role, Double> roles) {
    return new Personality(
        base.id(),
        base.name(),
        base.skinValue(),
        base.skinSignature(),
        base.skill(),
        base.archetype(),
        base.leverOffsets(),
        kits,
        roles,
        base.style(),
        base.voice(),
        base.lines(),
        base.quirks(),
        base.rivals(),
        base.bio(),
        base.batch(),
        base.retired());
  }

  /** {@code base} as another archetype. */
  public static Personality withArchetype(Personality base, Archetype archetype) {
    return new Personality(
        base.id(),
        base.name(),
        base.skinValue(),
        base.skinSignature(),
        base.skill(),
        archetype,
        base.leverOffsets(),
        base.kits(),
        base.roles(),
        base.style(),
        base.voice(),
        base.lines(),
        base.quirks(),
        base.rivals(),
        base.bio(),
        base.batch(),
        base.retired());
  }

  /** Two plain lines for every match moment and four for the lobby. */
  public static Lines lines() {
    var two = List.of("ok", "sure");
    return new Lines(two, two, two, two, two, two, two, two, two, lobby());
  }

  /** Four plain lobby lines. */
  public static List<String> lobby() {
    return List.of("hi", "ready", "which kit", "go {team}");
  }
}
