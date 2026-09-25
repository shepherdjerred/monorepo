package com.shepherdjerred.thestorm.tracks.adapter.paper;

import java.time.Duration;
import java.time.InstantSource;
import org.bukkit.Server;

/**
 * The Paper services the commands use.
 *
 * @param server the server, for finding players
 * @param replies messages and main-thread completion
 * @param time the clock, for confirmations and cooldowns
 * @param confirmWindow how long a two-step confirmation stays open
 */
record Paper(Server server, Replies replies, InstantSource time, Duration confirmWindow) {}
