package com.shepherdjerred.thestorm.agent.app;

import com.shepherdjerred.thestorm.agent.domain.AgentDecision;
import com.shepherdjerred.thestorm.agent.domain.DecisionAction;
import com.shepherdjerred.thestorm.agent.domain.DecisionDraft;
import com.shepherdjerred.thestorm.agent.domain.Offense;
import com.shepherdjerred.thestorm.agent.domain.Sampler;
import com.shepherdjerred.thestorm.core.safety.ContentReview;
import com.shepherdjerred.thestorm.core.safety.ContentSafety;
import com.shepherdjerred.thestorm.core.safety.ContentSubmission;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** The existing staff queue gets references, never copies of private submissions. */
public final class SafetyReviews {
  private final AgentServices services;

  public SafetyReviews(AgentServices services) {
    this.services = services;
  }

  public static CompletableFuture<Void> overturn(
      ContentSafety safety, AgentDecision decision, UUID staff) {
    if (!decision.classification().startsWith("safety-"))
      return CompletableFuture.completedFuture(null);
    return safety.overturn(reference(decision), staff);
  }

  static UUID reference(AgentDecision decision) {
    var fields = decision.note().split(" ", 5);
    if (fields.length < 4 || !fields[1].equals("evidence"))
      throw new IllegalStateException("Safety decision is missing its evidence reference");
    return UUID.fromString(fields[2]);
  }

  public CompletableFuture<Void> record(ContentSubmission submission, ContentReview review) {
    var sampled = Sampler.shouldSample(services.random(), services.config().reviewSamplePercent());
    if (review.allowed() && !sampled) return CompletableFuture.completedFuture(null);
    var offense =
        switch (review.category()) {
          case "hate" -> Offense.SLUR;
          case "harassment", "threat" -> Offense.HARASSMENT;
          case "advertising" -> Offense.ADVERTISING;
          case "spam" -> Offense.SPAM;
          case "none" -> Offense.OTHER;
          default -> throw new IllegalArgumentException("Unknown content category");
        };
    var action =
        review.muteSeconds() > 0
            ? DecisionAction.MUTE
            : review.allowed() ? DecisionAction.ALLOW : DecisionAction.ESCALATE;
    var draft =
        new DecisionDraft(
            submission.player(),
            offense,
            Optional.empty(),
            "safety-" + review.decision(),
            review.confidence(),
            review.model(),
            action,
            false,
            sampled,
            Optional.empty(),
            review.costMicros(),
            "safety-"
                + review.decision()
                + " evidence "
                + submission.id()
                + " surface="
                + submission.surface()
                + "; "
                + review.decision()
                + ". Private details require evidence permission.");
    return services.log().record(draft, services.time().instant()).thenAccept(saved -> {});
  }
}
