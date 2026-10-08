//! Isolated near-limit allocation evidence for authenticated file framing.
//! Native allocator/provider/FFI peaks are measured by their host acceptance.
use obsidian_sync::crypto::{EncryptionVersion, VaultCipher, VaultKey};
use stats_alloc::{INSTRUMENTED_SYSTEM, Region, StatsAlloc};
use std::alloc::System;

#[global_allocator]
static GLOBAL: &StatsAlloc<System> = &INSTRUMENTED_SYSTEM;

#[test]
fn near_limit_encrypt_allocates_one_exact_frame_and_owned_decrypt_reuses_it()
-> Result<(), Box<dyn std::error::Error>> {
    let key = VaultKey::from_bytes(&[1; 32])?;
    let cipher = VaultCipher::new(EncryptionVersion::V3, &key, "synthetic-memory-vault")?;
    let size = usize::try_from(obsidian_sync::session::DEFAULT_FILE_LIMIT)?;
    let plaintext = vec![0x5a; size];
    let region = Region::new(GLOBAL);
    let encrypted = cipher.encrypt_content(&plaintext, [7; 12])?;
    let allocation = region.change();
    assert_eq!(encrypted.len(), size + 28);
    assert_eq!(encrypted.capacity(), size + 28);
    assert_eq!(allocation.bytes_allocated, size + 28);
    let pointer = encrypted.as_ptr();
    let region = Region::new(GLOBAL);
    let decrypted = cipher.decrypt_content_owned(encrypted)?;
    assert_eq!(region.change().bytes_allocated, 0);
    assert_eq!(decrypted.as_ptr(), pointer);
    assert_eq!(decrypted.capacity(), size + 28);
    assert_eq!(decrypted, plaintext);
    eprintln!(
        "199 MiB frame: encryption allocation={} bytes, final capacity={} bytes, owned decryption allocation=0 bytes",
        allocation.bytes_allocated,
        decrypted.capacity()
    );
    Ok(())
}
