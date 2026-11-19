//! The desktop REST contract, generated from `desktop-api.contract.json`.

use scout_client_core::desktop_api::{DesktopApiErrorCode, DeviceScope};

include!(concat!(env!("OUT_DIR"), "/desktop_contract.rs"));

#[cfg(test)]
mod tests {
    use scout_client_core::desktop_api::{
        COACH_VOICE_TURNS_PATH, DESKTOP_CONTRACT_HEADER, DESKTOP_CONTRACT_VERSION,
        DEVICE_SCOPE_REQUESTS_PATH, DesktopApiContract, DeviceScope, EXPLORE_ASSETS_PATH,
        EXPLORE_CONVERSATIONS_GET_PATH, EXPLORE_CONVERSATIONS_LIST_PATH, EXPLORE_RUNS_ACTIVE_PATH,
        EXPLORE_RUNS_OUTCOME_PATH, EXPLORE_RUNS_START_PATH, EXPLORE_RUNS_STOP_PATH,
        EXPLORE_RUNS_STREAM_PATH, EXPLORE_STATUS_PATH, EXPLORE_VISUALIZATION_PATH,
        PAIRINGS_V2_PATH, RouteResponseKind,
    };

    use super::{
        CONTRACT_HEADER, CONTRACT_VERSION, MINIMUM_CONTRACT_VERSION, NATIVE_VISUALIZATION_KINDS,
        Route, SPEECH_ENCODING, SPEECH_MAX_CHUNK_BYTES, SPEECH_SAMPLE_RATE_HZ, STREAM_EVENT_TYPES,
        VOICE_MAX_DURATION_MS, VOICE_MEDIA_TYPE, VOICE_MIN_DURATION_MS, VOICE_SAMPLE_RATE_HZ,
        VOICE_TURN_ERROR_CODES, VOICE_TURN_EVENT_TYPES, VOICE_TURN_TRIGGERS, refusal_status,
    };

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    const CONTRACT: &str =
        include_str!("../../../../data/src/scout-client/desktop-api.contract.json");

    #[test]
    fn the_generated_table_matches_the_contract_file() -> TestResult {
        let contract: DesktopApiContract = serde_json::from_str(CONTRACT)?;
        assert_eq!(CONTRACT_VERSION, contract.contract_version);
        assert_eq!(MINIMUM_CONTRACT_VERSION, contract.minimum_contract_version);
        assert_eq!(CONTRACT_HEADER, contract.header);
        assert_eq!(Route::ALL.len(), contract.routes.len());
        for route in Route::ALL {
            let declared = contract.routes.get(route.name()).ok_or(route.name())?;
            assert_eq!(route.path(), declared.path);
            assert_eq!(route.scope(), declared.scope);
            assert_eq!(
                route.streams(),
                declared.response == RouteResponseKind::EventStream
            );
            assert_eq!(
                route.answers_png(),
                declared.response == RouteResponseKind::Png
            );
        }
        assert_eq!(STREAM_EVENT_TYPES, contract.stream_events.as_slice());
        assert_eq!(
            NATIVE_VISUALIZATION_KINDS,
            contract.native_visualization_kinds.as_slice()
        );
        for (code, status) in &contract.errors {
            assert_eq!(refusal_status(*code), *status, "{code:?}");
        }
        let voice = &contract.voice_turn;
        assert_eq!(VOICE_TURN_EVENT_TYPES, voice.events.as_slice());
        assert_eq!(VOICE_TURN_ERROR_CODES, voice.errors.as_slice());
        assert_eq!(VOICE_TURN_TRIGGERS, voice.triggers.as_slice());
        assert_eq!(VOICE_MEDIA_TYPE, voice.audio.media_type);
        assert_eq!(VOICE_SAMPLE_RATE_HZ, voice.audio.sample_rate_hz);
        assert_eq!(VOICE_MIN_DURATION_MS, voice.audio.min_duration_ms);
        assert_eq!(VOICE_MAX_DURATION_MS, voice.audio.max_duration_ms);
        assert_eq!(SPEECH_ENCODING, voice.speech.encoding);
        assert_eq!(SPEECH_SAMPLE_RATE_HZ, voice.speech.sample_rate_hz);
        assert_eq!(SPEECH_MAX_CHUNK_BYTES, voice.speech.max_chunk_bytes);
        Ok(())
    }

    #[test]
    fn the_core_constants_agree_with_the_generated_table() {
        // The pairing flow in `scout-client-core` names these paths by hand.
        assert_eq!(DESKTOP_CONTRACT_VERSION, CONTRACT_VERSION);
        assert_eq!(DESKTOP_CONTRACT_HEADER, CONTRACT_HEADER);
        for (route, path) in [
            (Route::PairingsV2, PAIRINGS_V2_PATH),
            (Route::DeviceScopeRequests, DEVICE_SCOPE_REQUESTS_PATH),
            (Route::ExploreStatus, EXPLORE_STATUS_PATH),
            (
                Route::ExploreConversationsList,
                EXPLORE_CONVERSATIONS_LIST_PATH,
            ),
            (
                Route::ExploreConversationsGet,
                EXPLORE_CONVERSATIONS_GET_PATH,
            ),
            (Route::ExploreRunsStart, EXPLORE_RUNS_START_PATH),
            (Route::ExploreRunsStop, EXPLORE_RUNS_STOP_PATH),
            (Route::ExploreRunsActive, EXPLORE_RUNS_ACTIVE_PATH),
            (Route::ExploreRunsOutcome, EXPLORE_RUNS_OUTCOME_PATH),
            (Route::ExploreRunsStream, EXPLORE_RUNS_STREAM_PATH),
            (Route::ExploreAssets, EXPLORE_ASSETS_PATH),
            (Route::ExploreVisualization, EXPLORE_VISUALIZATION_PATH),
            (Route::CoachVoiceTurns, COACH_VOICE_TURNS_PATH),
        ] {
            assert_eq!(route.path(), path);
        }
    }

    #[test]
    fn only_pairing_and_scope_requests_run_without_the_explore_scope() {
        for route in Route::ALL {
            let expected = (route != Route::PairingsV2 && route != Route::DeviceScopeRequests)
                .then_some(DeviceScope::Explore);
            assert_eq!(route.scope(), expected, "{}", route.name());
        }
    }
}
