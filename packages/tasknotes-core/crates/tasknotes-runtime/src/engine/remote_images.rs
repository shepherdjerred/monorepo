//! Authenticated remote image application; metadata and binary versions are
//! journaled together, and only Markdown's merge assembles text explicitly.

use super::{
    Engine, PLUGIN_CONFIGURATION_PATH, PORTABLE_CONFIGURATION_PATH, ProfileKind, RemoteMetadata,
    Result, RuntimeError, lock_profile, parse_remote_metadata, payloads, staged,
};
use crate::types::PayloadInfo;
use rusqlite::{OptionalExtension, params};
use tasknotes_vault::path::VaultPath;

enum Merge {
    Merged(Option<PayloadInfo>),
    Overlap,
}

fn same(left: Option<&PayloadInfo>, right: Option<&PayloadInfo>) -> bool {
    left.map(|image| (&image.revision, image.size))
        == right.map(|image| (&image.revision, image.size))
}

fn validate_metadata(
    path: &str,
    metadata: Option<&RemoteMetadata>,
    image: Option<&PayloadInfo>,
) -> Result<()> {
    if let Some(metadata) = metadata {
        if metadata.related_path.as_deref() == Some(path) {
            return Err(RuntimeError::Validation(
                "remote rename source and destination must differ".to_owned(),
            ));
        }
        if let Some(hash) = &metadata.content_hash {
            if image.is_none() {
                return Err(RuntimeError::Validation(
                    "deletion metadata must omit contentHash".to_owned(),
                ));
            }
            if image.is_some_and(|image| &image.revision != hash) {
                return Err(RuntimeError::Validation(
                    "remote content hash does not match authenticated payload".to_owned(),
                ));
            }
        }
    }
    Ok(())
}

impl Engine {
    /// Apply a sealed owner-scoped payload through bounded staged file exchange.
    /// None is a tombstone; a zero-length sealed image remains an empty file.
    ///
    /// # Errors
    /// Rejects unsafe metadata, unsealed/wrong-owner images and provider failures.
    pub fn ingest_payload(
        &self,
        profile: &str,
        path: &str,
        payload_id: Option<&str>,
        remote_revision: &str,
    ) -> Result<()> {
        VaultPath::parse(path)?;
        parse_remote_metadata(remote_revision)?;
        let coordinator = self.coordinator(profile)?;
        let _operation = lock_profile(&coordinator)?;
        self.ingest_payload_coordinated(profile, path, payload_id, remote_revision)
    }

    pub(super) fn ingest_payload_coordinated(
        &self,
        profile: &str,
        path: &str,
        payload_id: Option<&str>,
        remote_revision: &str,
    ) -> Result<()> {
        VaultPath::parse(path)?;
        let metadata = parse_remote_metadata(remote_revision)?;
        let image = payload_id
            .map(|id| self.database(|db| payloads::image_info(db, profile, id)))
            .transpose()?;
        validate_metadata(path, metadata.as_ref(), image.as_ref())?;
        let selected = self.profile(profile)?;
        if selected.kind != ProfileKind::ObsidianSync {
            return Err(RuntimeError::Validation(
                "direct Sync requires a private replica".to_owned(),
            ));
        }
        let uid = metadata.as_ref().map_or_else(
            || remote_revision.to_owned(),
            |metadata| metadata.uid.to_string(),
        );
        let id = format!("remote:{uid}:{path}");
        let fingerprint = format!(
            "remote:{}",
            serde_json::json!({"path":path,"uid":uid,"content":image.as_ref().map(|image|&image.revision),"metadata":metadata})
        );
        if self
            .existing_receipt(profile, &id, &fingerprint, None)?
            .is_some()
        {
            return self.rebuild_remote_settings(profile, &selected, path);
        }
        let config = match self.configuration_optional(&selected) {
            Ok(config) => config,
            Err(RuntimeError::Configuration(_)) => None,
            Err(error) => return Err(error),
        };
        self.recover(profile, config.as_ref())?;
        if self
            .existing_receipt(profile, &id, &fingerprint, None)?
            .is_some()
        {
            return self.rebuild_remote_settings(profile, &selected, path);
        }
        let writes = self.plan_remote_images(
            profile,
            path,
            image.as_ref(),
            &uid,
            metadata
                .as_ref()
                .and_then(|metadata| metadata.related_path.as_deref()),
        )?;
        self.database(|db| {
            let tx=db.transaction()?;
            tx.execute("INSERT INTO journals(profile,id,fingerprint,writes,remote) VALUES(?,?,?,?,1)",params![profile,id,fingerprint,"[]"])?;
            staged::store_files(&tx,profile,&id,&writes)?;
            tx.execute("INSERT INTO journal_remote(profile,journal_id,path,uid,metadata,base) VALUES(?,?,?,?,?,?)",params![profile,id,path,uid,metadata.as_ref().map(serde_json::to_string).transpose()?,image.as_ref().map(|image|&image.id)])?;
            if let Some(image)=&image {payloads::promote_content(&tx,profile,&image.id)?;}
            tx.commit()?;Ok(())
        })?;
        if let Err(error) = self.finish_staged_journal(profile, &id, config.as_ref(), true)
            && !matches!(error, RuntimeError::Conflict)
        {
            return Err(error);
        }
        self.rebuild_remote_settings(profile, &selected, path)
    }

    fn rebuild_remote_settings(
        &self,
        profile: &str,
        selected: &crate::types::Profile,
        path: &str,
    ) -> Result<()> {
        if [PLUGIN_CONFIGURATION_PATH, PORTABLE_CONFIGURATION_PATH].contains(&path) {
            self.rebuild_configuration(profile, selected, path)?;
        }
        Ok(())
    }

    fn plan_remote_images(
        &self,
        profile: &str,
        path: &str,
        remote: Option<&PayloadInfo>,
        uid: &str,
        related: Option<&str>,
    ) -> Result<Vec<staged::DurableFile>> {
        let current = self.capture_file_image(profile, path)?;
        let source = related
            .map(|path| self.capture_file_image(profile, path))
            .transpose()?
            .flatten();
        let base = self.database(|db| {
            db.query_row(
                "SELECT base FROM files WHERE profile=? AND path=?",
                params![profile, related.unwrap_or(path)],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten()
            .map(|id| payloads::image_info(db, profile, &id))
            .transpose()
        })?;
        let local = if related.is_some() {
            source.as_ref()
        } else {
            current.as_ref()
        };
        if related.is_some() && !same(current.as_ref(), remote) && current.is_some() {
            self.database(|db| {
                staged::conflict_images(
                    db,
                    profile,
                    (&format!("sync:{uid}:{path}:destination"), path, uid),
                    None,
                    current.as_ref(),
                    remote,
                )
            })?;
        }
        let merged = self.merge_images(profile, path, base.as_ref(), local, remote)?;
        let after = match merged {
            Merge::Merged(image) => image,
            Merge::Overlap => {
                self.database(|db| {
                    staged::conflict_images(
                        db,
                        profile,
                        (&format!("sync:{uid}:{path}"), path, uid),
                        base.as_ref(),
                        local,
                        remote,
                    )
                })?;
                remote.cloned()
            }
        };
        let mut writes = vec![staged::DurableFile {
            ordinal: 0,
            path: path.to_owned(),
            expected: current.as_ref().map(|image| image.revision.clone()),
            before: current,
            after,
        }];
        if let Some(source_path) = related {
            writes.push(staged::DurableFile {
                ordinal: 1,
                path: source_path.to_owned(),
                expected: source.as_ref().map(|image| image.revision.clone()),
                before: source,
                after: None,
            });
        }
        Ok(writes)
    }

    fn merge_images(
        &self,
        profile: &str,
        path: &str,
        base: Option<&PayloadInfo>,
        local: Option<&PayloadInfo>,
        remote: Option<&PayloadInfo>,
    ) -> Result<Merge> {
        if same(local, remote) || same(remote, base) {
            return Ok(Merge::Merged(local.cloned()));
        }
        if same(local, base) {
            return Ok(Merge::Merged(remote.cloned()));
        }
        if !path.to_lowercase().ends_with(".md") {
            return Ok(Merge::Overlap);
        }
        self.database(|db| {
            let text = |image: Option<&PayloadInfo>| {
                image
                    .map(|image| payloads::read_inline(db, profile, &image.id))
                    .transpose()
            };
            let (base, local, remote) = (text(base)?, text(local)?, text(remote)?);
            crate::merge::three_way(path, base.as_deref(), local.as_deref(), remote.as_deref())
                .map(|merged| {
                    merged
                        .map(|bytes| {
                            payloads::store_inline(db, profile, &bytes)
                                .and_then(|id| payloads::image_info(db, profile, &id))
                        })
                        .transpose()
                })
                .transpose()
                .map(|merged| merged.map_or(Merge::Overlap, Merge::Merged))
        })
    }
}
