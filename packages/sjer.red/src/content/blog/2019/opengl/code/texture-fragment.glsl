#version 330 core

vec2 textureCoord;

out vec4 outColor;

// Uses the bound texture
uniform sampler2D textureSampler;

void main() {
    outColor = texture(textureSampler, textureCoord);
}

