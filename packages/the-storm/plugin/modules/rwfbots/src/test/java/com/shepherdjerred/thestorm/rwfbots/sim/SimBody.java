package com.shepherdjerred.thestorm.rwfbots.sim;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Levers;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Perception;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexContext;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexState;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.TacticsContext;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.TacticsState;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** One combatant in the sim: a body with simple physics and, for bots, the three brain layers. */
final class SimBody {

  final CombatantId id;
  final TeamId team;
  final Kit kit;

  /** Whether the brain layers drive this body; scripted bodies only move when the test says. */
  boolean bot;

  Vec3 pos;
  Vec3 previousPos;
  Facing look = Facing.SOUTH;
  double health = 20;
  double absorption = 0;
  double armor = 15;
  boolean alive = true;
  int heldSlot = 0;
  boolean sprinting;
  boolean onGround = true;
  boolean usingItem;
  long useStart = -1;
  boolean invisible;
  boolean disguised;
  long lastHurt = -1;
  int gapples = 3;
  Optional<Vec3> moveTarget = Optional.empty();
  long jumpTick = -100;

  Levers levers;
  Style style;
  Map<Role, Double> roleWeights = Map.of(Role.PLANT, 1.0, Role.ESCORT, 0.8, Role.DEFEND, 0.6);
  Perception perceiver;
  ReflexContext reflexContext;
  TacticsContext tacticsContext;
  PerceptionState perception = PerceptionState.EMPTY;
  TacticsState tactics = TacticsState.fresh(0);
  ReflexState reflex = ReflexState.initial(Facing.SOUTH);
  Optional<Decision> decision = Optional.empty();

  final List<BodyCommand> lastCommands = new ArrayList<>();
  final Map<CombatantId, Integer> attacksOn = new HashMap<>();
  final List<Decision> decisions = new ArrayList<>();

  SimBody(SimWorld.Spawn spawn) {
    this.id = new CombatantId(spawn.id());
    this.team = spawn.team();
    this.kit = spawn.kit();
    this.pos = spawn.pos();
    this.previousPos = spawn.pos();
  }

  CombatantView view(long tick) {
    return new CombatantView(
        id,
        team,
        disguised,
        kit,
        alive,
        pos,
        pos.minus(previousPos),
        look.yaw(),
        look.pitch(),
        Math.clamp(health, 0, 20),
        absorption,
        armor,
        heldSlot,
        sprinting,
        onGround,
        usingItem,
        invisible,
        lastHurt);
  }

  /** Applies {@code damage} through absorption, then health; returns whether it was fatal. */
  boolean hurt(double damage, long tick) {
    var fromAbsorption = Math.min(absorption, damage);
    absorption -= fromAbsorption;
    health -= damage - fromAbsorption;
    lastHurt = tick;
    if (health <= 0) {
      health = 0;
      alive = false;
      moveTarget = Optional.empty();
      return true;
    }
    return false;
  }

  int attacksOn(CombatantId target) {
    return attacksOn.getOrDefault(target, 0);
  }

  double distanceTo(Vec3 other) {
    return pos.distance(other);
  }
}
