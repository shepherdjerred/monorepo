//! Reads the design system's language-neutral theme tokens and renders the
//! Rust constants the window uses.
//!
//! `build.rs` includes this file, and the crate compiles it again under
//! `cfg(test)` so the contract checks have unit tests. It depends on nothing
//! but `std` and `serde_json`.

use std::fmt::Write as _;

use serde_json::Value;

/// The color format the generator parses. The schema must declare exactly
/// this, so a change to the color format cannot slip past the generator.
pub const COLOR_PATTERN: &str = "^#[0-9A-F]{6}([0-9A-F]{2})?$";

/// The schema version this generator understands.
pub const SCHEMA_VERSION: u64 = 1;

/// Every color token the window uses, as `(token, rust_field)`.
pub const USED_COLORS: &[(&str, &str)] = &[
    ("canvas", "canvas"),
    ("surface", "surface"),
    ("surfaceRaised", "surface_raised"),
    ("text", "text"),
    ("textMuted", "text_muted"),
    ("primary", "primary"),
    ("primaryText", "primary_text"),
    ("accent", "accent"),
    ("accentText", "accent_text"),
    ("border", "border"),
    ("interactiveHover", "interactive_hover"),
    ("interactiveActive", "interactive_active"),
    ("interactiveDisabled", "interactive_disabled"),
    ("focus", "focus"),
    ("success", "success"),
    ("successText", "success_text"),
    ("successOnSurface", "success_on_surface"),
    ("warning", "warning"),
    ("warningText", "warning_text"),
    ("danger", "danger"),
    ("dangerText", "danger_text"),
    ("dangerOnSurface", "danger_on_surface"),
    ("info", "info"),
    ("infoText", "info_text"),
    ("overlay", "overlay"),
];

/// Every shape token the window uses, as `(token, rust_field)`. Values are CSS
/// lengths in `rem` (16 px) or `px`, and must come to whole pixels.
pub const USED_LENGTHS: &[(&str, &str)] = &[
    ("radiusSmall", "radius_small"),
    ("radiusMedium", "radius_medium"),
    ("radiusLarge", "radius_large"),
    ("borderWidth", "border_width"),
];

/// The themes the window can render, as `(token, rust_constant)`.
pub const THEMES: &[(&str, &str)] = &[
    ("modern-dark", "MODERN_DARK"),
    ("modern-light", "MODERN_LIGHT"),
    ("classic-dark", "CLASSIC_DARK"),
    ("classic-light", "CLASSIC_LIGHT"),
];

/// One theme's tokens, resolved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedTheme {
    /// The theme's name in `themes.json`.
    pub name: String,
    /// The Rust constant it becomes.
    pub constant: &'static str,
    /// `(rust_field, 0xRRGGBBAA)` in [`USED_COLORS`] order.
    pub colors: Vec<(&'static str, u32)>,
    /// `(rust_field, pixels)` in [`USED_LENGTHS`] order.
    pub lengths: Vec<(&'static str, u16)>,
}

fn object<'a>(value: &'a Value, path: &str) -> Result<&'a serde_json::Map<String, Value>, String> {
    value
        .as_object()
        .ok_or_else(|| format!("{path} must be an object"))
}

fn field<'a>(value: &'a Value, key: &str, path: &str) -> Result<&'a Value, String> {
    object(value, path)?
        .get(key)
        .ok_or_else(|| format!("{path}.{key} is missing"))
}

fn required_list<'a>(value: &'a Value, path: &str) -> Result<Vec<&'a str>, String> {
    field(value, "required", path)?
        .as_array()
        .ok_or_else(|| format!("{path}.required must be an array"))?
        .iter()
        .map(|entry| {
            entry
                .as_str()
                .ok_or_else(|| format!("{path}.required must hold strings"))
        })
        .collect()
}

fn require_in_schema(required: &[&str], token: &str, path: &str) -> Result<(), String> {
    if required.contains(&token) {
        Ok(())
    } else {
        Err(format!(
            "the Scout Desktop UI uses {path}.{token}, but themes.schema.json does not require it"
        ))
    }
}

/// Parse `#RRGGBB` or `#RRGGBBAA` (uppercase) into `0xRRGGBBAA`.
///
/// # Errors
/// A message naming the token when the value is not in [`COLOR_PATTERN`].
pub fn parse_color(value: &str, path: &str) -> Result<u32, String> {
    let hex = value
        .strip_prefix('#')
        .filter(|hex| {
            (hex.len() == 6 || hex.len() == 8)
                && hex
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'A'..=b'F').contains(&byte))
        })
        .ok_or_else(|| format!("{path} is {value:?}, not an uppercase #RRGGBB[AA] color"))?;
    let rgb = u32::from_str_radix(hex, 16).map_err(|error| format!("{path}: {error}"))?;
    Ok(if hex.len() == 6 {
        (rgb << 8) | 0xFF
    } else {
        rgb
    })
}

/// Parse a CSS length in `rem` (16 px) or `px` into whole pixels.
///
/// # Errors
/// A message naming the token when the value is not a whole-pixel length.
pub fn parse_length(value: &str, path: &str) -> Result<u16, String> {
    let (number, pixels_per_unit) = if let Some(number) = value.strip_suffix("rem") {
        (number, 16_u64)
    } else if let Some(number) = value.strip_suffix("px") {
        (number, 1)
    } else {
        return Err(format!("{path} is {value:?}, not a rem or px length"));
    };
    // Exact decimal arithmetic: `0.25rem` is 25 * 16 / 100 pixels.
    let (whole, fraction) = number.split_once('.').unwrap_or((number, ""));
    let digits = format!("{whole}{fraction}");
    if whole.is_empty() || digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(format!("{path} is {value:?}, not a number"));
    }
    let not_whole = || format!("{path} is {value:?}, not a whole number of pixels");
    let mantissa: u64 = digits.parse().map_err(|_| not_whole())?;
    let divisor = u32::try_from(fraction.len())
        .ok()
        .and_then(|places| 10_u64.checked_pow(places))
        .ok_or_else(not_whole)?;
    let scaled = mantissa
        .checked_mul(pixels_per_unit)
        .ok_or_else(not_whole)?;
    if scaled % divisor != 0 {
        return Err(not_whole());
    }
    u16::try_from(scaled / divisor).map_err(|_| not_whole())
}

/// Check `themes.json` against `themes.schema.json` for every token the
/// window uses, and resolve each theme.
///
/// # Errors
/// A message naming the first token that is missing, malformed, or no longer
/// part of the schema's contract.
pub fn resolve(themes_json: &str, schema_json: &str) -> Result<Vec<ResolvedTheme>, String> {
    let schema: Value = serde_json::from_str(schema_json)
        .map_err(|error| format!("themes.schema.json: {error}"))?;
    let themes: Value =
        serde_json::from_str(themes_json).map_err(|error| format!("themes.json: {error}"))?;

    let schema_version = field(field(&schema, "properties", "schema")?, "version", "schema")?;
    if field(schema_version, "const", "schema.properties.version")?.as_u64() != Some(SCHEMA_VERSION)
    {
        return Err(format!(
            "themes.schema.json is not version {SCHEMA_VERSION}; update the Scout Desktop UI generator"
        ));
    }
    if field(&themes, "version", "themes.json")?.as_u64() != Some(SCHEMA_VERSION) {
        return Err(format!("themes.json is not version {SCHEMA_VERSION}"));
    }

    let definitions = field(&schema, "$defs", "schema")?;
    let color_definition = field(definitions, "color", "schema.$defs")?;
    if field(color_definition, "pattern", "schema.$defs.color")?.as_str() != Some(COLOR_PATTERN) {
        return Err(format!(
            "themes.schema.json no longer declares colors as {COLOR_PATTERN}; update the Scout Desktop UI generator"
        ));
    }
    let theme_definition = field(definitions, "theme", "schema.$defs")?;
    let theme_properties = field(theme_definition, "properties", "schema.$defs.theme")?;
    let color_required = required_list(
        field(theme_properties, "colors", "schema.$defs.theme.properties")?,
        "colors",
    )?;
    let shape_required = required_list(
        field(theme_properties, "shape", "schema.$defs.theme.properties")?,
        "shape",
    )?;
    let themes_required = required_list(
        field(field(&schema, "properties", "schema")?, "themes", "schema")?,
        "themes",
    )?;
    for (token, _) in USED_COLORS {
        require_in_schema(&color_required, token, "colors")?;
    }
    for (token, _) in USED_LENGTHS {
        require_in_schema(&shape_required, token, "shape")?;
    }
    for (name, _) in THEMES {
        require_in_schema(&themes_required, name, "themes")?;
    }

    let declared = field(&themes, "themes", "themes.json")?;
    THEMES
        .iter()
        .map(|(name, constant)| {
            let path = format!("themes.{name}");
            let theme = field(declared, name, "themes")?;
            let colors = field(theme, "colors", &path)?;
            let shape = field(theme, "shape", &path)?;
            let colors = USED_COLORS
                .iter()
                .map(|(token, rust)| {
                    let token_path = format!("{path}.colors.{token}");
                    let value = field(colors, token, &format!("{path}.colors"))?
                        .as_str()
                        .ok_or_else(|| format!("{token_path} must be a string"))?;
                    Ok((*rust, parse_color(value, &token_path)?))
                })
                .collect::<Result<Vec<_>, String>>()?;
            let lengths = USED_LENGTHS
                .iter()
                .map(|(token, rust)| {
                    let token_path = format!("{path}.shape.{token}");
                    let value = field(shape, token, &format!("{path}.shape"))?
                        .as_str()
                        .ok_or_else(|| format!("{token_path} must be a string"))?;
                    Ok((*rust, parse_length(value, &token_path)?))
                })
                .collect::<Result<Vec<_>, String>>()?;
            Ok(ResolvedTheme {
                name: (*name).to_owned(),
                constant,
                colors,
                lengths,
            })
        })
        .collect()
}

/// Render the generated Rust module.
#[must_use]
pub fn render(themes: &[ResolvedTheme]) -> String {
    let mut out = String::from(
        "// Generated from design-system/tokens/themes.json by build.rs. Do not edit.\n\n\
         /// The design-system tokens the Scout Desktop window uses, for one theme.\n\
         /// Colors are `0xRRGGBBAA`; lengths are whole pixels.\n\
         #[derive(Debug, Clone, Copy, PartialEq, Eq)]\n\
         pub struct ThemeTokens {\n    \
         /// The theme's name in `themes.json`.\n    \
         pub name: &'static str,\n",
    );
    for (token, rust) in USED_COLORS {
        let _ = writeln!(
            out,
            "    /// The `colors.{token}` token.\n    pub {rust}: u32,"
        );
    }
    for (token, rust) in USED_LENGTHS {
        let _ = writeln!(
            out,
            "    /// The `shape.{token}` token, in pixels.\n    pub {rust}: u16,"
        );
    }
    out.push_str("}\n");
    for theme in themes {
        let _ = writeln!(
            out,
            "\n/// The `{}` theme.\npub const {}: ThemeTokens = ThemeTokens {{\n    name: {:?},",
            theme.name, theme.constant, theme.name
        );
        for (rust, color) in &theme.colors {
            let _ = writeln!(
                out,
                "    {rust}: 0x{:04X}_{:04X},",
                color >> 16,
                color & 0xFFFF
            );
        }
        for (rust, pixels) in &theme.lengths {
            let _ = writeln!(out, "    {rust}: {pixels},");
        }
        out.push_str("};\n");
    }
    let constants = themes
        .iter()
        .map(|theme| theme.constant)
        .collect::<Vec<_>>()
        .join(", ");
    let _ = writeln!(
        out,
        "\n/// Every generated theme.\npub const ALL_THEMES: [ThemeTokens; {}] = [{constants}];",
        themes.len()
    );
    out
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::{THEMES, USED_COLORS, parse_color, parse_length, render, resolve};

    const THEMES_JSON: &str = include_str!("../../../../design-system/tokens/themes.json");
    const SCHEMA_JSON: &str = include_str!("../../../../design-system/tokens/themes.schema.json");

    fn edited(source: &str, edit: impl FnOnce(&mut Value)) -> Result<String, serde_json::Error> {
        let mut value: Value = serde_json::from_str(source)?;
        edit(&mut value);
        serde_json::to_string(&value)
    }

    #[test]
    fn the_design_system_tokens_resolve() -> Result<(), String> {
        let themes = resolve(THEMES_JSON, SCHEMA_JSON)?;
        assert_eq!(themes.len(), THEMES.len());
        assert!(
            themes
                .iter()
                .all(|theme| theme.colors.len() == USED_COLORS.len())
        );
        let generated = render(&themes);
        assert!(generated.contains("pub const MODERN_DARK: ThemeTokens"));
        assert!(generated.contains("    canvas: 0x010A_13FF,"));
        Ok(())
    }

    #[test]
    fn a_missing_token_fails_the_build() -> Result<(), serde_json::Error> {
        let themes = edited(THEMES_JSON, |value| {
            if let Some(colors) = value
                .pointer_mut("/themes/classic-dark/colors")
                .and_then(Value::as_object_mut)
            {
                colors.remove("surfaceRaised");
            }
        })?;
        assert_eq!(
            resolve(&themes, SCHEMA_JSON),
            Err("themes.classic-dark.colors.surfaceRaised is missing".to_owned())
        );
        Ok(())
    }

    #[test]
    fn a_token_the_schema_stops_requiring_fails_the_build() -> Result<(), serde_json::Error> {
        let schema = edited(SCHEMA_JSON, |value| {
            if let Some(required) = value
                .pointer_mut("/$defs/theme/properties/colors/required")
                .and_then(Value::as_array_mut)
            {
                required.retain(|token| token != "focus");
            }
        })?;
        assert!(
            resolve(THEMES_JSON, &schema)
                .is_err_and(|error| error.contains("colors.focus") && error.contains("schema"))
        );
        Ok(())
    }

    #[test]
    fn a_changed_color_format_fails_the_build() -> Result<(), serde_json::Error> {
        let schema = edited(SCHEMA_JSON, |value| {
            if let Some(pattern) = value.pointer_mut("/$defs/color/pattern") {
                *pattern = Value::from("^#[0-9a-f]{6}$");
            }
        })?;
        assert!(resolve(THEMES_JSON, &schema).is_err_and(|error| error.contains("colors as")));
        Ok(())
    }

    #[test]
    fn colors_and_lengths_parse_strictly() {
        assert_eq!(parse_color("#C8AA6E", "x"), Ok(0xC8AA_6EFF));
        assert_eq!(parse_color("#010A13CC", "x"), Ok(0x010A_13CC));
        assert!(parse_color("#c8aa6e", "x").is_err());
        assert!(parse_color("C8AA6E", "x").is_err());
        assert!(parse_color("#C8AA6", "x").is_err());
        assert_eq!(parse_length("0.25rem", "x"), Ok(4));
        assert_eq!(parse_length("1px", "x"), Ok(1));
        assert!(parse_length("0.3rem", "x").is_err());
        assert!(parse_length("2em", "x").is_err());
        assert_eq!(parse_length("0.75rem", "x"), Ok(12));
        assert!(parse_length(".5rem", "x").is_err());
        assert!(parse_length("-1px", "x").is_err());
        assert!(parse_length("70000px", "x").is_err());
    }
}
