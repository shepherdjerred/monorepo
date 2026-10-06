package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.shepherdjerred.thestorm.rwf.app.ActionRefusal;
import com.shepherdjerred.thestorm.rwf.app.BotActions;
import com.shepherdjerred.thestorm.rwf.app.view.Point;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.MotionRecovery;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import java.util.List;
import java.util.Optional;
import java.util.function.Consumer;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;

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
      Consumer<BotBody> rewound) {}

  public BodyDriver(Parts parts) {
    this.bodies = parts.bodies();
    this.actions = parts.actions();
    this.world = parts.world();
    this.stimuli = parts.stimuli();
    this.rewound = parts.rewound();
  }

  /** Applies {@code commands} to {@code bot} at {@code tick}, resolving ids through {@code ids}. */
  public void apply(BotBody bot, List<BodyCommand> commands, IdMap ids, long tick) {
    var look = look(commands);
    look.ifPresent(facing -> bodies.look(bot.uuid(), (float) facing.yaw(), (float) facing.pitch()));
    for (var command : commands) {
      if (!(command instanceof BodyCommand.Look)) {
        apply(bot, command, new Frame(ids, tick, look));
      }
    }
  }

  /** The tick's fixed inputs. */
  private record Frame(IdMap ids, long tick, Optional<Facing> look) {}

  private void apply(BotBody bot, BodyCommand command, Frame frame) {
    var id = bot.uuid();
    switch (command) {
      case BodyCommand.Look(var yaw, var pitch) -> bodies.look(id, (float) yaw, (float) pitch);
      case BodyCommand.MoveToward(var waypoint, var sprint) ->
          move(bot, waypoint, sprint, frame.tick());
      case BodyCommand.Stop _ -> {
        bot.motion(MotionRecovery.State.INITIAL);
        bodies.stop(id);
      }
      case BodyCommand.Jump _ -> bodies.jump(id);
      case BodyCommand.Sneak(var sneaking) -> bodies.sneak(id, sneaking);
      case BodyCommand.SelectSlot(var slot) -> bodies.selectSlot(id, slot);
      case BodyCommand.Swing _ -> bodies.swing(id);
      case BodyCommand.Attack(var target) ->
          frame.ids().uuid(target).ifPresent(victim -> record(bot, actions.melee(id, victim)));
      case BodyCommand.StartUse _ -> startUse(bot, frame.tick());
      case BodyCommand.ReleaseUse _ -> releaseUse(bot, frame);
      case BodyCommand.CancelUse _ -> {
        bodies.stopUsing(bot.uuid(), false);
        bot.drawStart(-1);
      }
      case BodyCommand.ClickBomb(var bomb) ->
          frame.ids().bombName(bomb).ifPresent(name -> record(bot, actions.clickBomb(id, name)));
      case BodyCommand.UseAbility(var name) -> ability(bot, name);
    }
  }

  private void startUse(BotBody bot, long tick) {
    bodies.startUsing(bot.uuid());
    bot.drawStart(tick);
  }

  private void move(BotBody bot, Vec3 waypoint, boolean sprint, long tick) {
    bodies
        .entity(bot.uuid())
        .ifPresent(
            player -> {
              var position = Places.at(player);
              var step =
                  MotionRecovery.tick(
                      bot.motion(),
                      new Vec3(position.getX(), position.getY(), position.getZ()),
                      waypoint,
                      tick);
              bot.motion(step.state());
              bodies.moveToward(bot.uuid(), location(step.destination()), sprint);
              if (step.jump()) {
                bodies.jump(bot.uuid());
              }
              if (step.replan()) {
                bot.requestRecovery();
              }
            });
  }

  private void releaseUse(BotBody bot, Frame frame) {
    var active = bodies.activeItem(bot.uuid());
    if (active.isEmpty()) {
      bot.drawStart(-1);
      return;
    }
    var item = active.orElseThrow();
    if (item.type() == Material.BOW) {
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
