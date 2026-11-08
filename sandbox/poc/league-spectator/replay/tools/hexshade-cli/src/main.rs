//! Offline adapter for the pinned Hexshade compiler. No game process is started.
use std::{error::Error, fs, path::PathBuf};

use hexshade::{Stage, Translated, bundle, dxbc::ResourceKind};
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Job {
    stage: Stage,
    source: PathBuf,
    output: PathBuf,
}

// Hexshade v4 exposes the SPIR-V identifier as SamplerBinding.sampler. Preserve
// the original RDEF name for native/API binding; glsl_name stays untouched.
// This identifier rule matches the pinned compiler's spirv::ident conversion.
fn compiler_identifier(name: &str) -> String {
    let normalized = name
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("_");
    if normalized.is_empty() {
        "unnamed".to_owned()
    } else if normalized.starts_with(|ch: char| ch.is_ascii_digit()) {
        format!("_{normalized}")
    } else {
        normalized
    }
}

fn translate_named(bytes: &[u8], stage: Stage) -> Result<Translated, Box<dyn Error>> {
    let mut translated = hexshade::translate(bytes, stage)?;
    let reflection = hexshade::dxbc::reflect(bytes)?;
    for texture in &mut translated.sidecar.textures {
        for binding in &mut texture.samplers {
            if let Some(name) = &binding.sampler {
                let candidates: Vec<_> = reflection
                    .resources
                    .iter()
                    .filter(|r| {
                        r.kind == ResourceKind::Sampler && compiler_identifier(&r.name) == *name
                    })
                    .collect();
                if candidates.len() != 1 {
                    return Err(format!(
                        "sampler {name} does not identify exactly one RDEF resource"
                    )
                    .into());
                }
                binding.sampler = Some(candidates[0].name.clone());
            }
        }
    }
    Ok(translated)
}

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() != 3 {
        return Err("usage: scout-shader-prepare <toc|translate> <input> <output>".into());
    }
    match args[0].as_str() {
        "toc" => {
            let toc = bundle::read_toc(&fs::read(&args[1])?)?;
            let value = json!({
                "baseDefines": toc.base_defines.iter().map(|d| json!({
                    "name": d.name, "value": d.value, "hash": format!("{:08x}", d.hash.0)
                })).collect::<Vec<_>>(),
                "shaderHashes": toc.shader_hashes.iter().map(|h| format!("{h:016x}")).collect::<Vec<_>>(),
                "shaderIds": toc.shader_ids,
                "pipelineVersion": hexshade::PIPELINE_VERSION,
            });
            fs::write(&args[2], serde_json::to_vec_pretty(&value)?)?;
        }
        "translate" => {
            let jobs: Vec<Job> = serde_json::from_slice(&fs::read(&args[1])?)?;
            let mut results = Vec::with_capacity(jobs.len());
            let mut failures = 0usize;
            for (i, job) in jobs.iter().enumerate() {
                let bytes = fs::read(&job.source)?;
                match translate_named(&bytes, job.stage) {
                    Ok(translated) => {
                        let mut output = serde_json::to_value(&translated)?;
                        output["adapter"] = json!({"version": 1, "samplerNames": "original DXBC RDEF", "shaderCodeRewritten": false});
                        fs::write(&job.output, serde_json::to_vec_pretty(&output)?)?;
                        results.push(json!({"index": i, "status": "translated"}));
                    }
                    Err(error) => {
                        failures += 1;
                        results.push(
                            json!({"index": i, "status": "failed", "reason": error.to_string()}),
                        );
                    }
                }
            }
            fs::write(
                &args[2],
                serde_json::to_vec_pretty(&json!({
                    "pipelineVersion": hexshade::PIPELINE_VERSION,
                    "jobs": results, "translated": jobs.len() - failures, "failed": failures,
                }))?,
            )?;
            if failures != 0 {
                return Err(
                    format!("{failures} shader translations failed; inspect {}", args[2]).into(),
                );
            }
        }
        _ => return Err("expected toc or translate".into()),
    }
    Ok(())
}
