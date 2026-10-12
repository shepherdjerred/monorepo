package com.shepherdjerred.thestorm.rwfbots.domain.learning;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Levers;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Perception;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Sighting;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.Map;
import java.util.Optional;

/** Actor input uses perception alone for enemies: never hidden positions or enemy health. */
public final class FairObservation {
  private FairObservation() {}

  public static Map<Feature, Double> values(
      CombatantView self, Percept percept, VoxelGrid grid, Levers levers) {
    var values = new EnumMap<Feature, Double>(Feature.class);
    for (var feature : Feature.values()) values.put(feature, 0.0);
    var forward = new Facing(self.yaw(), 0).direction();
    var side = new Vec3(-forward.z(), 0, forward.x());
    values.put(Feature.HP, self.health());
    values.put(Feature.ABSORPTION, self.absorption());
    values.put(Feature.VELOCITY_FORWARD, self.vel().dot(forward));
    values.put(Feature.VELOCITY_SIDE, self.vel().dot(side));
    values.put(Feature.ON_GROUND, self.onGround() ? 1.0 : 0.0);
    values.put(Feature.USING_ITEM, self.usingItem() ? 1.0 : 0.0);
    values.put(Feature.SLOT, (double) self.heldSlot());
    values.put(
        Feature.HURT_RECENT,
        self.lastHurtTick() >= 0 && percept.tick() - self.lastHurtTick() <= 20 ? 1.0 : 0.0);
    values.put(Feature.AGGRESSION, levers.aggression());
    values.put(Feature.TECHNIQUE, levers.technique());
    var kit =
        switch (self.kit()) {
          case TROOPER -> Optional.of(Feature.KIT_TROOPER);
          case LONGBOW -> Optional.of(Feature.KIT_LONGBOW);
          case SHORTBOW -> Optional.of(Feature.KIT_SHORTBOW);
          case REWIND -> Optional.of(Feature.KIT_REWIND);
          default -> Optional.<Feature>empty();
        };
    kit.ifPresent(feature -> values.put(feature, 1.0));
    var visible = percept.nearestVisible();
    Optional<Sighting> target =
        visible.map(enemy -> new Sighting(enemy.pos(), enemy.vel(), percept.tick(), 1, true));
    if (target.isEmpty()) {
      target =
          percept.state().memory().sightings().values().stream()
              .filter(
                  sighting -> sighting.confidenceAt(percept.tick(), Perception.TAU_TICKS) >= 0.05)
              .min(
                  Comparator.comparingDouble(
                      sighting ->
                          sighting.predictedPos(percept.tick()).distanceSquared(self.pos())));
    }
    values.put(Feature.TARGET_VISIBLE, visible.isPresent() ? 1.0 : 0.0);
    target.ifPresent(
        sighting ->
            target(values, self, new Axes(forward, side), new Target(sighting, percept.tick())));
    for (var ray = 0; ray < 8; ray++) {
      var direction = new Facing(self.yaw() + ray * 45.0, 0).direction();
      var hit =
          grid.raycast(self.eye(), self.eye().plus(direction.scale(8)), VoxelGrid.Layer.MOVEMENT);
      var distance = hit.map(block -> block.center().distance(self.eye())).orElse(8.0);
      values.put(Feature.valueOf("RAY_" + ray), distance);
    }
    return Map.copyOf(values);
  }

  private record Axes(Vec3 forward, Vec3 side) {}

  private record Target(Sighting sighting, long tick) {}

  private static void target(
      Map<Feature, Double> values, CombatantView self, Axes axes, Target sighting) {
    var forward = axes.forward();
    var side = axes.side();
    var target = sighting.sighting();
    var now = sighting.tick();
    var relative = target.predictedPos(now).minus(self.pos());
    var distance = relative.length();
    values.put(Feature.TARGET_KNOWN, 1.0);
    values.put(Feature.TARGET_FORWARD, relative.dot(forward));
    values.put(Feature.TARGET_SIDE, relative.dot(side));
    values.put(Feature.TARGET_UP, relative.y());
    values.put(Feature.TARGET_DISTANCE, distance);
    values.put(Feature.TARGET_VELOCITY_FORWARD, target.vel().dot(forward));
    values.put(Feature.TARGET_VELOCITY_SIDE, target.vel().dot(side));
    var horizontal = relative.horizontal();
    if (!horizontal.isZero()) {
      values.put(Feature.TARGET_BEARING_SIN, horizontal.normalized().dot(side));
      values.put(Feature.TARGET_BEARING_COS, horizontal.normalized().dot(forward));
    }
    values.put(Feature.TARGET_AGE, (double) (now - target.tick()));
    values.put(Feature.TARGET_CONFIDENCE, target.confidenceAt(now, Perception.TAU_TICKS));
  }
}
