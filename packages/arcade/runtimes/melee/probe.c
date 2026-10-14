/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Called by Module.onFrame on the game thread, after the previous simulation. */
#include "pc/compat.h"
#include <emscripten.h>
#include <melee/gm/gm_1A3F.h>
#include <melee/gm/gmresult.h>
#include <melee/gm/gmvs.h>
#include <melee/gm/types.h>
#include <melee/mn/types.h>
#include <melee/pl/player.h>
#include <dolphin/vi.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>

extern unsigned direct_scene_kind_value;
extern unsigned opensmash_preparation_state(void);
extern unsigned opensmash_intro_state(void);
static char json[8192];
static size_t used;

static void append(const char *format, ...) {
    va_list args;
    va_start(args, format);
    int written = vsnprintf(json + used, sizeof(json) - used, format, args);
    va_end(args);
    if (written < 0 || (size_t)written >= sizeof(json) - used) abort();
    used += (size_t)written;
}

EMSCRIPTEN_KEEPALIVE const char *arcade_melee_probe(void) {
    used = 0;
    const unsigned kind = direct_scene_kind_value;
    const unsigned mode = gm_GetCurrentGameMode();
    const int live = mode == GM_VS && (kind == GS_VS || kind == GS_SUDDEN_DEATH);
    const int results = mode == GM_VS && kind == GS_RESULTS;
    const int prepared = live && opensmash_preparation_state() == 4 &&
        opensmash_intro_state() != 1 && opensmash_intro_state() != 2;
    const struct StartMeleeRules *rules = live ? gm_GetStartMeleeRules() : NULL;
    const MatchEnd *end = results ? fn_80174274() : NULL;
    const int aborted = end && (gm_WasMatchCanceled(end->outcome) ||
        (end->outcome != OUTCOME_TIMEOUT && end->outcome != OUTCOME_ELIMINATION &&
         end->outcome != OUTCOME_TEAM_ELIMINATION));
    append("{\"version\":1,\"frame\":%u,\"scene\":%u,\"majorMode\":%u,"
           "\"prepared\":%s,\"aborted\":%s,\"matchKind\":%d,\"teams\":%s,\"stageId\":",
           VIGetRetraceCount(), kind, mode, prepared ? "true" : "false",
           aborted ? "true" : "false", rules ? rules->match_kind : end ? end->match_kind : -1,
           (rules ? rules->is_teams : end ? end->is_teams : 0) ? "true" : "false");
    if (live) append("%u", gm_GetStKind()); else append("null");
    append(",\"remainingMs\":");
    int seconds;
    if (live && gm_8016B110() && GetMatchTimer(&seconds))
        append("%d", seconds * 1000 + gm_8016AF0C() * 10);
    else append("null");
    append(",\"players\":[");
    int count = 0;
    for (int slot = 0; slot < 4 && (live || results); slot++) {
        const MatchPlayerData *player = end ? &end->player_standings[slot] : NULL;
        const int type = player ? player->pkind : Player_GetPlayerSlotType(slot);
        if (type == Gm_PKind_NA) continue;
        int kos = 0;
        for (int opponent = 0; opponent < GM_MAX_PLAYERS; opponent++)
            kos += player ? player->kills[opponent] : Player_GetKOsByPlayerIndex(slot, opponent);
        append("%s{\"slot\":%d,\"port\":%d,\"type\":%d,\"characterId\":%d,"
               "\"damage\":%d,\"stocks\":%d,\"kos\":%d,\"falls\":%d,\"selfDestructs\":%u,\"score\":",
               count++ ? "," : "", slot, live ? Player_GetPlayerId(slot) : slot, type,
               player ? player->ckind : Player_GetPlayerCharacter(slot),
               player ? player->percent : Player_GetDamage(slot),
               player ? player->stocks : Player_GetStocks(slot), kos,
               player ? player->x24 : Player_GetFalls(slot),
               player ? player->self_destructs : Player_GetSelfDestructs(slot));
        if (player) append("%d", player->score);
        else if (rules->match_kind == MatchKind_Time) append("%d", gm_GetMatchEndPlayerScore(slot));
        else append("null");
        append(",\"placement\":");
        if (player && !aborted) append("%u", (unsigned)player->is_big_loser + 1);
        else append("null");
        append("}");
    }
    append("]}");
    return json;
}
