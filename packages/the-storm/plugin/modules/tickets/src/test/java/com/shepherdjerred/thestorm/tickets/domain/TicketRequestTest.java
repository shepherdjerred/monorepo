package com.shepherdjerred.thestorm.tickets.domain;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import org.junit.jupiter.api.Test;

final class TicketRequestTest {

  private static TicketRequest ok(Result<TicketRequest, String> result) {
    return switch (result) {
      case Result.Ok<TicketRequest, String>(var value) -> value;
      case Result.Err<TicketRequest, String>(var error) ->
          throw new AssertionError("expected a request, got " + error);
    };
  }

  private static String err(Result<TicketRequest, String> result) {
    return switch (result) {
      case Result.Ok<TicketRequest, String>(var value) ->
          throw new AssertionError("expected an error, got " + value);
      case Result.Err<TicketRequest, String>(var error) -> error;
    };
  }

  @Test
  void plainTextFilesAnUncategorizedReport() {
    assertThat(ok(TicketRequest.parse("someone broke my wall")))
        .isEqualTo(new TicketRequest.File(TicketCategory.OTHER, "someone broke my wall"));
  }

  @Test
  void leadingCategoryWordNamesTheCategory() {
    assertThat(ok(TicketRequest.parse("grief someone broke my wall")))
        .isEqualTo(new TicketRequest.File(TicketCategory.GRIEF, "someone broke my wall"));
    assertThat(ok(TicketRequest.parse("CHAT spam in global")))
        .isEqualTo(new TicketRequest.File(TicketCategory.CHAT, "spam in global"));
  }

  @Test
  void loneCategoryWordStaysASummary() {
    assertThat(ok(TicketRequest.parse("grief")))
        .isEqualTo(new TicketRequest.File(TicketCategory.OTHER, "grief"));
  }

  @Test
  void actionsParseWithIds() {
    assertThat(ok(TicketRequest.parse("view 42"))).isEqualTo(new TicketRequest.View(42));
    assertThat(ok(TicketRequest.parse("claim 7"))).isEqualTo(new TicketRequest.Claim(7));
    assertThat(ok(TicketRequest.parse("escalate 7"))).isEqualTo(new TicketRequest.Escalate(7));
    assertThat(ok(TicketRequest.parse("reopen 7"))).isEqualTo(new TicketRequest.Reopen(7));
  }

  @Test
  void commentsNotesAndResolvesCarryText() {
    assertThat(ok(TicketRequest.parse("comment 7 more detail")))
        .isEqualTo(new TicketRequest.Comment(7, "more detail"));
    assertThat(ok(TicketRequest.parse("note 7 staff note")))
        .isEqualTo(new TicketRequest.Note(7, "staff note"));
    assertThat(ok(TicketRequest.parse("resolve 7 fixed")))
        .isEqualTo(new TicketRequest.Resolve(7, "fixed"));
    assertThat(ok(TicketRequest.parse("resolve 7"))).isEqualTo(new TicketRequest.Resolve(7, ""));
  }

  @Test
  void badIdsAndMissingTextExplainThemselves() {
    assertThat(err(TicketRequest.parse("view abc"))).isEqualTo("Ticket id must be a number.");
    assertThat(err(TicketRequest.parse("view"))).isEqualTo("Name a ticket id.");
    assertThat(err(TicketRequest.parse("comment 7"))).isEqualTo("Say something first.");
    assertThat(err(TicketRequest.parse("  ")))
        .isEqualTo("Say what happened, or name a ticket action.");
  }
}
