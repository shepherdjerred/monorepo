package com.shepherdjerred.thestorm.rwfbots.domain;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverCurves;
import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverOffsets;
import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Levers;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Chat;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Personality;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import java.util.List;
import java.util.Map;

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
        LeverOffsets.NONE,
        Map.of(Kit.TROOPER, 1.0),
        Map.of(Role.PLANT, 1.0, Role.ESCORT, 0.8, Role.DEFEND, 0.6),
        new Style(0.5, 0.5, 0.5, 0.5),
        new Chat(List.of("dry"), Chat.Verbosity.TERSE, List.of("gg")),
        "A test bot.",
        1,
        false);
  }
}
