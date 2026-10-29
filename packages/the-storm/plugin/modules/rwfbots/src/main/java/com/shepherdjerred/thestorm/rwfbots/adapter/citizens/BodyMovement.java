package com.shepherdjerred.thestorm.rwfbots.adapter.citizens;

import com.shepherdjerred.thestorm.rwfbots.adapter.paper.Bodies;
import com.shepherdjerred.thestorm.rwfbots.adapter.paper.SnapshotCapture;
import com.shepherdjerred.thestorm.rwfbots.adapter.paper.TraversalCapture;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.FinalLandingRisk;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementMotor;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementSafety;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.RunUpSafety;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.SwimmingMotion;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import java.util.Objects;
import java.util.Optional;
import org.bukkit.entity.Player;
import org.bukkit.potion.PotionEffectType;
import org.bukkit.util.Vector;

/** Physical movement is checked after every planner, combat controller and recovery proposal. */
final class BodyMovement {
  private Optional<Flight> flight = Optional.empty();
  private Vec3 heading = Vec3.ZERO;

  /** The velocity this tick's steering started from, and the server tick it was taken on. */
  private Vec3 carried = Vec3.ZERO;

  private int carriedTick = -1;

  /** Whether the body is flying a hop it launched, which keeps a player's inputs until it lands. */
  private boolean hopping;

  private Optional<String> lastRefusal = Optional.empty();
  private final TraversalCapture survival;
  private final java.util.function.BiConsumer<Player, Vector> doors;
  private final java.util.function.BiPredicate<Player, org.bukkit.util.BoundingBox> collisions;

  BodyMovement(TraversalCapture survival) {
    this(survival, DoorUse::ahead);
  }

  /** Keeps the native interaction query independent from collision/motion adapter tests. */
  BodyMovement(TraversalCapture survival, java.util.function.BiConsumer<Player, Vector> doors) {
    this(survival, doors, Player::wouldCollideUsing);
  }

  /** Production always uses the actual entity collision context; tests provide its native seam. */
  BodyMovement(
      TraversalCapture survival,
      java.util.function.BiConsumer<Player, Vector> doors,
      java.util.function.BiPredicate<Player, org.bukkit.util.BoundingBox> collisions) {
    this.survival = survival;
    this.doors = doors;
    this.collisions = collisions;
  }

  private record Flight(Vec3 origin, Vec3 target, Hop hop, int started) {}

  private record Steering(
      Vec3 heading, boolean sprint, boolean leavingWater, Hop hop, boolean hopping) {
    Steering(Vec3 heading, boolean sprint, boolean leavingWater, Hop hop) {
      this(heading, sprint, leavingWater, hop, false);
    }
  }

  MovementSafety.Reason move(Player player, Bodies.MotionTarget target) {
    var position = feet(player);
    var destination = target.at();
    var goal = new Vec3(destination.getX(), destination.getY(), destination.getZ());
    var terrain = terrain(player, target.bounds());
    var hop = target.hop();
    if (BodyFluids.cancelsFall(player) || terrain.climbable(position)) player.setFallDistance(0);
    var bank = bankExit(terrain, position, goal, hop);
    if (bank.isPresent()) {
      goal = bank.orElseThrow();
      hop = Hop.JUMP;
    }
    // The centre check misses a body standing on a stair's half step or a block edge; such a body
    // kept a stale take-off origin, and every retried jump was judged from it and refused.
    var grounded = SnapshotCapture.onGround(player) || terrain.grounded(position);
    var tick = player.getServer().getCurrentTick();
    carry(player, tick, grounded || hop != Hop.WALK);
    var candidate = new Flight(position, goal, hop, tick);
    retainFlight(candidate, grounded);
    doors.accept(player, new Vector(goal.x() - position.x(), 0, goal.z() - position.z()));
    var checked =
        target.runUp().isPresent()
            ? runUp(player, target, terrain)
            : MovementSafety.choose(
                terrain,
                new MovementSafety.Request(
                    position, goal, hop, flight.map(Flight::origin), jumpRise(player)));
    if (checked.destination().isPresent()
        && !survives(player, terrain, checked.destination().orElseThrow(), hop))
      checked = new MovementSafety.Result(Optional.empty(), MovementSafety.Reason.UNSAFE_LANDING);
    if (checked.reason().refused())
      lastRefusal =
          Optional.of(
              checked.reason() == MovementSafety.Reason.UNSAFE_LANDING
                  ? "landing forecast refused"
                  : MovementSafety.explain(
                      terrain,
                      new MovementSafety.Request(
                          position, goal, hop, Optional.empty(), jumpRise(player))));
    beginFlight(candidate, checked.reason());
    if (checked.reason().refused()
        && hop == Hop.WALK
        && !grounded
        && !terrain.inWater(position)
        && !terrain.climbable(position)) {
      // In the air a walk cannot be steered anyway; stopping the body here only killed a jump in
      // mid-flight and landed it where it started. Vanilla keeps its momentum.
      return checked.reason();
    }
    heading = checked.destination().map(point -> point.minus(position)).orElse(Vec3.ZERO);
    steer(
        player,
        new Steering(
            heading,
            target.sprint(),
            bank.isPresent() && checked.destination().isPresent(),
            hop,
            hopping),
        terrain);
    return checked.reason();
  }

  private static MovementSafety.Result runUp(
      Player player, Bodies.MotionTarget target, MovementTerrain terrain) {
    var position = feet(player);
    var destination = target.at();
    var heading =
        new Vec3(destination.getX(), destination.getY(), destination.getZ()).minus(position);
    var next = accelerated(player, new Steering(heading, target.sprint(), false, Hop.WALK));
    var projected = position.plus(next.horizontal());
    var safe =
        target.hop() == Hop.WALK
            && SnapshotCapture.onGround(player)
            && RunUpSafety.permits(terrain, target.runUp().orElseThrow(), position, projected);
    return new MovementSafety.Result(
        safe ? Optional.of(projected) : Optional.empty(),
        safe ? MovementSafety.Reason.CLEAR : MovementSafety.Reason.BLOCKED);
  }

  private void retainFlight(Flight candidate, boolean grounded) {
    flight =
        flight.filter(
            previous ->
                !grounded
                    && previous.target().equals(candidate.target())
                    && previous.hop() == candidate.hop()
                    && candidate.started() - previous.started() <= 60);
  }

  private void beginFlight(Flight candidate, MovementSafety.Reason reason) {
    if (reason == MovementSafety.Reason.CLEAR
        && flight.isEmpty()
        && (candidate.hop() == Hop.LEAP
            || candidate.hop() == Hop.DROP
            || candidate.hop() == Hop.JUMP)) flight = Optional.of(candidate);
  }

  /** Why the last refused step was refused, for /rwfbots debug. */
  Optional<String> lastRefusal() {
    return lastRefusal;
  }

  /** Where the body last steered on purpose; a sprint jump boosts along it, not along knockback. */
  Vec3 heading() {
    return heading;
  }

  /**
   * A sprint jump along the heading this tick's steering took, from the speed the body carried into
   * the tick ({@link MovementMotor#hop}); the flight keeps a player's air input until it lands.
   */
  Vec3 hop(Player player) {
    var from = carriedTick == player.getServer().getCurrentTick() ? carried : velocity(player);
    hopping = true;
    return MovementMotor.hop(from, heading);
  }

  /**
   * Keeps the velocity this tick's steering starts from, which a hop launches from; a body that has
   * landed, or walks anything but a plain walk, is no longer flying a hop.
   */
  private void carry(Player player, int tick, boolean ended) {
    carried = velocity(player);
    carriedTick = tick;
    if (ended) hopping = false;
  }

  private static Vec3 velocity(Player player) {
    var velocity = player.getVelocity();
    return new Vec3(velocity.getX(), velocity.getY(), velocity.getZ());
  }

  void stop(Player player) {
    flight = Optional.empty();
    heading = Vec3.ZERO;
    hopping = false;
    steer(
        player, new Steering(Vec3.ZERO, false, false, Hop.WALK), terrain(player, Optional.empty()));
  }

  private MovementTerrain terrain(
      Player player, Optional<com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds> bounds) {
    return new MovementTerrain(
        player.getWorld(),
        bounds,
        body -> collisions.test(player, body),
        SnapshotCapture.onGround(player));
  }

  private static Optional<Vec3> bankExit(
      MovementTerrain terrain, Vec3 position, Vec3 goal, Hop hop) {
    if (!terrain.inWater(position)
        || ((hop == Hop.SWIM || hop == Hop.DROP) && goal.y() < position.y()))
      return Optional.empty();
    return terrain.bankExit(position, goal);
  }

  private boolean survives(Player player, MovementTerrain terrain, Vec3 goal, Hop hop) {
    var position = feet(player);
    if (hop == Hop.CLIMB && terrain.climbable(position)) return true;
    // A climb's step onto the top of a ladder (the cell above it) grabs the ladder as it drops
    // in, as the movement gate's grip does; it never falls past it.
    if (hop == Hop.CLIMB && (terrain.climbable(goal) || terrain.climbable(goal.plus(0, -1, 0))))
      return true;
    if (hop == Hop.CLIMB && !terrain.supported(goal, 0.1)) return false;
    if (hop == Hop.WALK) {
      var direction = goal.minus(position).horizontal();
      if (!direction.isZero())
        goal = position.plus(direction.normalized().scale(Math.min(0.9, direction.length())));
    }
    var contact = terrain.contact(goal);
    var tick = player.getServer().getCurrentTick();
    var capabilities = survival.survival(player, tick);
    var speed = player.getVelocity().getY();
    if (SnapshotCapture.onGround(player) && (hop == Hop.LEAP || hop == Hop.JUMP))
      speed = Math.max(speed, MovementMotor.JUMP_SPEED);
    var minimumTicks =
        (long) Math.ceil(position.horizontalDistance(contact) / MovementMotor.WALK_SPEED);
    var descent =
        new FinalLandingRisk.Descent(
            position.y() - contact.y(), speed, terrain.landing(goal), minimumTicks);
    return FinalLandingRisk.permits(
        descent, capabilities, player.getHealth() + player.getAbsorptionAmount(), tick);
  }

  private static void steer(Player player, Steering steering, MovementTerrain terrain) {
    var position = feet(player);
    var heading = steering.heading();
    var sprint = steering.sprint();
    var swimming = BodyFluids.inWater(player);
    player.setSprinting(sprint && !heading.horizontal().isZero());
    var next = accelerated(player, steering);
    if (swimming) {
      next =
          (steering.hop() == Hop.SWIM || (steering.hop() == Hop.DROP && heading.y() < 0))
              ? SwimmingMotion.directed(next, heading.y(), steering.leavingWater())
              : SwimmingMotion.buoyancy(
                  next, position.y(), terrain.waterSurface(position), steering.leavingWater());
    }
    if (terrain.climbable(position)) {
      // Vanilla holds a ladder or vine only while sneaking; a body not climbing slides down it.
      var climbing = steering.hop() == Hop.CLIMB || heading.y() > 0 || player.isSneaking();
      next =
          next.withY(
              climbing
                  ? Math.max(
                      next.y() > 0.2 ? next.y() : -0.15, MovementMotor.climbVertical(heading.y()))
                  : Math.max(next.y(), -0.15));
    }
    player.setVelocity(new Vector(next.x(), next.y(), next.z()));
  }

  private static Vec3 accelerated(Player player, Steering steering) {
    var velocity = player.getVelocity();
    var slowdown = player.hasActiveItem() ? 0.2 : player.isSneaking() ? 0.3 : 1.0;
    var control =
        new MovementMotor.Control(
            steering.heading(), steering.sprint(), SnapshotCapture.onGround(player), slowdown);
    var current = new Vec3(velocity.getX(), velocity.getY(), velocity.getZ());
    if (BodyFluids.inWater(player)) return MovementMotor.swim(current, control);
    return steering.hopping() && !control.onGround()
        ? MovementMotor.hopAir(current, control)
        : MovementMotor.steer(current, control);
  }

  /** How high this body's jump lifts it now, with the Jump Boost it actually has. */
  private static double jumpRise(Player player) {
    var boost = player.getPotionEffect(PotionEffectType.JUMP_BOOST);
    return MovementSafety.jumpRise(
        boost == null ? MovementSafety.NO_JUMP_BOOST : boost.getAmplifier());
  }

  private static Vec3 feet(Player player) {
    var location = Objects.requireNonNull(player.getLocation(), "a live bot has a location");
    return new Vec3(location.getX(), location.getY(), location.getZ());
  }
}
