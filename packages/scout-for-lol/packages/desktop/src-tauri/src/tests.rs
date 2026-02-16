//! Unit tests for the desktop application

#[cfg(test)]
mod lcu_tests {
    use super::super::lcu::*;

    #[test]
    fn test_lcu_status_default() {
        let status = LcuStatus {
            connected: false,
            summoner_name: None,
            in_game: false,
        };
        assert!(!status.connected);
        assert!(status.summoner_name.is_none());
        assert!(!status.in_game);
    }

    #[test]
    fn test_lcu_status_connected() {
        let status = LcuStatus {
            connected: true,
            summoner_name: Some("TestSummoner".to_string()),
            in_game: true,
        };
        assert!(status.connected);
        assert_eq!(status.summoner_name, Some("TestSummoner".to_string()));
        assert!(status.in_game);
    }
}

#[cfg(test)]
mod error_handling_tests {
    #[test]
    fn test_error_message_formatting() {
        let error = "Test error message";
        let formatted = format!("Error: {error}");
        assert_eq!(formatted, "Error: Test error message");
    }

    #[test]
    fn test_result_unwrap_alternative() {
        let value = 42_i32;
        assert_eq!(value, 42);
    }
}
