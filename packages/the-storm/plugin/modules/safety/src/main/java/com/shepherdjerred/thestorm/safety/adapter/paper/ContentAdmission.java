package com.shepherdjerred.thestorm.safety.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.safety.ContentSafety;
import com.shepherdjerred.thestorm.core.safety.ContentSubmission;
import java.util.UUID;
import java.util.function.Supplier;
import net.kyori.adventure.text.Component;
import org.bukkit.entity.Player;

/** Resumes approved operations on the main thread; listeners never wait on storage or HTTP. */
final class ContentAdmission {
  private final ModuleContext context;
  private final ContentSafety safety;

  ContentAdmission(ModuleContext context, ContentSafety safety) {
    this.context = context;
    this.safety = safety;
  }

  record Draft(String surface, String audience, String text, String components, String object) {}

  ContentSubmission submission(Player player, Draft draft) {
    return new ContentSubmission(
        new UUID(context.random().nextLong(), context.random().nextLong()),
        player.getUniqueId(),
        player.getName(),
        draft.surface(),
        draft.audience(),
        draft.text(),
        draft.components(),
        draft.object());
  }

  void publish(Player player, ContentSubmission submission, Supplier<String> publish) {
    var deadline = context.time().instant().plusSeconds(30);
    var _ =
        safety
            .check(submission)
            .whenCompleteAsync(
                (review, failure) -> {
                  if (failure != null) {
                    context
                        .logger()
                        .error(
                            "Content screening failed; submission {} remains unpublished",
                            submission.id(),
                            failure);
                    if (player.isOnline())
                      player.sendMessage(
                          Component.text(
                              "Screening is temporarily unavailable. Your attempt is saved; please try again. Reference "
                                  + submission.id()));
                    return;
                  }
                  String outcome;
                  if (!context.time().instant().isBefore(deadline)) outcome = "publication-expired";
                  else if (!player.isOnline()) outcome = "disconnected";
                  else if (!review.allowed()) {
                    outcome = review.decision();
                    reject(player, submission, review);
                  } else
                    outcome =
                        apply(
                            submission.id(),
                            () ->
                                com.shepherdjerred.thestorm.core.safety.ContentPublication.deliver(
                                    review.screened(), publish));
                  record(submission.id(), outcome);
                },
                context.scheduler().mainThread());
  }

  private String apply(UUID submission, Supplier<String> publish) {
    try {
      return publish.get();
    } catch (RuntimeException error) {
      context.logger().error("Approved content could not be applied: {}", submission, error);
      return "apply-failed";
    }
  }

  private void reject(
      Player player,
      ContentSubmission submission,
      com.shepherdjerred.thestorm.core.safety.ContentReview review) {
    player.sendMessage(
        Component.text(
            "This was not published ("
                + review.category()
                + "). "
                + review.reason()
                + " Reference "
                + submission.id()));
    if (review.category().equals("advertising")
        && review.decision().equals("block")
        && review.confidence() >= .98) record(submission.id(), "advertising-warned");
  }

  void record(UUID id, String outcome) {
    var _ =
        safety
            .finish(id, outcome)
            .exceptionally(
                failure -> {
                  context.logger().error("Could not persist content outcome {}", id, failure);
                  return null;
                });
  }

  void observe(ContentSubmission submission, String outcome) {
    var _ =
        safety
            .observe(submission, outcome)
            .exceptionally(
                failure -> {
                  context.logger().error("Evidence write failed: {}", submission.id(), failure);
                  return null;
                });
  }
}
