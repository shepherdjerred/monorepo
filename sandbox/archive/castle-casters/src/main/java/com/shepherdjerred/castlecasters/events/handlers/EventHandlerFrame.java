package com.shepherdjerred.castlecasters.events.handlers;

import com.shepherdjerred.castlecasters.events.Event;
import lombok.Getter;

import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

/**
 * Used to easily add/remove multiple handlers all at once.
 */
@Getter
@SuppressWarnings("unchecked")
public class EventHandlerFrame<T extends Event> {

  private final Map<Class<T>, Set<EventHandler<T>>> handlers;

  public EventHandlerFrame() {
    this.handlers = new HashMap<>();
  }

  public <U extends T> void registerHandler(Class<U> eventClass, EventHandler<U> handler) {
    var existingHandlers = getHandlers((Class<T>) eventClass);
    existingHandlers.add((EventHandler<T>) handler);
    handlers.put((Class<T>) eventClass, existingHandlers);
  }

  public <U extends T> void removeHandler(Class<U> eventClass, EventHandler<U> handler) {
    handlers.getOrDefault(eventClass, new LinkedHashSet<>()).remove(handler);
  }

  private Set<EventHandler<T>> getHandlers(Class<T> eventClass) {
    return handlers.getOrDefault(eventClass, new LinkedHashSet<>());
  }
}
