package com.shepherdjerred.thestorm.companions.adapter.paper;

import com.shepherdjerred.thestorm.chat.app.ChatService;
import com.shepherdjerred.thestorm.chat.app.GlobalChat;
import com.shepherdjerred.thestorm.companions.domain.CompanionsConfig;
import com.shepherdjerred.thestorm.core.analytics.ProductAnalytics;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.safety.ContentSafety;
import com.shepherdjerred.thestorm.core.safety.ContentSubmission;
import java.util.UUID;
import java.util.function.BooleanSupplier;
import org.bukkit.entity.Player;

/** A player-conditioned model reply crosses admission before becoming public NPC speech. */
final class ConversationPublication {
  record Attempt(
      CompanionsConfig.Identity identity,
      Player body,
      Player requester,
      String text,
      BooleanSupplier available) {}

  private final ModuleContext context;

  ConversationPublication(ModuleContext context) {
    this.context = context;
  }

  void publish(Attempt attempt) {
    var safety = context.services().find(ContentSafety.class);
    if (safety.isEmpty()) {
      deliver(attempt);
      return;
    }
    var screening = safety.orElseThrow();
    var id = new UUID(context.random().nextLong(), context.random().nextLong());
    var submission =
        new ContentSubmission(
            id,
            attempt.body().getUniqueId(),
            attempt.identity().name(),
            "companion-reply",
            "global",
            attempt.text(),
            "",
            "requested-by:" + attempt.requester().getUniqueId());
    var _ =
        screening
            .check(submission)
            .whenCompleteAsync(
                (review, failure) -> {
                  if (failure != null) {
                    context.logger().error("Companion screening failed: {}", id, failure);
                    return;
                  }
                  var outcome = review.allowed() ? deliver(attempt) : "companion-withheld";
                  var _ =
                      screening
                          .finish(id, outcome)
                          .exceptionally(
                              error -> {
                                context
                                    .logger()
                                    .error("Companion publication receipt failed: {}", id, error);
                                return null;
                              });
                },
                context.scheduler().mainThread());
  }

  private String deliver(Attempt attempt) {
    if (!attempt.available().getAsBoolean() || !attempt.requester().isOnline())
      return "companion-stale";
    if (!context
        .services()
        .require(ChatService.class)
        .permitsNpcGlobal(attempt.body().getUniqueId(), attempt.identity().name(), attempt.text()))
      return "companion-denied-by-chat";
    context
        .services()
        .require(GlobalChat.class)
        .broadcastExternal("NPC", attempt.identity().name(), attempt.text());
    context
        .analytics()
        .interaction(attempt.requester().getUniqueId(), ProductAnalytics.Action.COMPANION_REPLIED);
    return "companion-delivered";
  }
}
