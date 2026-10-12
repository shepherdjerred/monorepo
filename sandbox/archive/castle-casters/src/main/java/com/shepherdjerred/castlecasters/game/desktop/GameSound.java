package com.shepherdjerred.castlecasters.game.desktop;

import static org.lwjgl.openal.AL10.*;

import com.shepherdjerred.castlecasters.engine.audio.*;
import com.shepherdjerred.castlecasters.engine.resource.*;
import java.util.*;

/** Owns one source and the original music buffers for the entire application lifetime. */
final class GameSound implements AutoCloseable {
  private final Map<AudioName, Audio> tracks = new EnumMap<>(AudioName.class);
  private int source;
  private AudioName current;
  private boolean muted;

  GameSound(boolean muted) {
    this.muted = muted;
  }

  void initialize() throws Exception {
    var loader =
        new AudioLoader(
            new PathResourceFileLocator("/textures/", "/fonts/", "/audio/", "/maps/"),
            new ByteBufferLoader());
    for (var name : AudioName.values()) tracks.put(name, loader.get(name));
    source = alGenSources();
    alSourcef(source, AL_GAIN, muted ? 0 : .35f);
    play(AudioName.THEME_MUSIC);
  }

  boolean muted() {
    return muted;
  }

  void toggle() {
    muted = !muted;
    alSourcef(source, AL_GAIN, muted ? 0 : .35f);
  }

  void play(AudioName name) {
    if (current == name) return;
    alSourceStop(source);
    alSourcei(source, AL_BUFFER, tracks.get(name).alBufferName());
    alSourcei(source, AL_LOOPING, name == AudioName.THEME_MUSIC ? AL_TRUE : AL_FALSE);
    alSourcePlay(source);
    current = name;
  }

  public void close() {
    if (source != 0) {
      alSourceStop(source);
      alDeleteSources(source);
    }
    tracks.values().forEach(Audio::cleanup);
    tracks.clear();
  }
}
