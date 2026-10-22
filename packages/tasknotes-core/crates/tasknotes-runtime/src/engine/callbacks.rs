//! Same-engine callback reentry never waits on its own profile/close coordinator.

use crate::{
    Result,
    types::{DisplacedMetadata, FileSnapshot, ReplacementStage, StagedExchange, VaultFiles},
};
use std::{cell::RefCell, sync::Arc};

thread_local! { static ACTIVE: RefCell<Vec<String>> = const {RefCell::new(Vec::new())}; }

pub(super) fn in_callback(identity: &str) -> bool {
    ACTIVE.with(|active| active.borrow().iter().any(|current| current == identity))
}

struct Scope(String);
impl Scope {
    fn enter(identity: &str) -> Self {
        ACTIVE.with(|active| active.borrow_mut().push(identity.to_owned()));
        Self(identity.to_owned())
    }
}
impl Drop for Scope {
    fn drop(&mut self) {
        ACTIVE.with(|active| {
            let current = active.borrow_mut().pop();
            assert_eq!(
                current.as_deref(),
                Some(self.0.as_str()),
                "callback ownership scopes must remain nested"
            );
        });
    }
}

pub(super) struct GuardedFiles {
    inner: Arc<dyn VaultFiles>,
    identity: String,
}
impl GuardedFiles {
    pub(super) fn new(inner: Arc<dyn VaultFiles>, identity: String) -> Self {
        Self { inner, identity }
    }
}

macro_rules! callback {
    ($name:ident($($arg:ident:$ty:ty),* $(,)?) -> $result:ty) => {
        fn $name(&self,$($arg:$ty),*) -> Result<$result> {
            let _scope=Scope::enter(&self.identity);
            self.inner.$name($($arg),*)
        }
    };
}

impl VaultFiles for GuardedFiles {
    callback!(list_files(profile: &str) -> Vec<String>);
    callback!(read_file(profile: &str, path: &str) -> Option<Vec<u8>>);
    callback!(open_file_snapshot(profile: &str, path: &str) -> Option<FileSnapshot>);
    callback!(open_displaced_snapshot(profile: &str, id: &str) -> FileSnapshot);
    callback!(read_snapshot_chunk(profile: &str, id: &str, offset: u64, length: u32) -> Vec<u8>);
    callback!(close_snapshot(profile: &str, id: &str) -> ());
    callback!(
        begin_replacement(
            profile: &str,
            operation: &str,
            path: &str,
            expected: Option<&str>,
            size: u64,
            revision: &str,
        ) -> ReplacementStage
    );
    callback!(
        write_replacement_chunk(
            profile: &str,
            id: &str,
            offset: u64,
            bytes: &[u8],
        ) -> ReplacementStage
    );
    callback!(seal_replacement(profile: &str, id: &str) -> ReplacementStage);
    callback!(
        compare_exchange_staged(
            profile: &str,
            operation: &str,
            path: &str,
            expected: Option<&str>,
            stage: Option<&str>,
        ) -> StagedExchange
    );
    callback!(discard_replacement(profile: &str, id: &str) -> ());
    callback!(
        displaced_metadata(
            profile: &str,
            after: Option<&str>,
            limit: u32,
        ) -> Vec<DisplacedMetadata>
    );
    callback!(acknowledge_displaced(profile: &str, id: &str) -> ());
}
