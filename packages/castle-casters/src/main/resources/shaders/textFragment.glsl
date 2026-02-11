#version 330 core

in VertexOutput {
    vec2 textureCoordinate;
} inputs;

layout (location = 0) out vec4 outColor;

uniform sampler2D texture_sampler;
uniform vec3 textColor;

// https://learnopengl.com/In-Practice/Text-Rendering
void main() {
    float alpha = texture(texture_sampler, inputs.textureCoordinate).r;
    vec4 sampled = vec4(1.0, 1.0, 1.0, alpha);
    outColor = vec4(textColor, 1.0) * sampled;
    if (outColor.a == 0) {
        discard;
    }
}
