package com.shepherdjerred.castlecasters.engine.events.handlers;

import com.shepherdjerred.castlecasters.engine.events.ToggleBlendingEvent;
import com.shepherdjerred.castlecasters.engine.graphics.OpenGlHelper;
import com.shepherdjerred.castlecasters.events.handlers.EventHandler;
import lombok.extern.log4j.Log4j2;

@Log4j2
public class ToggleBlendingEventHandler implements EventHandler<ToggleBlendingEvent> {

  private boolean isBlendingEnabled = true;

  @Override
  public void handle(ToggleBlendingEvent toggleBlendingEvent) {
    isBlendingEnabled = !isBlendingEnabled;
    if (isBlendingEnabled) {
      OpenGlHelper.enableTransparency();
    } else {
      OpenGlHelper.disableTransparency();
    }

    log.info("Blending: {}", isBlendingEnabled);
  }
}
