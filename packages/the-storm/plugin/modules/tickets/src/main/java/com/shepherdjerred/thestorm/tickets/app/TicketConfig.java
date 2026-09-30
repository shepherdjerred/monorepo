package com.shepherdjerred.thestorm.tickets.app;

import java.util.regex.Pattern;

/**
 * {@code plugins/TheStorm/tickets.yml}.
 *
 * @param pageSize how many tickets {@code /tickets} lists
 * @param serverId which server these tickets belong to, for example {@code survival}
 */
public record TicketConfig(int pageSize, String serverId) {

  private static final Pattern SERVER_ID = Pattern.compile("[a-z0-9-]{1,32}");

  public TicketConfig {
    if (pageSize < 1 || pageSize > 50) {
      throw new IllegalArgumentException("pageSize must be 1-50");
    }
    if (serverId == null || !SERVER_ID.matcher(serverId).matches()) {
      throw new IllegalArgumentException(
          "serverId must be 1-32 lowercase letters, digits, or dashes");
    }
  }
}
