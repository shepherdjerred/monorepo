package com.shepherdjerred.thestorm.rwfbots.sim;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static java.nio.charset.StandardCharsets.UTF_8;

import com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion.PromotionContract;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.List;
import org.jspecify.annotations.Nullable;

/** Original, fixed authored simulation regression evidence; never human or training data. */
public final class SimulationCapture implements AutoCloseable {
  private final FileChannel file;

  private SimulationCapture(Path output) throws IOException {
    file = FileChannel.open(output, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
  }

  record Header(
      String type,
      int schema,
      String contract,
      String source,
      boolean humanDemonstration,
      boolean trainingData) {}

  record Run(String type, int run, long seed, String red, String blue) {}

  record Tick(String type, int run, long tick, boolean ready, List<Body> bodies) {}

  record Body(
      int id,
      String team,
      String kit,
      double x,
      double z,
      boolean alive,
      List<Integer> attacks,
      String slot) {}

  record End(String type, int run, long tick, @Nullable Long contact, List<Metrics> measurements) {}

  record Metrics(
      String team, double widthAt8, double widthAtContact, double forwardBy10, double winding) {}

  record Complete(String type, int runs) {}

  public static void main(String[] args) throws IOException {
    if (args.length != 1)
      throw new IllegalArgumentException("one exclusive simulation journal path required");
    capture(Path.of(args[0]));
  }

  static void capture(Path output) throws IOException {
    var spec = SimulationContract.SPEC;
    try (var capture = new SimulationCapture(output)) {
      capture.row(
          new Header(
              "header", spec.version(), spec.contract(), "authored-simulation", false, false));
      var seed = (long) spec.firstSeed();
      var ordinal = 0;
      for (var red : Strategy.values()) {
        for (var blue : Strategy.values()) {
          capture.play(++ordinal, seed++, red, blue);
        }
      }
      capture.row(new Complete("complete", ordinal));
    }
  }

  private void play(int ordinal, long seed, Strategy red, Strategy blue) {
    var spec = SimulationContract.SPEC;
    var world = Arenas.yard(seed, spec.perTeam(), red, blue);
    var advance = new Advance(world);
    row(new Run("run", ordinal, seed, red.name(), blue.name()));
    world.run(
        spec.maximumTicks(),
        state -> {
          row(
              new Tick(
                  "tick",
                  ordinal,
                  state.tick,
                  !state.boards.isEmpty(),
                  state.bodies.values().stream().map(body -> body(state, body)).toList()));
          return advance.observe(state);
        });
    row(
        new End(
            "end",
            ordinal,
            world.tick,
            advance.contact().orElse(null),
            List.of(metrics(advance, RED), metrics(advance, BLUE))));
  }

  private static Body body(SimWorld world, SimBody body) {
    var slot = "";
    if (!world.boards.isEmpty()) {
      slot =
          world
              .boards
              .get(body.team)
              .plan()
              .slotOf(body.id)
              .map(value -> value.kind().name())
              .orElse("");
    }
    var attacks =
        body.lastCommands.stream()
            .filter(BodyCommand.Attack.class::isInstance)
            .map(command -> ((BodyCommand.Attack) command).target().value())
            .toList();
    return new Body(
        body.id.value(),
        body.team.value().toUpperCase(java.util.Locale.ROOT),
        body.kit.name(),
        body.pos.x(),
        body.pos.z(),
        body.alive,
        attacks,
        slot);
  }

  private static Metrics metrics(Advance advance, TeamId team) {
    return new Metrics(
        team.value().toUpperCase(java.util.Locale.ROOT),
        advance.spreadAt8(team),
        advance.spreadAtContact(team),
        advance.forwardBy(team),
        advance.winding(team));
  }

  private void row(Object value) {
    var bytes = (PromotionContract.JSON.writeValueAsString(value) + "\n").getBytes(UTF_8);
    var buffer = ByteBuffer.wrap(bytes);
    try {
      while (buffer.hasRemaining()) file.write(buffer);
      file.force(true);
    } catch (IOException failure) {
      throw new UncheckedIOException(failure);
    }
  }

  @Override
  public void close() throws IOException {
    file.close();
  }
}
