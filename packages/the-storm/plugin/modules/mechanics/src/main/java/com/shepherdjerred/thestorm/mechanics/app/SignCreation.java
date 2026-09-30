package com.shepherdjerred.thestorm.mechanics.app;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.mechanics.domain.creation.CreationRequest;
import com.shepherdjerred.thestorm.mechanics.domain.creation.CreationRules;
import com.shepherdjerred.thestorm.mechanics.domain.grid.BlockGrid;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.grid.SignView;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Feature;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Mechanism;
import net.kyori.adventure.text.Component;

/**
 * Writing a mechanism sign. In order: the tag must name a mechanism, the feature must be switched
 * on, the writer must have its Mechanic level, land protection must let them build there, and the
 * sign must be built correctly. The first failure refuses the sign.
 */
public final class SignCreation {

  private final Gatekeeper gatekeeper;
  private final CreationRules rules;

  public SignCreation(Gatekeeper gatekeeper, CreationRules rules) {
    this.gatekeeper = gatekeeper;
    this.rules = rules;
  }

  /** What happened to a written sign. */
  public sealed interface Outcome {

    /** Ordinary text; nothing to do. */
    record Plain() implements Outcome {}

    /** A valid mechanism sign; the tag line is rewritten to {@link Mechanism#tag()}. */
    record Accepted(Mechanism mechanism) implements Outcome {}

    /** A mechanism sign that may not be written. */
    record Refused(Feature feature, Component reason) implements Outcome {}
  }

  /**
   * Judges the sign at {@code sign} with its new text.
   *
   * @param view the sign with its new text
   * @param grid the world around it
   * @param writer who wrote it
   */
  public Outcome create(Pos sign, SignView view, BlockGrid grid, Writer writer) {
    var parsed = view.mechanism();
    if (parsed.isEmpty()) {
      return new Outcome.Plain();
    }
    var mechanism = parsed.orElseThrow();
    var feature = mechanism.feature();
    var gate = gatekeeper.mayCreate(feature, writer::hasPermission);
    if (gate.isPresent()) {
      return new Outcome.Refused(feature, gate.orElseThrow());
    }
    if (writer.mayBuildHere() instanceof Decision.Denied(var reason)) {
      return new Outcome.Refused(feature, reason);
    }
    return rules
        .check(new CreationRequest(mechanism, sign, view, grid))
        .<Outcome>map(refusal -> new Outcome.Refused(feature, Component.text(refusal.message())))
        .orElseGet(() -> new Outcome.Accepted(mechanism));
  }
}
