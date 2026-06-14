package com.shepherdjerred.castlecasters.engine.events.handlers;

import com.shepherdjerred.castlecasters.engine.events.WindowResizeEvent;
import com.shepherdjerred.castlecasters.events.handlers.EventHandler;

import static org.lwjgl.opengl.GL11.glViewport;

public class OpenGlWindowResizeHandler implements EventHandler<WindowResizeEvent> {

  @Override
  public void handle(WindowResizeEvent windowResizeEvent) {
    var width = windowResizeEvent.newWindowSize().width();
    var height = windowResizeEvent.newWindowSize().height();
    glViewport(0, 0, width, height);
  }
}
