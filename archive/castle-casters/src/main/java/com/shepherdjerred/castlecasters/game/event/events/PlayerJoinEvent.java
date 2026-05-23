package com.shepherdjerred.castlecasters.game.event.events;

import com.shepherdjerred.castlecasters.common.player.Player;
import com.shepherdjerred.castlecasters.events.Event;

public record PlayerJoinEvent(Player player) implements Event {
}
