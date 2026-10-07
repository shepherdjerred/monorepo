package com.shepherdjerred.thestorm.rwfbots.adapter.inference;

import com.shepherdjerred.thestorm.rwfbots.app.learning.ActorMatrix;
import com.shepherdjerred.thestorm.rwfbots.app.learning.RecurrentActor;
import java.util.List;

/** Shared native warmup for independently owned diagnostic and accepted actors. */
final class ActorWarmup {
  private ActorWarmup() {}

  static void run(RecurrentActor actor) {
    for (var rows : List.of(1, 3, 20, 100)) {
      var observation = new ActorMatrix(rows, 34, new float[rows * 34]);
      var hidden = new ActorMatrix(rows, 128, new float[rows * 128]);
      var cell = new ActorMatrix(rows, 128, new float[rows * 128]);
      for (var step = 0; step < 4; step++) {
        var output = actor.forward(new RecurrentActor.Input(observation, hidden, cell));
        hidden = output.hidden();
        cell = output.cell();
      }
    }
  }
}
