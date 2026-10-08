//! Exact JSON integer normalization for versioned native boundaries.
//!
//! `serde_json` `arbitrary_precision` retains the written decimal/exponent. Known
//! integer fields accept mathematical integers without a floating conversion;
//! unrelated user property values are never normalized.

use crate::{Result, VaultError};
use serde_json::Value;

/// Normalize one schema-declared nullable unsigned integer in place.
///
/// # Errors
/// Rejects fractional, negative nonzero, and out-of-range values.
pub fn normalize_unsigned(value: &mut Value) -> Result<()> {
    if value.is_null() {
        return Ok(());
    }
    *value = Value::from(unsigned(value)?);
    Ok(())
}

/// Read a mathematically integral unsigned JSON number exactly.
///
/// # Errors
/// Rejects nonnumbers, fractions, negative nonzero, and overflowing integers.
pub fn unsigned(value: &Value) -> Result<u64> {
    let Value::Number(number) = value else {
        return Err(invalid());
    };
    decimal_unsigned(&number.to_string())
}

fn decimal_unsigned(raw: &str) -> Result<u64> {
    let negative = raw.starts_with('-');
    let raw = raw.strip_prefix('-').unwrap_or(raw);
    let (mantissa, exponent) = raw
        .split_once(['e', 'E'])
        .map_or((raw, None), |(m, e)| (m, Some(e)));
    let (whole, fraction) = mantissa.split_once('.').unwrap_or((mantissa, ""));
    let mut digits = format!("{whole}{fraction}");
    if digits.bytes().all(|byte| byte == b'0') {
        return Ok(0);
    }
    if negative {
        return Err(invalid());
    }
    let exponent = exponent.map_or(Ok(0), |e| e.parse::<i64>().map_err(|_| invalid()))?;
    let scale = exponent
        .checked_sub(i64::try_from(fraction.len()).map_err(|_| invalid())?)
        .ok_or_else(invalid)?;
    if scale < 0 {
        let count = usize::try_from(scale.unsigned_abs()).map_err(|_| invalid())?;
        let split = digits.len().checked_sub(count).ok_or_else(invalid)?;
        if !digits
            .get(split..)
            .ok_or_else(invalid)?
            .bytes()
            .all(|byte| byte == b'0')
        {
            return Err(invalid());
        }
        digits.truncate(split);
    } else {
        let zeros = usize::try_from(scale).map_err(|_| invalid())?;
        let length = digits
            .trim_start_matches('0')
            .len()
            .checked_add(zeros)
            .ok_or_else(invalid)?;
        if length > 20 {
            return Err(invalid());
        }
        digits.extend(std::iter::repeat_n('0', zeros));
    }
    digits.parse::<u64>().map_err(|_| invalid())
}
fn invalid() -> VaultError {
    VaultError::Document("integer must be exact, nonnegative, and within range".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn raw_decimal_boundaries_preserve_exact_integer_identity() -> Result<()> {
        for (raw, wanted) in [
            ("1.0", 1),
            ("1e0", 1),
            ("100e-2", 1),
            ("9007199254740993", 9_007_199_254_740_993),
            ("18446744073709551615.0", u64::MAX),
            ("-0.00", 0),
            ("0e99999999999999999999999999", 0),
        ] {
            let value: Value = serde_json::from_str(raw).map_err(|_| invalid())?;
            assert_eq!(unsigned(&value)?, wanted, "{raw}");
        }
        for raw in [
            "1.0000000000000000001",
            "9007199254740993.1",
            "18446744073709551616",
            "1e-99999999999999999999999999",
            "-1",
            "1e20",
        ] {
            let value: Value = serde_json::from_str(raw).map_err(|_| invalid())?;
            assert!(unsigned(&value).is_err(), "accepted {raw}");
        }
        Ok(())
    }
}
