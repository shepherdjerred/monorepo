//! Where the outbox and diagnostics live on disk.

use directories::ProjectDirs;
use sha2::Digest as _;
use sha2::Sha256;
use std::path::PathBuf;
use tracing::error;
use uuid::Uuid;

pub(super) fn outbox_file_name(backend_origin: &str, device_id: Option<Uuid>) -> String {
    let mut hasher = Sha256::new();
    hasher.update(backend_origin.as_bytes());
    hasher.update([0]);
    if let Some(device_id) = device_id {
        hasher.update(device_id.as_bytes());
    }
    format!("outbox-{}.db", hex::encode(hasher.finalize()))
}

/// The per-user directory holding the outbox and the diagnostics log.
pub(crate) fn data_directory() -> Option<PathBuf> {
    let project = ProjectDirs::from("com", "Scout", "Scout Client")?;
    let directory = project.data_local_dir().to_path_buf();
    if let Err(error) = std::fs::create_dir_all(&directory) {
        error!(%error, "could not create Scout Client data directory");
        return None;
    }
    Some(directory)
}

/// Where rotated JSONL diagnostics are written.
pub(super) fn log_directory() -> Option<PathBuf> {
    Some(data_directory()?.join("logs"))
}

pub(super) fn outbox_path(backend_origin: &str, device_id: Option<Uuid>) -> PathBuf {
    let file_name = outbox_file_name(backend_origin, device_id);
    data_directory().map_or_else(
        || std::env::temp_dir().join(&file_name),
        |directory| directory.join(&file_name),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn durable_outbox_files_are_backend_and_device_scoped() {
        let first_device = Uuid::new_v4();
        let second_device = Uuid::new_v4();
        let production = outbox_file_name("https://scout.sjer.red/", Some(first_device));

        assert_eq!(
            production,
            outbox_file_name("https://scout.sjer.red/", Some(first_device))
        );
        assert_ne!(
            production,
            outbox_file_name("https://scout.sjer.red/", Some(second_device))
        );
        assert_ne!(
            production,
            outbox_file_name("https://beta.scout.sjer.red/", Some(first_device))
        );
        assert_ne!(
            production,
            outbox_file_name("http://127.0.0.1:3000/", Some(first_device))
        );
        assert_ne!(
            production,
            outbox_file_name("https://scout.sjer.red/", None)
        );
    }

    #[test]
    fn outbox_file_names_match_persisted_databases() -> Result<(), uuid::Error> {
        let device = Uuid::parse_str("00000000-0000-4000-8000-000000000001")?;

        assert_eq!(
            outbox_file_name("https://scout.sjer.red/", Some(device)),
            "outbox-40889348c35a9742e33afe72090bb52b06193e3200cfa3181b3e6198e4922c81.db"
        );
        assert_eq!(
            outbox_file_name("https://scout.sjer.red/", None),
            "outbox-c0946c92d24dd4e6623c7d20a280d2d4dbe353ae2ec788d10824fc54711af925.db"
        );
        Ok(())
    }
}
