package com.shepherdjerred.castlecasters.engine.events.handlers;

import com.shepherdjerred.castlecasters.engine.events.ToggleDepthEvent;
import com.shepherdjerred.castlecasters.engine.graphics.OpenGlHelper;
import com.shepherdjerred.castlecasters.events.handlers.EventHandler;
import lombok.extern.log4j.Log4j2;

@Log4j2
public class ToggleDepthEventHandler implements EventHandler<ToggleDepthEvent> {

  private boolean isDepthEnabled = true;

  @Override
  public void handle(ToggleDepthEvent toggleDepthEvent) {
    isDepthEnabled = !isDepthEnabled;
    if (isDepthEnabled) {
      OpenGlHelper.enableDepthBuffer();
    } else {
      OpenGlHelper.disableDepthBuffer();
    }
    log.info("Depth: {}", isDepthEnabled);
  }
}
