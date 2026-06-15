package com.shepherdjerred.castlecasters.game.scenes.mainmenu;

import com.shepherdjerred.castlecasters.engine.audio.AudioName;
import com.shepherdjerred.castlecasters.engine.audio.SourcedAudio;
import com.shepherdjerred.castlecasters.engine.events.audio.PlayAudioEvent;
import com.shepherdjerred.castlecasters.engine.events.scene.SceneActiveEvent;
import com.shepherdjerred.castlecasters.engine.resource.ResourceManager;
import com.shepherdjerred.castlecasters.engine.scene.SceneAudio;
import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.events.EventBus;
import com.shepherdjerred.castlecasters.events.handlers.EventHandlerFrame;
import lombok.extern.log4j.Log4j2;

import java.util.HashMap;
import java.util.Map;

import static com.shepherdjerred.castlecasters.engine.audio.AudioName.THEME_MUSIC;
import static org.lwjgl.openal.AL10.alGenSources;

@Log4j2
public class MainMenuAudio implements SceneAudio {

  private final EventBus<Event> eventBus;
  private final ResourceManager resourceManager;
  private final Map<AudioName, SourcedAudio> audio;
  private final EventHandlerFrame<Event> handlerFrame;

  public MainMenuAudio(EventBus<Event> eventBus, ResourceManager resourceManager) {
    this.eventBus = eventBus;
    this.resourceManager = resourceManager;
    this.audio = new HashMap<>();
    this.handlerFrame = new EventHandlerFrame<>();
  }

  public void initialize() throws Exception {
    int sourcePointer = alGenSources();
    var sa = new SourcedAudio(resourceManager.get(THEME_MUSIC), sourcePointer);
    audio.put(THEME_MUSIC, sa);
    initializeHandlerFrame();
    eventBus.registerHandlerFrame(handlerFrame);
  }

  private void initializeHandlerFrame() {
    handlerFrame.registerHandler(SceneActiveEvent.class,
        sceneActiveEvent -> eventBus.dispatch(new PlayAudioEvent(audio.get(THEME_MUSIC))));
  }

  public void cleanup() {
    resourceManager.free(THEME_MUSIC);
    eventBus.removeHandlerFrame(handlerFrame);
  }
}
