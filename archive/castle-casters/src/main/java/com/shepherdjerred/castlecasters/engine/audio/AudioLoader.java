package com.shepherdjerred.castlecasters.engine.audio;

import com.shepherdjerred.castlecasters.engine.resource.ByteBufferLoader;
import com.shepherdjerred.castlecasters.engine.resource.ResourceFileLocator;
import com.shepherdjerred.castlecasters.engine.resource.ResourceLoader;
import lombok.AllArgsConstructor;
import org.lwjgl.system.MemoryStack;

import java.nio.ShortBuffer;

import static org.lwjgl.openal.AL10.*;
import static org.lwjgl.stb.STBVorbis.stb_vorbis_decode_memory;
import static org.lwjgl.system.libc.LibCStdlib.free;

@AllArgsConstructor
public class AudioLoader implements ResourceLoader<AudioName, Audio> {

  private final ResourceFileLocator locator;
  private final ByteBufferLoader bufferLoader;

  @Override
  public Audio get(AudioName identifier) throws Exception {
    try (var stack = MemoryStack.stackPush()) {
      var channelsBuffer = stack.mallocInt(1);
      var sampleRateBuffer = stack.mallocInt(1);

      var file = locator.getAudioPath(identifier);
      var buffer = bufferLoader.load(file);
      ShortBuffer rawAudioBuffer = stb_vorbis_decode_memory(buffer,
          channelsBuffer,
          sampleRateBuffer);

      int channels = channelsBuffer.get();
      int sampleRate = sampleRateBuffer.get();

      int format = -1;
      if (channels == 1) {
        format = AL_FORMAT_MONO16;
      } else if (channels == 2) {
        format = AL_FORMAT_STEREO16;
      }

      int alBufferName = alGenBuffers();

      alBufferData(alBufferName, format, rawAudioBuffer, sampleRate);

      free(rawAudioBuffer);

      return new Audio(identifier,
          alBufferName,
          channels,
          sampleRate);
    }
  }
}
