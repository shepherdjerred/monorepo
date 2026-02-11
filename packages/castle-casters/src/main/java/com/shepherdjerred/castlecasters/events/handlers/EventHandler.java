package com.shepherdjerred.castlecasters.events.handlers;


import com.shepherdjerred.castlecasters.events.Event;

public interface EventHandler<T extends Event> {
  void handle(T event);
}
