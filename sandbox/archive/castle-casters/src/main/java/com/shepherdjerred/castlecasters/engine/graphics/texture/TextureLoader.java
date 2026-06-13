package com.shepherdjerred.castlecasters.engine.graphics.texture;

import com.shepherdjerred.castlecasters.engine.resource.ByteBufferLoader;
import com.shepherdjerred.castlecasters.engine.resource.ResourceFileLocator;
import com.shepherdjerred.castlecasters.engine.resource.ResourceLoader;
import lombok.ToString;
import lombok.extern.log4j.Log4j2;
import org.lwjgl.system.MemoryStack;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.IntBuffer;

import static org.lwjgl.opengl.GL11.*;
import static org.lwjgl.opengl.GL11C.GL_TEXTURE_2D;
import static org.lwjgl.stb.STBImage.stbi_image_free;
import static org.lwjgl.stb.STBImage.stbi_load_from_memory;

/**
 * Loads a texture.
 */
@Log4j2
@ToString
public class TextureLoader implements ResourceLoader<TextureName, Texture> {

  private final ResourceFileLocator resourceFileLocator;

  public TextureLoader(ResourceFileLocator resourceFileLocator) {
    this.resourceFileLocator = resourceFileLocator;
  }

  /**
   * Loads a texture from disk into memory.
   */
  public Texture get(TextureName textureName) throws IOException {
    var textureFilePath = resourceFileLocator.getTexturePath(textureName);
    var textureBuffer = new ByteBufferLoader().load(textureFilePath);

    int textureWidth;
    int textureHeight;
    int numberOfChannelsInTexture;

    ByteBuffer buffer;

    // Use stb to load the texture
    try (MemoryStack stack = MemoryStack.stackPush()) {
      IntBuffer stackTextureWidth = stack.mallocInt(1);
      IntBuffer stackTextureHeight = stack.mallocInt(1);
      IntBuffer stackNumberOfChannelsInTexture = stack.mallocInt(1);

      buffer = stbi_load_from_memory(textureBuffer,
          stackTextureWidth,
          stackTextureHeight,
          stackNumberOfChannelsInTexture,
          0);

      // Assign variables from data loaded by stb
      textureWidth = stackTextureWidth.get();
      textureHeight = stackTextureHeight.get();
      numberOfChannelsInTexture = stackNumberOfChannelsInTexture.get();
    }

    var openGlTextureId = sendToOpenGl(buffer, textureWidth, textureHeight);

    return new Texture(textureName,
        openGlTextureId,
        textureWidth,
        textureHeight,
        numberOfChannelsInTexture);
  }

  private int sendToOpenGl(ByteBuffer texture, int textureWidth, int textureHeight) {
    // Create and bind a new OpenGL texture
    int openGlTextureId = glGenTextures();
    glBindTexture(GL_TEXTURE_2D, openGlTextureId);

    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);

    // Set texture to be resized via nearest neighbor
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);

    // Send the texture data to OpenGL
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, textureWidth, textureHeight, 0,
        GL_RGBA, GL_UNSIGNED_BYTE, texture);

    // Unbind the texture
    glBindTexture(GL_TEXTURE_2D, 0);

    stbi_image_free(texture);

    return openGlTextureId;
  }
}
