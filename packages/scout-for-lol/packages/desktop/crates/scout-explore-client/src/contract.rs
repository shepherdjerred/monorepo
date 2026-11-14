//! The desktop REST contract, generated from `desktop-api.contract.json`.

use scout_client_core::desktop_api::{DesktopApiErrorCode, DeviceScope};

include!(concat!(env!("OUT_DIR"), "/desktop_contract.rs"));

#[cfg(test)]
mod tests {
    use scout_client_core::desktop_api::{
        DESKTOP_CONTRACT_HEADER, DESKTOP_CONTRACT_VERSION, DesktopApiContract, DeviceScope,
        EXPLORE_CONVERSATIONS_GET_PATH, EXPLORE_CONVERSATIONS_LIST_PATH, EXPLORE_RUNS_ACTIVE_PATH,
        EXPLORE_RUNS_OUTCOME_PATH, EXPLORE_RUNS_START_PATH, EXPLORE_RUNS_STOP_PATH,
        EXPLORE_RUNS_STREAM_PATH, EXPLORE_STATUS_PATH, PAIRINGS_V2_PATH, RouteResponseKind,
    };

    use super::{
        CONTRACT_HEADER, CONTRACT_VERSION, MINIMUM_CONTRACT_VERSION, Route, STREAM_EVENT_TYPES,
        refusal_status,
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
        }
        assert_eq!(STREAM_EVENT_TYPES, contract.stream_events.as_slice());
        for (code, status) in &contract.errors {
            assert_eq!(refusal_status(*code), *status, "{code:?}");
        }
        Ok(())
    }

    #[test]
    fn the_core_constants_agree_with_the_generated_table() {
        // The pairing flow in `scout-client-core` names these paths by hand.
        assert_eq!(DESKTOP_CONTRACT_VERSION, CONTRACT_VERSION);
        assert_eq!(DESKTOP_CONTRACT_HEADER, CONTRACT_HEADER);
        for (route, path) in [
            (Route::PairingsV2, PAIRINGS_V2_PATH),
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
        ] {
            assert_eq!(route.path(), path);
        }
    }

    #[test]
    fn only_pairing_runs_without_the_explore_scope() {
        for route in Route::ALL {
            let expected = (route != Route::PairingsV2).then_some(DeviceScope::Explore);
            assert_eq!(route.scope(), expected, "{}", route.name());
        }
    }
}
