package com.shepherdjerred.thestorm.rwfbots.app.learning;

/** CPU inference port. Calls and resource closure belong on the owned compute pool. */
public interface RecurrentActor extends AutoCloseable {
  int FEATURES = 34;
  int HIDDEN = 128;
  int LOGITS = 17;

  record Input(ActorMatrix observation, ActorMatrix hidden, ActorMatrix cell) {
    public Input {
      shape(observation, observation.rows(), FEATURES);
      shape(hidden, observation.rows(), HIDDEN);
      shape(cell, observation.rows(), HIDDEN);
      for (var value : observation.values()) {
        if (value < -1 || value > 1) throw new IllegalArgumentException("unnormalized actor input");
      }
    }
  }

  record Output(ActorMatrix logits, ActorMatrix hidden, ActorMatrix cell) {
    public Output {
      shape(logits, logits.rows(), LOGITS);
      shape(hidden, logits.rows(), HIDDEN);
      shape(cell, logits.rows(), HIDDEN);
    }
  }

  Output forward(Input input);

  @Override
  void close();

  private static void shape(ActorMatrix tensor, int rows, int columns) {
    if (tensor.rows() != rows || tensor.columns() != columns)
      throw new IllegalArgumentException("actor tensor contract mismatch");
  }
}
