//! Differential acceptance against the pinned official client's crypto code.

use obsidian_sync::{
    SyncError,
    crypto::{ContentFrame, EncryptionVersion, VaultCipher, VaultKey},
};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    inputs: Inputs,
    vectors: Vectors,
}
#[derive(Deserialize)]
struct Inputs {
    password: String,
    salt: String,
    plaintext: Vec<u8>,
    nonce: [u8; 12],
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Vectors {
    derived_bytes: Vec<u8>,
    cases: Vec<Case>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    version: u8,
    key_hash_bytes: Vec<u8>,
    strings: Vec<StringVector>,
    content: Vec<u8>,
    empty_content: Vec<u8>,
}
#[derive(Deserialize)]
struct StringVector {
    plaintext: String,
    ciphertext: String,
}

#[test]
fn official_client_vectors_match_exact_bytes() -> Result<(), Box<dyn std::error::Error>> {
    let fixture: Fixture = serde_json::from_str(include_str!(
        "../../../../tasknotes-fixtures/vault/upstream/obsidian-crypto.json"
    ))?;
    let key = VaultKey::derive(&fixture.inputs.password, &fixture.inputs.salt)?;
    assert_eq!(
        key.secure_storage_bytes().as_ref(),
        fixture.vectors.derived_bytes
    );
    assert_eq!(fixture.vectors.cases.len(), 3);
    for case in fixture.vectors.cases {
        let cipher = VaultCipher::new(
            EncryptionVersion::try_from(case.version)?,
            &key,
            &fixture.inputs.salt,
        )?;
        assert_eq!(cipher.key_hash(), hex::encode(case.key_hash_bytes));
        for string in case.strings {
            assert_eq!(cipher.encode_string(&string.plaintext)?, string.ciphertext);
            assert_eq!(cipher.decode_string(&string.ciphertext)?, string.plaintext);
        }
        assert_eq!(
            cipher.encrypt_content(&fixture.inputs.plaintext, fixture.inputs.nonce)?,
            case.content
        );
        let mut frame = ContentFrame::new(fixture.inputs.plaintext.len(), fixture.inputs.nonce)?;
        frame
            .content_mut()?
            .copy_from_slice(&fixture.inputs.plaintext);
        let payload_pointer = frame.content()?.as_ptr();
        let capacity = frame.capacity();
        let owned = cipher.encrypt_content_frame(frame)?;
        assert_eq!(owned, case.content);
        assert_eq!(owned.as_ptr().wrapping_add(12), payload_pointer);
        assert_eq!(owned.capacity(), capacity);
        assert_eq!(
            cipher.decrypt_content(&case.content)?,
            fixture.inputs.plaintext
        );
        assert_eq!(
            cipher.encrypt_content(&[], fixture.inputs.nonce)?,
            case.empty_content
        );
        assert_eq!(
            cipher.decrypt_content(&case.empty_content)?,
            Vec::<u8>::new()
        );
    }
    Ok(())
}

#[test]
fn authentication_truncation_and_diagnostics_are_safe() -> Result<(), Box<dyn std::error::Error>> {
    assert!(matches!(
        ContentFrame::new(usize::MAX, [0; 12]),
        Err(SyncError::FileTooLarge)
    ));
    let frame = ContentFrame::new(10, [1; 12])?;
    assert_eq!(format!("{frame:?}"), "ContentFrame([REDACTED])");
    let key = VaultKey::from_bytes(&[7; 32])?;
    assert_eq!(format!("{key:?}"), "VaultKey([REDACTED])");
    assert!(VaultKey::from_bytes(&[7; 31]).is_err());
    assert_eq!(
        EncryptionVersion::try_from(1),
        Err(SyncError::UnsupportedEncryption(1))
    );
    for version in [
        EncryptionVersion::Legacy,
        EncryptionVersion::V2,
        EncryptionVersion::V3,
    ] {
        let cipher = VaultCipher::new(version, &key, "synthetic salt")?;
        let other = VaultCipher::new(version, &VaultKey::from_bytes(&[8; 32])?, "synthetic salt")?;
        assert!(!format!("{cipher:?}").contains(cipher.key_hash()));
        let encrypted = cipher.encrypt_content(b"synthetic content", [1; 12])?;
        assert_eq!(
            other.decrypt_content(&encrypted),
            Err(SyncError::Authentication)
        );
        for length in [0, 1, 11, 12, 13, 27] {
            assert_eq!(
                cipher.decrypt_content(&vec![0; length]),
                Err(SyncError::Authentication)
            );
        }
        let mut altered = encrypted;
        if let Some(last) = altered.last_mut() {
            *last ^= 1;
        }
        assert_eq!(
            cipher.decrypt_content(&altered),
            Err(SyncError::Authentication)
        );
        for invalid in ["0", "zz", "éé", "00"] {
            assert_eq!(
                cipher.decode_string(invalid),
                Err(SyncError::Authentication)
            );
        }
    }
    Ok(())
}
