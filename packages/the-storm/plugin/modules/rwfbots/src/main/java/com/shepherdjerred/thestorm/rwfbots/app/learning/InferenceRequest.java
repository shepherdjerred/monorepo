package com.shepherdjerred.thestorm.rwfbots.app.learning;

import com.shepherdjerred.thestorm.rwfbots.domain.learning.ActionTicket;
import com.shepherdjerred.thestorm.rwfbots.domain.learning.CombatAction;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import java.util.List;
import java.util.UUID;

/** One fair body observation, captured on the main thread. */
public record InferenceRequest(Identity identity, long tick, double yaw, List<Double> observation) {
  public record Identity(UUID match, UUID body, int life, Kit kit) {
    public Identity {
      if (life < 0) throw new IllegalArgumentException("negative inference life");
    }
  }

  public InferenceRequest {
    observation = List.copyOf(observation);
    if (tick < 0 || !Double.isFinite(yaw) || observation.size() != RecurrentActor.FEATURES)
      throw new IllegalArgumentException("invalid inference observation context");
    for (var value : observation) {
      if (!Double.isFinite(value) || value < -1 || value > 1)
        throw new IllegalArgumentException("invalid fair observation value");
    }
  }

  public ActionTicket ticket(CombatAction action) {
    return new ActionTicket(identity.match(), identity.body(), identity.life(), tick, yaw, action);
  }
}
