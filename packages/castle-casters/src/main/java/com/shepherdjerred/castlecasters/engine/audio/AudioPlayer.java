package com.shepherdjerred.castlecasters.engine.audio;

import com.shepherdjerred.castlecasters.engine.events.audio.PlayAudioEvent;
import com.shepherdjerred.castlecasters.events.Event;
import com.shepherdjerred.castlecasters.events.EventBus;
import lombok.RequiredArgsConstructor;
import lombok.extern.log4j.Log4j2;
import org.lwjgl.openal.AL;
import org.lwjgl.openal.ALC;
import org.lwjgl.openal.ALCCapabilities;

import static org.lwjgl.openal.AL10.*;
import static org.lwjgl.openal.ALC10.*;

@Log4j2
@RequiredArgsConstructor
public class AudioPlayer {

  private final EventBus<Event> eventBus;
  private SourcedAudio currentAudio = null;
  private long device;
  private long context;

  public void initialize() {
    String defaultDeviceName = alcGetString(0, ALC_DEFAULT_DEVICE_SPECIFIER);
    device = alcOpenDevice(defaultDeviceName);

    int[] attributes = {0};
    context = alcCreateContext(device, attributes);
    alcMakeContextCurrent(context);

    ALCCapabilities alcCapabilities = ALC.createCapabilities(device);
    AL.createCapabilities(alcCapabilities);

    setupListener();
  }

  private void play(SourcedAudio sourcedAudio) {
    // TODO this could be better.
    if (currentAudio == null || sourcedAudio.audio().audioName() != currentAudio.audio()
        .audioName()) {
      currentAudio = sourcedAudio;
      log.info("Playing music");
      alSourcei(sourcedAudio.alSourceName(),
          AL_BUFFER,
          sourcedAudio.audio().alBufferName());
      alSourcePlay(sourcedAudio.alSourceName());
    } else {
      log.info("Skipping music since it's already playing.");
    }
  }

  private void setupListener() {
    eventBus.registerHandler(PlayAudioEvent.class,
        playAudioEvent -> play(playAudioEvent.audio()));
  }

  public void cleanup() {
    alcDestroyContext(context);
    alcCloseDevice(device);
  }
}
