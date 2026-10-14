// PAL RMCP01 revision 0, WebCompiled b19270fb9c1590673528a52d34ce4afb780cbee5.
// Observe on the guest thread at the end of a presented game frame.
#include "memory.h"
#include <emscripten.h>
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <dolphin/pad.h>

namespace ArcadeMkw {
char json[8192];
size_t used;
void append(const char *format, ...) {
    va_list args;
    va_start(args, format);
    const int written = std::vsnprintf(json + used, sizeof(json) - used, format, args);
    va_end(args);
    if (written < 0 || static_cast<size_t>(written) >= sizeof(json) - used) std::abort();
    used += static_cast<size_t>(written);
}
void timer(uint32_t pointer) {
    if (!pointer || !Memory::Read8(pointer + 0xa)) { append("null"); return; }
    const uint32_t minutes = Memory::Read16(pointer + 4);
    const uint32_t seconds = Memory::Read8(pointer + 6);
    const uint32_t milliseconds = Memory::Read16(pointer + 8);
    if (seconds > 59 || milliseconds > 999) std::abort();
    append("%u", (minutes * 60 + seconds) * 1000 + milliseconds);
}
}

extern "C" EMSCRIPTEN_KEEPALIVE const char *arcade_mkw_probe(uint32_t frame) {
    using namespace ArcadeMkw;
    used = 0;
    const uint32_t config = Memory::Read32(0x809bd728);
    const uint32_t info = Memory::Read32(0x809bd730);
    append("{\"version\":1,\"frame\":%u,\"instance\":%u,", frame, info);
    if (!config || !info) {
        append("\"stage\":null,\"camera\":0,\"mode\":0,\"courseId\":null,"
               "\"engineClass\":null,\"mirror\":false,\"lapCount\":null,\"players\":[]}");
        return json;
    }
    // Verified against the translated constructor: scenario vtable at config+0x20,
    // twelve 0xf0 player records at config+0x28, settings at config+0xb68.
    const uint32_t scenario = config + 0x20;
    const uint32_t settings = config + 0xb68;
    const uint32_t playerCount = Memory::Read8(scenario + 4);
    if (playerCount > 12) std::abort();
    append("\"stage\":%u,\"camera\":%u,\"mode\":%u,\"courseId\":%u,"
           "\"engineClass\":%u,\"mirror\":%s,\"lapCount\":%u,\"players\":[",
           Memory::Read32(info + 0x28), Memory::Read32(settings + 0xc),
           Memory::Read32(settings + 8), Memory::Read32(settings),
           Memory::Read32(settings + 4), (Memory::Read32(settings + 0x28) & 1) ? "true" : "false",
           Memory::Read8(settings + 0x25));
    const uint32_t players = Memory::Read32(info + 0xc);
    const uint32_t timerManager = Memory::Read32(info + 0x14);
    for (uint32_t slot = 0; slot < playerCount; slot++) {
        const uint32_t setup = scenario + 8 + slot * 0xf0;
        const uint32_t player = Memory::Read32(players + slot * 4);
        if (!player) std::abort();
        const bool finished = (Memory::Read32(player + 0x38) & 2) != 0;
        append("%s{\"slot\":%u,\"port\":%d,\"type\":%u,\"characterId\":%u,"
               "\"vehicleId\":%u,\"lap\":%u,\"placement\":%u,\"finished\":%s,\"timeMs\":",
               slot ? "," : "", slot, static_cast<int8_t>(Memory::Read8(setup + 6)),
               Memory::Read32(setup + 0x10), Memory::Read32(setup + 0xc), Memory::Read32(setup + 8),
               Memory::Read16(player + 0x24), Memory::Read8(player + 0x20), finished ? "true" : "false");
        if (Memory::Read32(info + 0x28) < 2) append("null");
        else timer(finished ? Memory::Read32(player + 0x40) : timerManager ? timerManager + 4 : 0);
        append("}");
    }
    append("]}");
    return json;
}

EM_JS(int, arcade_mkw_override_pads, (PADStatus *statuses), {
    if (!Module.arcadePads) return 0;
    for (let port = 0; port < 4; port++) {
        const pad = Module.arcadePads[port];
        const offset = statuses + port * 12;
        HEAPU16[offset >>> 1] = pad[0];
        HEAP8[offset + 2] = pad[1]; HEAP8[offset + 3] = pad[2];
        HEAP8[offset + 4] = pad[3]; HEAP8[offset + 5] = pad[4];
        HEAPU8[offset + 6] = pad[5]; HEAPU8[offset + 7] = pad[6];
        HEAPU8[offset + 8] = 0; HEAPU8[offset + 9] = 0; HEAP8[offset + 10] = 0;
    }
    return 1;
});
