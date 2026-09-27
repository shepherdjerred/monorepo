package com.shepherdjerred.thestorm.tickets.domain;

import java.util.UUID;

/**
 * A comment being added, before it has an id.
 *
 * @param author who writes it
 * @param staffOnly whether only staff may see it
 * @param body what was said
 */
public record CommentDraft(UUID author, boolean staffOnly, String body) {
  public CommentDraft {
    if (body.isBlank() || body.length() > TicketComment.MAX_BODY_LENGTH) {
      throw new IllegalArgumentException(
          "body must be 1-" + TicketComment.MAX_BODY_LENGTH + " characters");
    }
  }
}
