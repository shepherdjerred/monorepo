//! A disk cache for the pictures and game data chat shows, keyed by URL.
//!
//! Each entry is one file named by the SHA-256 of its key, so a key never
//! becomes a path. The cache holds at most `capacity` bytes; past that it
//! drops the least recently used entries. Use is recorded in each file's
//! modification time, so the order survives a restart. Writes go to a
//! temporary file first and are renamed into place, so a reader never sees a
//! half-written image.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};
use std::time::SystemTime;

use sha2::{Digest as _, Sha256};

/// What the chat window may keep on disk: about 4,000 card icons, or a few
/// hundred charts.
pub const DEFAULT_CAPACITY_BYTES: u64 = 64 * 1024 * 1024;

const ENTRY_EXTENSION: &str = "asset";

#[derive(Debug, Clone, Copy)]
struct Entry {
    size: u64,
    /// Higher is more recent.
    used: u64,
}

#[derive(Debug, Default)]
struct Index {
    entries: HashMap<String, Entry>,
    total: u64,
    clock: u64,
}

impl Index {
    fn touch(&mut self, name: &str) -> bool {
        self.clock += 1;
        let clock = self.clock;
        self.entries
            .get_mut(name)
            .map(|entry| entry.used = clock)
            .is_some()
    }

    fn remove(&mut self, name: &str) {
        if let Some(entry) = self.entries.remove(name) {
            self.total -= entry.size;
        }
    }

    /// The least recently used entry other than `keep`.
    fn oldest_except(&self, keep: &str) -> Option<String> {
        self.entries
            .iter()
            .filter(|(name, _)| name.as_str() != keep)
            .min_by_key(|(_, entry)| entry.used)
            .map(|(name, _)| name.clone())
    }
}

/// A bounded, least-recently-used disk cache keyed by URL.
#[derive(Debug)]
pub struct AssetCache {
    directory: PathBuf,
    capacity: u64,
    index: Mutex<Index>,
}

fn file_name(key: &str) -> String {
    format!(
        "{}.{ENTRY_EXTENSION}",
        hex::encode(Sha256::digest(key.as_bytes()))
    )
}

fn modified(path: &Path) -> SystemTime {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH)
}

impl AssetCache {
    /// The cache in `directory`, created if missing, holding at most
    /// `capacity` bytes. Entries already there are kept, oldest use first,
    /// and trimmed to `capacity`.
    ///
    /// # Errors
    ///
    /// The directory cannot be created or listed.
    pub fn open(directory: PathBuf, capacity: u64) -> io::Result<Self> {
        fs::create_dir_all(&directory)?;
        let mut found = Vec::new();
        for entry in fs::read_dir(&directory)? {
            let entry = entry?;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if path.extension().is_some_and(|ext| ext == ENTRY_EXTENSION) {
                found.push((modified(&path), name, entry.metadata()?.len()));
            } else if name.contains(".tmp-") {
                // A write that never finished.
                let _ = fs::remove_file(&path);
            }
        }
        found.sort();
        let mut index = Index::default();
        for (_, name, size) in found {
            index.clock += 1;
            index.total += size;
            index.entries.insert(
                name,
                Entry {
                    size,
                    used: index.clock,
                },
            );
        }
        let cache = Self {
            directory,
            capacity,
            index: Mutex::new(index),
        };
        cache.evict("");
        Ok(cache)
    }

    fn index(&self) -> std::sync::MutexGuard<'_, Index> {
        self.index.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The cached file for `key`, marking it used, or none on a miss.
    #[must_use]
    pub fn get(&self, key: &str) -> Option<PathBuf> {
        let name = file_name(key);
        let path = self.directory.join(&name);
        let mut index = self.index();
        if !index.touch(&name) {
            return None;
        }
        if !path.is_file() {
            // Removed behind the cache's back.
            index.remove(&name);
            return None;
        }
        // Best effort: the order in memory is already right, and a stale
        // time only changes what goes first after a restart.
        if let Ok(file) = File::options().write(true).open(&path) {
            let _ = file.set_modified(SystemTime::now());
        }
        Some(path)
    }

    /// Store `bytes` under `key` and return the file, dropping the least
    /// recently used entries until the cache fits its capacity again.
    ///
    /// # Errors
    ///
    /// `bytes` alone exceed the capacity, or the file cannot be written.
    pub fn put(&self, key: &str, bytes: &[u8]) -> io::Result<PathBuf> {
        let size = u64::try_from(bytes.len()).unwrap_or(u64::MAX);
        if size > self.capacity {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("{size} bytes do not fit a {} byte cache", self.capacity),
            ));
        }
        let name = file_name(key);
        let path = self.directory.join(&name);
        let temporary = self.directory.join(format!(
            "{name}.tmp-{}-{}",
            std::process::id(),
            fastrand::u64(..)
        ));
        fs::write(&temporary, bytes)?;
        if let Err(error) = fs::rename(&temporary, &path) {
            let _ = fs::remove_file(&temporary);
            return Err(error);
        }
        {
            let mut index = self.index();
            index.remove(&name);
            index.clock += 1;
            let used = index.clock;
            index.total += size;
            index.entries.insert(name.clone(), Entry { size, used });
        }
        self.evict(&name);
        Ok(path)
    }

    /// Drop least recently used entries, never `keep`, until the cache fits.
    fn evict(&self, keep: &str) {
        let mut index = self.index();
        while index.total > self.capacity {
            let Some(oldest) = index.oldest_except(keep) else {
                break;
            };
            index.remove(&oldest);
            let _ = fs::remove_file(self.directory.join(&oldest));
        }
    }

    /// Bytes held now.
    #[must_use]
    pub fn total_bytes(&self) -> u64 {
        self.index().total
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::AssetCache;

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    /// A fresh directory under the system temporary directory.
    fn scratch(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "scout-asset-cache-{name}-{}-{}",
            std::process::id(),
            fastrand::u64(..)
        ));
        let _ = std::fs::remove_dir_all(&directory);
        directory
    }

    #[test]
    fn a_hit_returns_the_bytes_that_were_stored() -> TestResult {
        let directory = scratch("hit");
        let cache = AssetCache::open(directory.clone(), 1_000)?;
        assert_eq!(cache.get("https://example.invalid/a.png"), None);
        let stored = cache.put("https://example.invalid/a.png", b"png-a")?;
        let found = cache
            .get("https://example.invalid/a.png")
            .ok_or("a stored key missed")?;
        assert_eq!(found, stored);
        assert_eq!(std::fs::read(found)?, b"png-a");
        assert!(stored.starts_with(&directory));
        std::fs::remove_dir_all(directory)?;
        Ok(())
    }

    #[test]
    fn the_least_recently_used_entry_goes_first() -> TestResult {
        let directory = scratch("lru");
        let cache = AssetCache::open(directory.clone(), 10)?;
        cache.put("a", b"aaaa")?;
        cache.put("b", b"bbbb")?;
        // Reading `a` makes `b` the least recently used.
        assert!(cache.get("a").is_some());
        cache.put("c", b"cccc")?;
        assert!(cache.get("a").is_some());
        assert_eq!(cache.get("b"), None);
        assert!(cache.get("c").is_some());
        assert_eq!(cache.total_bytes(), 8);
        let files = std::fs::read_dir(&directory)?.count();
        assert_eq!(files, 2, "the evicted file is deleted");
        std::fs::remove_dir_all(directory)?;
        Ok(())
    }

    #[test]
    fn an_entry_larger_than_the_cache_is_refused() -> TestResult {
        let directory = scratch("large");
        let cache = AssetCache::open(directory.clone(), 4)?;
        assert!(cache.put("big", b"12345").is_err());
        assert_eq!(cache.total_bytes(), 0);
        std::fs::remove_dir_all(directory)?;
        Ok(())
    }

    #[test]
    fn a_reopened_cache_keeps_its_entries_within_capacity() -> TestResult {
        let directory = scratch("reopen");
        {
            let cache = AssetCache::open(directory.clone(), 100)?;
            cache.put("a", b"aaaa")?;
            cache.put("b", b"bbbb")?;
            cache.put("c", b"cccc")?;
        }
        let reopened = AssetCache::open(directory.clone(), 100)?;
        assert!(reopened.get("a").is_some());
        assert_eq!(reopened.total_bytes(), 12);
        // A smaller capacity trims on open.
        let smaller = AssetCache::open(directory.clone(), 8)?;
        assert_eq!(smaller.total_bytes(), 8);
        std::fs::remove_dir_all(directory)?;
        Ok(())
    }

    #[test]
    fn a_file_removed_behind_the_cache_is_a_miss() -> TestResult {
        let directory = scratch("removed");
        let cache = AssetCache::open(directory.clone(), 100)?;
        let path = cache.put("a", b"aaaa")?;
        std::fs::remove_file(path)?;
        assert_eq!(cache.get("a"), None);
        assert_eq!(cache.total_bytes(), 0);
        std::fs::remove_dir_all(directory)?;
        Ok(())
    }
}
