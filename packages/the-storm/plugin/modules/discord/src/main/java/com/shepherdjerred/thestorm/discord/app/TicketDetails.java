package com.shepherdjerred.thestorm.discord.app;

/** Ticket data rendered by the Discord relay without depending on the tickets module. */
public record TicketDetails(
    long id,
    String category,
    String priority,
    String reporter,
    String summary,
    String staff,
    String evidence,
    String server) {}
