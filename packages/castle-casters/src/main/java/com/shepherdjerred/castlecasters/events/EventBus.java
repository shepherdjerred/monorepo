package com.shepherdjerred.castlecasters.events;

import com.shepherdjerred.castlecasters.events.handlers.EventHandler;
import com.shepherdjerred.castlecasters.events.handlers.EventHandlerFrame;

import java.util.*;

/**
 * Non-thread-safe event bus.
 */
@SuppressWarnings("unchecked")
public class EventBus<T extends Event> {

  private final Set<EventHandler<T>> genericHandlers;
  private final Map<Class<T>, Set<EventHandler<T>>> handlers;

  public EventBus() {
    this.genericHandlers = new LinkedHashSet<>();
    this.handlers = new LinkedHashMap<>();
  }

  public <U extends T> void register(Class<U> eventClass, EventHandler<U> handler) {
    registerHandler(eventClass, handler);
  }

  public <U extends T> void registerHandler(Class<U> eventClass, EventHandler<U> handler) {
    var existingHandlers = getHandlers((Class<T>) eventClass);
    existingHandlers.add((EventHandler<T>) handler);
    handlers.put((Class<T>) eventClass, existingHandlers);
  }

  public <U extends T> void remove(Class<U> eventClass, EventHandler<U> handler) {
    removeHandler(eventClass, handler);
  }

  public <U extends T> void removeHandler(Class<U> eventClass, EventHandler<U> handler) {
    handlers.getOrDefault(eventClass, new LinkedHashSet<>()).remove(handler);
  }

  public void register(EventHandler<T> handler) {
    registerHandler(handler);
  }

  public void registerHandler(EventHandler<T> handler) {
    genericHandlers.add(handler);
  }

  public void remove(EventHandler<T> handler) {
    removeHandler(handler);
  }

  public void removeHandler(EventHandler<T> handler) {
    genericHandlers.remove(handler);
  }

  public void register(EventHandlerFrame<T> handlerFrame) {
    registerHandlerFrame(handlerFrame);
  }

  public void registerHandlerFrame(EventHandlerFrame<T> handlerFrame) {
    handlerFrame.getHandlers()
        .forEach((type, handlers) -> handlers.forEach(handler -> registerHandler(type, handler)));
  }

  public void remove(EventHandlerFrame<T> handlerFrame) {
    removeHandlerFrame(handlerFrame);
  }

  public void removeHandlerFrame(EventHandlerFrame<T> handlerFrame) {
    handlerFrame.getHandlers()
        .forEach((type, handlers) -> handlers.forEach(handler -> removeHandler(type, handler)));
  }

  public void dispatch(T event) {
    var handlers = new LinkedHashSet<>(getHandlers((Class<T>) event.getClass()));
    handlers.forEach(handler -> handler.handle(event));

    var genericHandlersCopy = new LinkedHashSet<>(genericHandlers);
    genericHandlersCopy.forEach(handler -> handler.handle(event));
  }

  private Set<EventHandler<T>> getHandlers(Class<T> eventClass) {
    return handlers.getOrDefault(eventClass, new LinkedHashSet<>());
  }
}
