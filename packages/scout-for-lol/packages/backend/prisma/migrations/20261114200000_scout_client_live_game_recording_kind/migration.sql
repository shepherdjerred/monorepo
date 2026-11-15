-- Scout Desktop uploads a finished game's local live-game recording as the
-- observation kind `live_game_recording`. The kind list is also a CHECK
-- constraint, so it is replaced with the same list plus the new kind. Existing
-- rows already satisfy the wider list.
ALTER TABLE "ScoutClientObservation" DROP CONSTRAINT "ScoutClientObservation_kind_check";
ALTER TABLE "ScoutClientObservation" ADD CONSTRAINT "ScoutClientObservation_kind_check" CHECK ("kind" IN ('account_profile', 'champion_mastery', 'challenges', 'clash', 'lobby', 'champ_select', 'gameflow', 'live_game_frame', 'live_game_recording', 'post_game', 'replay_status'));
