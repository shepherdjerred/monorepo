// Create and bind a texture
glTextureName = glGenTextures();
glBindTexture(GL_TEXTURE_2D, glTextureName);

// Load a texture into the bound texture buffer
glTexImage2D(GL_TEXTURE_2D,
    0,
    GL_RGBA,
    width,
    height,
    0,
    GL_RGBA,
    GL_UNSIGNED_BYTE,
    imageData);
