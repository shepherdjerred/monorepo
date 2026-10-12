package com.shepherdjerred.thestorm.tickets.adapter.discord;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.tickets.domain.TicketCategory;
import org.junit.jupiter.api.Test;

final class TicketDiscordCommandTest {

  @Test
  void categoriesAreReadByIdInAnyCase() {
    assertThat(TicketDiscordCommand.category(" Grief ")).contains(TicketCategory.GRIEF);
    assertThat(TicketDiscordCommand.category("appeal")).contains(TicketCategory.APPEAL);
    assertThat(TicketDiscordCommand.category("lag")).isEmpty();
  }
}
