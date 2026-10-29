package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.shepherdjerred.thestorm.rwf.app.ActionRefusal;
import com.shepherdjerred.thestorm.rwf.app.BotActions;
import com.shepherdjerred.thestorm.rwf.app.WeaponUse;
import com.shepherdjerred.thestorm.rwf.app.view.Point;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ActiveJump;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.MotionRecovery;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementSafety;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import java.util.List;
import java.util.Optional;
import java.util.function.Consumer;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.inventory.meta.CrossbowMeta;

/**
 * Applies a tick's {@link BodyCommand}s to a bot's body, in order. Motion, looking, slots, swings
 * and holding right click go to the {@link Bodies}; everything the rules care about (attacks, fuse
 * clicks, arrows, the Rewind clock) goes through rwf's {@link BotActions}, never direct damage. A
 * released bow fires with the force vanilla gives its draw time, along the look the same tick asked
 * for. Main thread only.
 */
public final class BodyDriver {

  /** Vanilla stops counting draw force at this many ticks. */
  public static final int FULL_DRAW_TICKS = 20;

  /** Vanilla fires nothing under this force. */
  public static final double MIN_FORCE = 0.1;

  /** The ability name the tactics layer uses for the Rewind clock. */
  public static final String REWIND = "rewind";

  /** A golden apple finishes on its own within this many ticks of release. */
  static final int EAT_SLACK_TICKS = 4;

  private final Bodies bodies;
  private final BotActions actions;
  private final World world;
  private final StimulusCollector stimuli;
  private final Consumer<BotBody> rewound;
  private final com.shepherdjerred.thestorm.rwf.app.TacticalCasting casting;
  private Optional<BodyActivity> chat = Optional.empty();

  public void communication(BodyActivity communication) {
    chat = Optional.of(communication);
  }

  /**
   * What the driver needs.
   *
   * @param bodies the bodies
   * @param actions the rules' actions
   * @param world the match world
   * @param stimuli where a bot's own bow shot is reported
   * @param rewound told when a bot's Rewind landed, so its life epoch can move on
   */
  public record Parts(
      Bodies bodies,
      BotActions actions,
      World world,
      StimulusCollector stimuli,
      Consumer<BotBody> rewound,
      com.shepherdjerred.thestorm.rwf.app.TacticalCasting casting) {}

  /** A body slower than this across the ground, blocks a tick, is at rest. */
  static final double AT_REST = 0.02;

  /** The most ticks a body waits to come to rest for a kit use. */
  static final long BRACE_TICKS = 10;

  public BodyDriver(Parts parts) {
    this.bodies = parts.bodies();
    this.actions = parts.actions();
    this.world = parts.world();
    this.stimuli = parts.stimuli();
    this.rewound = parts.rewound();
    this.casting = parts.casting();
  }

  /** Applies {@code commands} to {@code bot} at {@code tick}, resolving ids through {@code ids}. */
  public void apply(BotBody bot, List<BodyCommand> commands, IdMap ids, long tick) {
    apply(bot, commands, new Navigation(ids, tick, Optional.empty()));
  }

  /** The active arena accompanies all production movement, including externally controlled bots. */
  public record Navigation(IdMap ids, long tick, Optional<GridBounds> bounds) {}

  public void apply(BotBody bot, List<BodyCommand> commands, Navigation navigation) {
    var fuse = commands.stream().anyMatch(command -> command instanceof BodyCommand.ClickBomb);
    if (fuse || bot.shieldUntil() > navigation.tick() || casting.stationary(bot.uuid())) {
      chat.ifPresent(talk -> talk.cancel(bot.uuid()));
    }
    if (typing(bot)) return;
    var look = look(commands);
    look.ifPresent(facing -> bodies.look(bot.uuid(), (float) facing.yaw(), (float) facing.pitch()));
    if (holdShield(bot, navigation.tick(), fuse)) return;
    if (braced(bot, navigation)) return;
    if (casting.stationary(bot.uuid())) {
      bodies.stop(bot.uuid());
      return;
    }
    var steeringAccepted = true;
    var frame = new Frame(navigation.ids(), navigation.tick(), look, navigation.bounds());
    for (var command : commands) {
      if (casting.stationary(bot.uuid())) {
        bodies.stop(bot.uuid());
        return;
      }
      if (!(command instanceof BodyCommand.Look)) {
        steeringAccepted = applyCommand(bot, command, frame, steeringAccepted);
        if (bot.shieldUntil() > navigation.tick()) {
          bodies.stop(bot.uuid());
          return;
        }
      }
    }
  }

  /**
   * A body breaking contact pulls shut the wooden door it has just come through while an enemy
   * follows it ({@link com.shepherdjerred.thestorm.rwfbots.domain.reflex.DoorShut}). Returns
   * whether it shut one.
   */
  public boolean shutDoorBehind(
      BotBody bot, com.shepherdjerred.thestorm.rwfbots.domain.reflex.DoorShut.Escape escape) {
    if (chat.filter(talk -> talk.typing(bot.uuid())).isPresent() || casting.stationary(bot.uuid()))
      return false;
    return bodies
        .entity(bot.uuid())
        .filter(player -> !player.isDead())
        .map(player -> WoodenDoors.shutBehind(player, escape))
        .orElse(false);
  }

  private boolean applyCommand(
      BotBody bot, BodyCommand command, Frame frame, boolean steeringAccepted) {
    if (command instanceof BodyCommand.MoveToward movement) return move(bot, movement, frame);
    if (command instanceof BodyCommand.Jump && !steeringAccepted) {
      bot.reflex(
          bot.reflex()
              .withActiveJump(
                  bot.reflex()
                      .activeJump()
                      .filter(
                          active ->
                              active.stage() != ActiveJump.Stage.AIRBORNE
                                  || active.launchTick() != frame.tick())));
      return false;
    }
    apply(bot, command, frame);
    return steeringAccepted;
  }

  private boolean typing(BotBody bot) {
    if (chat.filter(talk -> talk.typing(bot.uuid())).isEmpty()) return false;
    bodies.stop(bot.uuid());
    if (bot.drawStart() >= 0) {
      if (nativeUse(bot)) record(bot, actions.useWeapon(bot.uuid(), WeaponUse.CANCEL));
      else bodies.stopUsing(bot.uuid(), false);
      bot.drawStart(-1);
      bot.reflex(bot.reflex().withDrawStart(-1).withEating(-1, false));
    }
    return true;
  }

  private boolean holdShield(BotBody bot, long tick, boolean fuse) {
    if (bot.shieldUntil() <= 0) return false;
    var safe =
        bodies
            .entity(bot.uuid())
            .filter(player -> !player.isDead() && player.getHealth() > 6)
            .isPresent();
    if (!fuse && safe && bot.shieldUntil() > tick) {
      bodies.stop(bot.uuid());
      return true;
    }
    record(bot, actions.useWeapon(bot.uuid(), WeaponUse.CANCEL));
    bot.shieldUntil(0);
    return false;
  }

  /** The tick's fixed inputs. */
  private record Frame(IdMap ids, long tick, Optional<Facing> look, Optional<GridBounds> bounds) {}

  private void apply(BotBody bot, BodyCommand command, Frame frame) {
    var id = bot.uuid();
    switch (command) {
      case BodyCommand.Look(var yaw, var pitch) -> bodies.look(id, (float) yaw, (float) pitch);
      case BodyCommand.MoveToward movement -> move(bot, movement, frame);
      case BodyCommand.Stop _ -> {
        bot.motion(MotionRecovery.State.INITIAL);
        bodies.stop(id);
      }
      case BodyCommand.Jump _ -> bodies.jump(id);
      case BodyCommand.Sneak(var sneaking) -> bodies.sneak(id, sneaking);
      case BodyCommand.SelectSlot(var slot) -> bodies.selectSlot(id, emptyHandSlot(bot, slot));
      case BodyCommand.Swing _ -> bodies.swing(id);
      case BodyCommand.Attack(var target) ->
          frame
              .ids()
              .uuid(target)
              .ifPresent(
                  victim ->
                      record(
                          bot,
                          frame.ids().isSummon(target)
                              ? actions.strikeSummon(id, victim)
                              : actions.melee(id, victim)));
      case BodyCommand.StartUse _ -> startUse(bot, frame.tick());
      case BodyCommand.ReleaseUse _ -> releaseUse(bot, frame);
      case BodyCommand.CancelUse _ -> {
        if (nativeUse(bot)) {
          record(bot, actions.useWeapon(bot.uuid(), WeaponUse.CANCEL));
        } else {
          bodies.stopUsing(bot.uuid(), false);
        }
        bot.drawStart(-1);
      }
      case BodyCommand.ClickBomb(var bomb) ->
          frame.ids().bombName(bomb).ifPresent(name -> record(bot, actions.clickBomb(id, name)));
      case BodyCommand.UseAbility(var name) -> ability(bot, name);
      case BodyCommand.UseKit use -> useKit(bot, use, frame);
      case BodyCommand.UseStreak _ -> record(bot, actions.useStreak(id));
      case BodyCommand.Consume(var slot) -> record(bot, actions.consume(id, slot));
    }
  }

  private int emptyHandSlot(BotBody bot, int requested) {
    var loadout = bot.loadout();
    var unreserved =
        requested != loadout.swordSlot()
            && requested != loadout.bowSlot()
            && requested != loadout.gappleSlot()
            && requested != loadout.steakSlot()
            && requested != loadout.fuseSlot()
            && loadout.kitItems().stream().noneMatch(item -> item.slot() == requested);
    if (!bot.drafted().kit().isInvisibleKit() || !unreserved) return requested;
    return bodies
        .entity(bot.uuid())
        .map(
            player -> {
              for (var slot = 8; slot >= 0; slot--) {
                var item = player.getInventory().getItem(slot);
                if (item == null || item.getType().isAir()) return slot;
              }
              return requested;
            })
        .orElse(requested);
  }

  /**
   * Uses a kit item: an aimed one is used looking at its point, and the tick's own look is put back
   * after.
   */
  private void useKit(BotBody bot, BodyCommand.UseKit use, Frame frame) {
    if (needsRest(bot, use)) {
      bodies.stop(bot.uuid());
      bot.brace(Optional.of(new BotBody.Brace(use, frame.tick() + BRACE_TICKS)));
      return;
    }
    use.at().ifPresent(point -> lookAt(bot, point));
    var target = use.target().flatMap(frame.ids()::uuid);
    var at = use.at().map(point -> new Point(point.x(), point.y(), point.z()));
    var refusal = actions.useKit(bot.uuid(), use.slot(), target, at);
    record(bot, refusal);
    var shield =
        bodies
            .entity(bot.uuid())
            .map(player -> player.getInventory().getItem(use.slot()))
            .filter(item -> item.getType() == Material.SHIELD)
            .isPresent();
    if (shield && refusal.isEmpty()) {
      bot.shieldUntil(frame.tick() + 12);
      chat.ifPresent(talk -> talk.cancel(bot.uuid()));
    }
    if (use.at().isPresent()) {
      frame
          .look()
          .ifPresent(
              facing -> bodies.look(bot.uuid(), (float) facing.yaw(), (float) facing.pitch()));
    }
  }

  /**
   * Whether {@code use} must wait for the body to come to rest: a Tactician's horn winds up
   * standing still and any step breaks it, so a bot stops first, as a player lets go of the keys.
   */
  private boolean needsRest(BotBody bot, BodyCommand.UseKit use) {
    return bodies
        .entity(bot.uuid())
        .filter(player -> !player.isDead())
        .filter(
            player -> {
              var item = player.getInventory().getItem(use.slot());
              var velocity = player.getVelocity();
              return item != null
                  && item.getType() == Material.GOAT_HORN
                  && Math.hypot(velocity.getX(), velocity.getZ()) > AT_REST;
            })
        .isPresent();
  }

  /**
   * Holds a braced body still until it has come to rest, then makes the use it waited for; gives up
   * after {@link #BRACE_TICKS}. Returns whether the body was held this tick.
   */
  private boolean braced(BotBody bot, Navigation navigation) {
    var waiting = bot.brace();
    if (waiting.isEmpty()) return false;
    if (navigation.tick() > waiting.orElseThrow().until()) {
      bot.brace(Optional.empty());
      return false;
    }
    bodies.stop(bot.uuid());
    if (!needsRest(bot, waiting.orElseThrow().use())) {
      bot.brace(Optional.empty());
      useKit(
          bot,
          waiting.orElseThrow().use(),
          new Frame(navigation.ids(), navigation.tick(), Optional.empty(), navigation.bounds()));
    }
    return true;
  }

  private void lookAt(BotBody bot, Vec3 point) {
    bodies
        .entity(bot.uuid())
        .ifPresent(
            player -> {
              var eye = player.getEyeLocation();
              var facing = Facing.looking(new Vec3(eye.getX(), eye.getY(), eye.getZ()), point);
              bodies.look(bot.uuid(), (float) facing.yaw(), (float) facing.pitch());
            });
  }

  private void startUse(BotBody bot, long tick) {
    if (nativeUse(bot)) {
      var refusal = actions.useWeapon(bot.uuid(), WeaponUse.START);
      record(bot, refusal);
      bot.drawStart(refusal.isEmpty() ? tick : -1);
      if (refusal.isPresent()
          || bodies.entity(bot.uuid()).filter(Player::hasActiveItem).isEmpty()) {
        bot.reflex(bot.reflex().withDrawStart(-1));
      }
      return;
    }
    bodies.startUsing(bot.uuid());
    bot.drawStart(tick);
  }

  private boolean move(BotBody bot, BodyCommand.MoveToward movement, Frame frame) {
    return bodies
        .entity(bot.uuid())
        .map(
            player -> {
              var position = Places.at(player);
              var step =
                  MotionRecovery.tick(
                      bot.motion(),
                      new Vec3(position.getX(), position.getY(), position.getZ()),
                      movement.waypoint(),
                      frame.tick());
              bot.motion(step.state());
              var recovering = step.state().escapingUntil() > frame.tick();
              var hop = recovering ? Hop.WALK : movement.hop();
              var at = new Vec3(position.getX(), position.getY(), position.getZ());
              var checked =
                  recovering
                      ? escape(
                          bot,
                          MotionRecovery.escapes(step.state(), at, movement.waypoint()),
                          movement.sprint(),
                          frame)
                      : bodies.moveSafely(
                          bot.uuid(),
                          new Bodies.MotionTarget(
                              location(step.destination()),
                              movement.sprint(),
                              hop,
                              frame.bounds(),
                              bot.reflex()
                                  .activeJump()
                                  .filter(active -> active.stage() == ActiveJump.Stage.RUN_UP)
                                  .flatMap(active -> active.waypoint().launch())));
              if (step.jump() && !checked.refused()) {
                bodies.jump(bot.uuid());
              }
              var refusal = new Refusal(checked, hop, recovering);
              report(bot, refusal, frame.tick());
              if (step.replan()) {
                bot.requestMovementRecovery("STALLED", frame.tick());
              }
              if (step.replan() || checked.refused()) {
                bot.noteStuck(
                    snapshot(player, movement, refusal)
                        + bodies.lastRefusal(bot.uuid()).map(why -> "; why " + why).orElse(""),
                    frame.tick());
              }
              return !recovering
                  && (checked == MovementSafety.Reason.CLEAR
                      || checked == MovementSafety.Reason.REDIRECTED);
            })
        .orElse(false);
  }

  /** Takes the first escape step the body's movement gate allows, preferred first. */
  private MovementSafety.Reason escape(
      BotBody bot, List<Vec3> escapes, boolean sprint, Frame frame) {
    var reason = MovementSafety.Reason.BLOCKED;
    for (var target : escapes) {
      reason =
          bodies.moveSafely(
              bot.uuid(),
              new Bodies.MotionTarget(
                  location(target), sprint, Hop.WALK, frame.bounds(), Optional.empty()));
      if (!reason.refused()) return reason;
    }
    return reason;
  }

  /** What the body's last movement check said about the step it was asked to take. */
  private record Refusal(MovementSafety.Reason reason, Hop hop, boolean escaping) {}

  /**
   * Records a refused or redirected step with the primitive refused, so /rwfbots debug shows which
   * kind of step a body will not take (a DROP off a counter, a SWIM under a roof) and why.
   */
  private static void report(BotBody bot, Refusal refusal, long tick) {
    if (!refusal.reason().refused() && refusal.reason() != MovementSafety.Reason.REDIRECTED) return;
    bot.requestMovementRecovery(
        refusal.reason().name() + " " + refusal.hop() + (refusal.escaping() ? " escape" : ""),
        tick);
  }

  /**
   * The body's state when it refused or stalled on a step, for /rwfbots debug: where it stands and
   * how it moves, whether it is in a climbable block or water, and the waypoint it was given.
   */
  private static String snapshot(Player player, BodyCommand.MoveToward movement, Refusal refusal) {
    var at = Places.at(player);
    var feet = at.getBlock();
    var head = feet.getRelative(org.bukkit.block.BlockFace.UP);
    var below = feet.getRelative(org.bukkit.block.BlockFace.DOWN);
    var velocity = player.getVelocity();
    var target = movement.waypoint();
    return String.format(
        java.util.Locale.ROOT,
        "%s %s%s at %.2f,%.2f,%.2f vy %.2f fall %.1f%s%s%s; feet %s head %s below %s;"
            + " to %.1f,%.1f,%.1f",
        refusal.reason(),
        refusal.hop(),
        refusal.escaping() ? " escape" : "",
        at.getX(),
        at.getY(),
        at.getZ(),
        velocity.getY(),
        player.getFallDistance(),
        player.isFlying() ? " flying" : "",
        player.getAllowFlight() ? " may-fly" : "",
        player.hasGravity() ? "" : " no-gravity",
        feet.getType().getKey().getKey(),
        head.getType().getKey().getKey(),
        below.getType().getKey().getKey(),
        target.x(),
        target.y(),
        target.z());
  }

  private void releaseUse(BotBody bot, Frame frame) {
    if (nativeUse(bot)) {
      record(bot, actions.useWeapon(bot.uuid(), WeaponUse.RELEASE));
      bodies
          .entity(bot.uuid())
          .ifPresent(
              player -> {
                var held = player.getInventory().getItemInMainHand();
                if (held.getItemMeta() instanceof CrossbowMeta crossbow
                    && crossbow.hasChargedProjectiles()) {
                  record(bot, actions.useWeapon(bot.uuid(), WeaponUse.START));
                }
              });
      bot.drawStart(-1);
      return;
    }
    var active = bodies.activeItem(bot.uuid());
    if (active.isEmpty()) {
      bot.drawStart(-1);
      return;
    }
    var item = active.orElseThrow();
    if (item.type() == Material.BOW || item.type() == Material.CROSSBOW) {
      fire(bot, item, frame);
    } else if (item.type().isEdible()) {
      // Let a nearly finished apple go down; an interrupted one is dropped.
      var remaining = Math.max(0, 32 - item.usedTicks());
      bodies.stopUsing(bot.uuid(), remaining <= EAT_SLACK_TICKS);
    } else {
      bodies.stopUsing(bot.uuid(), false);
    }
    bot.drawStart(-1);
  }

  /** Ranged weapons use the server's actual draw, item and ammunition state. */
  private boolean nativeUse(BotBody bot) {
    return bodies
        .entity(bot.uuid())
        .map(
            player -> {
              var held = player.getInventory().getItemInMainHand();
              var type = held.getType();
              return type == Material.BOW
                  || type == Material.CROSSBOW
                  || type == Material.TRIDENT
                  || type == Material.WIND_CHARGE
                  || type == Material.SHIELD
                  || type.name().endsWith("_SPEAR");
            })
        .orElse(false);
  }

  private void fire(BotBody bot, Bodies.ActiveItem bow, Frame frame) {
    var drawn = bot.drawStart() < 0 ? bow.usedTicks() : frame.tick() - bot.drawStart();
    var force = force(drawn);
    bodies.stopUsing(bot.uuid(), false);
    if (force < MIN_FORCE) {
      return;
    }
    var direction =
        frame
            .look()
            .map(Facing::direction)
            .orElseGet(() -> currentLook(bot).map(Facing::direction).orElse(Vec3.ZERO));
    if (direction.isZero()) {
      return;
    }
    var refusal =
        actions.shootBow(bot.uuid(), new Point(direction.x(), direction.y(), direction.z()), force);
    record(bot, refusal);
    if (refusal.isEmpty()) {
      bodies.entity(bot.uuid()).ifPresent(stimuli::shot);
    }
  }

  private void ability(BotBody bot, String name) {
    if (!REWIND.equals(name)) {
      throw new IllegalArgumentException("unknown ability " + name);
    }
    var refusal = actions.useRewind(bot.uuid());
    record(bot, refusal);
    if (refusal.isEmpty()) {
      rewound.accept(bot);
    }
  }

  private static void record(BotBody bot, Optional<ActionRefusal> refusal) {
    refusal.ifPresent(bot::refused);
  }

  private Optional<Facing> currentLook(BotBody bot) {
    return bodies
        .entity(bot.uuid())
        .map(Places::at)
        .map(at -> new Facing(at.getYaw(), Math.clamp(at.getPitch(), -90, 90)));
  }

  private Location location(Vec3 point) {
    return new Location(world, point.x(), point.y(), point.z());
  }

  private static Optional<Facing> look(List<BodyCommand> commands) {
    Optional<Facing> look = Optional.empty();
    for (var command : commands) {
      if (command instanceof BodyCommand.Look(var yaw, var pitch)) {
        look = Optional.of(new Facing(yaw, pitch));
      }
    }
    return look;
  }

  /** Vanilla's arrow force for a bow held {@code drawTicks}: 0 at release, 1 from 20 ticks. */
  public static double force(long drawTicks) {
    var f = Math.clamp(drawTicks, 0, FULL_DRAW_TICKS) / 20.0;
    return Math.min(1, (f * f + f * 2) / 3);
  }
}
