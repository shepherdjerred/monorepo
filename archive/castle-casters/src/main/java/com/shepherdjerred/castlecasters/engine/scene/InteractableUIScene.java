package com.shepherdjerred.castlecasters.engine.scene;

import com.shepherdjerred.castlecasters.engine.events.input.MouseButtonDownEvent;
import com.shepherdjerred.castlecasters.engine.events.input.MouseButtonUpEvent;
import com.shepherdjerred.castlecasters.engine.events.input.MouseMoveEvent;
import com.shepherdjerred.castlecasters.engine.resource.ResourceManager;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;
import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.events.EventBus;
import com.shepherdjerred.castlecasters.events.handlers.EventHandlerFrame;
import com.shepherdjerred.castlecasters.game.event.handlers.MouseDownClickableHandler;
import com.shepherdjerred.castlecasters.game.event.handlers.MouseMoveHoverableEventHandler;
import com.shepherdjerred.castlecasters.game.event.handlers.MouseUpClickableHandler;

public abstract class InteractableUIScene extends AbstractUIScene {

  protected final EventBus<Event> eventBus;
  private final EventHandlerFrame<Event> interactableHandlerFrame;

  public InteractableUIScene(WindowSize windowSize,
                             ResourceManager resourceManager,
                             SceneRenderer renderer,
                             EventBus<Event> eventBus) {
    super(resourceManager, windowSize, renderer);
    interactableHandlerFrame = new EventHandlerFrame<>();
    this.eventBus = eventBus;
    createEventHandlerFrame();
  }

  private void createEventHandlerFrame() {
    var mouseDownClickable = new MouseDownClickableHandler(this);
    var mouseUpClickable = new MouseUpClickableHandler(this);
    var mouseMoveHoverable = new MouseMoveHoverableEventHandler(this);

    interactableHandlerFrame.registerHandler(MouseButtonDownEvent.class, mouseDownClickable);
    interactableHandlerFrame.registerHandler(MouseButtonUpEvent.class, mouseUpClickable);
    interactableHandlerFrame.registerHandler(MouseMoveEvent.class, mouseMoveHoverable);
  }

  @Override
  public void initialize() throws Exception {
    super.initialize();
    eventBus.registerHandlerFrame(interactableHandlerFrame);
  }

  @Override
  public void cleanup() {
    super.cleanup();
    eventBus.removeHandlerFrame(interactableHandlerFrame);
  }
}
