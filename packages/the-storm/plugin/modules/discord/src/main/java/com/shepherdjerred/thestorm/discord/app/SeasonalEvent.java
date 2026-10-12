package com.shepherdjerred.thestorm.discord.app;

/**
 * A seasonal event running now, rendered by the Discord relay without depending on the seasonal
 * module.
 *
 * @param title the event's name
 * @param until its last day, as players read it, such as {@code Nov 2}
 */
public record SeasonalEvent(String title, String until) {}
