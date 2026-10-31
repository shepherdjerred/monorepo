package com.shepherdjerred.thestorm.rwfbots.sim;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockClassification;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockShape;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.map.MapBaker;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavSites;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Sword fights on open ground under rwf's 1.8 combat, measured as the production recordings were:
 * how often a bot within 3.5 blocks of its nearest enemy faces more than 90 degrees away from it,
 * how often it lands a swing, how fast it closes as it swings and how often it is backing off, and
 * how soon a bot struck from behind swings back.
 */
@Tag("simulation")
final class ContactFightTest {

  /** A flat 64-block stone field. */
  private static final class Field implements BlockClassification {
    private final GridBounds bounds = new GridBounds(new BlockPos(0, 0, 0), 64, 6, 64);

    @Override
    public GridBounds bounds() {
      return bounds;
    }

    @Override
    public BlockShape shape(int x, int y, int z) {
      return y == 0 ? BlockShape.FULL : BlockShape.PASSABLE;
    }

    @Override
    public boolean blocksSight(int x, int y, int z) {
      return y == 0;
    }
  }

  private static final NavArtifact FIELD =
      MapBaker.bake("field", new Field(), new NavSites(List.of(), List.of()));

  private static final double CONTACT = 3.5;
  private static final int SEEDS = 40;
  private static final double SKILL = 0.65;

  /** What the bots did in contact. */
  static final class Contact {
    int fights;
    int botsDied;
    int foesDied;
    int ticks;
    int away;
    int attacks;

    /** Swings that dealt a blow, and swings into a hit window that blocked them. */
    int landed;

    int blocked;

    /** Swings that missed. */
    int swings;

    /** How fast each swinging bot was closing on its target, blocks a second. */
    final List<Double> closing = new ArrayList<>();

    /** Ticks from each sword blow a bot took to its first swing back at the striker. */
    final List<Integer> answers = new ArrayList<>();

    /** Bots struck, with their striker and the tick, awaiting their swing back. */
    private final Map<SimBody, Wait> pending = new HashMap<>();

    /** A struck bot's wait for its swing back. */
    private record Wait(SimBody striker, long since) {}

    /** Samples every bot of {@code world} this tick. */
    void sample(SimWorld world) {
      closeWaits(world);
      openWaits(world);
      for (var body : world.bodies.values()) {
        if (body.bot && body.alive)
          nearestEnemy(world, body).ifPresent(e -> sample(world, body, e));
      }
    }

    private static Optional<SimBody> nearestEnemy(SimWorld world, SimBody body) {
      return world.bodies.values().stream()
          .filter(other -> other.alive && !other.team.equals(body.team))
          .min(Comparator.comparingDouble(other -> other.pos.horizontalDistance(body.pos)));
    }

    private void sample(SimWorld world, SimBody body, SimBody enemy) {
      var toEnemy = enemy.pos.minus(body.pos).horizontal();
      if (toEnemy.length() > CONTACT || toEnemy.isZero()) return;
      ticks++;
      var facing = Facing.looking(Vec3.ZERO, toEnemy);
      if (Math.abs(((body.look.yaw() - facing.yaw()) % 360 + 540) % 360 - 180) > 90) away++;
      if (body.lastCommands.contains(new BodyCommand.Swing())) swings++;
      if (!body.lastCommands.contains(new BodyCommand.Attack(enemy.id))) return;
      attacks++;
      if (enemy.lastHurt == world.tick && enemy.struckBy.filter(body.id::equals).isPresent()) {
        landed++;
      } else if (enemy.lastHurt >= 0
          && world.tick - enemy.lastHurt < SimWorld.RWF_HIT_WINDOW_TICKS) {
        blocked++;
      }
      var moved = body.pos.minus(body.previousPos).horizontal();
      closing.add(moved.dot(toEnemy.normalized()) * 20);
    }

    /**
     * Closes the waits whose bot swung at its striker; a wait lasts 100 ticks, or until either
     * dies.
     */
    private void closeWaits(SimWorld world) {
      for (var it = pending.entrySet().iterator(); it.hasNext(); ) {
        var entry = it.next();
        var bot = entry.getKey();
        var striker = entry.getValue().striker();
        var waited = (int) (world.tick - entry.getValue().since());
        if (bot.lastCommands.contains(new BodyCommand.Attack(striker.id)) || waited >= 100) {
          answers.add(Math.min(waited, 100));
          it.remove();
        } else if (!bot.alive || !striker.alive) {
          it.remove();
        }
      }
    }

    /** Opens a wait on each bot struck this tick by a striker within 5 blocks: a sword blow. */
    private void openWaits(SimWorld world) {
      for (var body : world.bodies.values()) {
        var struck =
            body.bot && body.alive && body.struckTick == world.tick && !pending.containsKey(body);
        body.struckBy
            .filter(striker -> struck)
            .map(world.bodies::get)
            .filter(striker -> striker.pos.distance(body.pos) <= 5)
            .ifPresent(striker -> pending.put(body, new Wait(striker, world.tick)));
      }
    }

    double awayShare() {
      return (double) away / Math.max(1, ticks);
    }

    double blockedShare() {
      return (double) blocked / Math.max(1, attacks);
    }

    double landedRate() {
      return landed / Math.max(1e-9, ticks / 20.0);
    }

    double backingShare() {
      return (double) closing.stream().filter(speed -> speed < -1).count()
          / Math.max(1, closing.size());
    }

    @Override
    public String toString() {
      var answered = answers.stream().mapToInt(Integer::intValue).sorted().toArray();
      var quick = answers.stream().filter(waited -> waited <= 15).count();
      var sorted = closing.stream().mapToDouble(Double::doubleValue).sorted().toArray();
      var median = sorted.length == 0 ? 0 : sorted[sorted.length / 2];
      return String.format(
          "%d fights, bot died %d, foe died %d; missed swings %.2f/s, landed %.2f/s,"
              + " %.0f%% of swings blocked; contact %.0f s, facing away %.1f%%, attacks %.2f/s,"
              + " closing median %+.2f b/s, backing off on %.0f%% of attacks; %d blows answered"
              + " in a median %d ticks, %.0f%% within 15",
          fights,
          botsDied,
          foesDied,
          swings / Math.max(1e-9, ticks / 20.0),
          landedRate(),
          100 * blockedShare(),
          ticks / 20.0,
          100 * awayShare(),
          attacks / Math.max(1e-9, ticks / 20.0),
          median,
          100 * backingShare(),
          answered.length,
          answered.length == 0 ? -1 : answered[answered.length / 2],
          100.0 * quick / Math.max(1, answered.length));
    }
  }

  /**
   * Bot duels on open ground. Before, bots landed 0.06 blows a second in contact and were backing
   * off on 11% of their swings; now 0.31 and 7%.
   */
  @Test
  void botsInContactPressAndLandTheirBlows() {
    var duels = new Contact();
    for (var seed = 1L; seed <= SEEDS; seed++) duel(seed, false, duels);
    assertThat(duels.landedRate()).as("duels: %s", duels).isGreaterThan(0.2);
    assertThat(duels.backingShare()).as("duels: %s", duels).isLessThan(0.1);
  }

  /**
   * Six a side on the training yard. Before, bots in contact faced away from their nearest enemy
   * 15.4% of the time (production: 19%), landed 0.18 blows a second and were backing off on 27% of
   * their swings; now 11.5%, 0.31 and 21%.
   */
  @Test
  void botsInYardMatchesFaceTheEnemiesTheyMeet() {
    var contact = new Contact();
    for (var seed = 1L; seed <= 12; seed++) {
      var world =
          Arenas.yard(
              seed,
              6,
              com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy.RUSH,
              com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy.SPLIT);
      world.combat = SimWorld.Combat.RWF;
      for (var tick = 0; tick < 2400 && world.winner().isEmpty(); tick++) {
        world.step();
        contact.sample(world);
      }
    }
    assertThat(contact.awayShare()).as("yard: %s", contact).isLessThan(0.14);
    assertThat(contact.landedRate()).as("yard: %s", contact).isGreaterThan(0.25);
    assertThat(contact.backingShare()).as("yard: %s", contact).isLessThan(0.25);
  }

  /**
   * A bot struck from behind by an enemy that keeps after it swings back within 15 ticks in 37 of
   * 40 seeds (35 before).
   */
  @Test
  void aBotStruckFromBehindSwingsBack() {
    var latencies = new ArrayList<Integer>();
    for (var seed = 1L; seed <= SEEDS; seed++) latencies.add(struckFromBehind(seed));
    assertThat(latencies.stream().filter(ticks -> ticks <= 15).count())
        .as("counter-swing ticks %s", latencies)
        .isGreaterThanOrEqualTo(34);
  }

  /** Two bots, or a bot and a rusher, meeting on open ground. */
  private static void duel(long seed, boolean rusher, Contact contact) {
    var world = Brawl.world(FIELD, seed);
    var random = new SplittableRandom(seed * 13);
    var redAt = new Vec3(24.5 + random.nextInt(8), 1, 20.5 + random.nextInt(8));
    var angle = random.nextDouble() * 2 * Math.PI;
    var blueAt = redAt.plus(new Vec3(Math.cos(angle) * 8, 0, Math.sin(angle) * 8));
    var red = world.addBot(new SimWorld.Spawn(1, RED, Kit.TROOPER, redAt), SKILL);
    var blue =
        rusher
            ? world.addScripted(new SimWorld.Spawn(2, BLUE, Kit.TROOPER, blueAt))
            : world.addBot(new SimWorld.Spawn(2, BLUE, Kit.TROOPER, blueAt), SKILL);
    Brawl.face(red, blue);
    if (!rusher) Brawl.face(blue, red);
    for (var tick = 0; tick < 900 && red.alive && blue.alive; tick++) {
      if (rusher) Brawl.rush(world, blue, red);
      world.step();
      contact.sample(world);
    }
    contact.fights++;
    if (!red.alive) contact.botsDied++;
    if (!blue.alive) contact.foesDied++;
  }

  /**
   * A bot standing with its back to an enemy two blocks off that strikes it and keeps after it: the
   * ticks until the bot lands a swing on it, or 100.
   */
  private static int struckFromBehind(long seed) {
    var world = Brawl.world(FIELD, seed);
    var random = new SplittableRandom(seed * 7);
    var botAt = new Vec3(32.5, 1, 32.5);
    var bot = world.addBot(new SimWorld.Spawn(1, RED, Kit.TROOPER, botAt), SKILL);
    var behind = random.nextDouble() * Math.PI / 2 - Math.PI / 4;
    var attackerAt = botAt.plus(new Vec3(Math.sin(behind) * 2.2, 0, -Math.cos(behind) * 2.2));
    var attacker = world.addScripted(new SimWorld.Spawn(2, BLUE, Kit.TROOPER, attackerAt));
    // The bot looks south (+z); the attacker stands north of it, out of its field of view.
    bot.look = Facing.SOUTH;
    bot.reflex = com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexState.initial(bot.look);
    attacker.look = Facing.looking(attacker.pos.plus(0, 1.62, 0), bot.pos.plus(0, 1.3, 0));
    for (var tick = 0; tick < 5; tick++) world.step();
    world.scriptedHit(2, 1);
    var hitTick = world.tick;
    for (var tick = 0; tick < 100; tick++) {
      Brawl.rush(world, attacker, bot);
      world.step();
      if (bot.lastCommands.contains(new BodyCommand.Attack(attacker.id))) {
        return (int) (world.tick - hitTick);
      }
    }
    return 100;
  }
}
