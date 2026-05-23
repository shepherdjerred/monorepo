package com.shepherdjerred.castlecasters.game.network.discovery;

import com.shepherdjerred.castlecasters.events.Event;

import java.util.Optional;

public interface ServerDiscoverer extends Runnable {

  void discoverServers();

  void stop();

  Optional<Event> getEvent();
}
