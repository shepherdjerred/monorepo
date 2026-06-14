package com.shepherdjerred.castlecasters.server.event;

import com.shepherdjerred.castlecasters.common.player.Player;
import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.server.network.server.Connection;

public record PlayerJoinEvent(Player player, Connection connection) implements Event {

}
