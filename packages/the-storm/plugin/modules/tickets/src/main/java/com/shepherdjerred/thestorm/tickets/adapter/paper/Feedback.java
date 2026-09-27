package com.shepherdjerred.thestorm.tickets.adapter.paper;

import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.tickets.domain.TicketError;
import net.kyori.adventure.text.Component;

/** The tickets module's replies, in the house style. */
final class Feedback {

  static final String LABEL = "Tickets";

  private Feedback() {}

  static Component info(String message) {
    return HouseStyle.info(LABEL, Component.text(message));
  }

  static Component success(String message) {
    return HouseStyle.success(LABEL, Component.text(message));
  }

  static Component error(String message) {
    return HouseStyle.error(LABEL, Component.text(message));
  }

  /** What to tell the sender when an operation fails this way. */
  static String describe(TicketError error) {
    return switch (error) {
      case TICKET_NOT_FOUND -> "No ticket has that id.";
      case ILLEGAL_TRANSITION -> "That ticket cannot move that way from here.";
    };
  }
}
