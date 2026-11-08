// Standalone fixture oracle. Link the existing pinned hexshade library; do not
// patch or rebuild its selector to agree with the Python graphics adapter.
use hexshade::{bundle, Defines};
use serde_json::{json, Value};
use std::{env, fs};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.len() != 2 {
        return Err("usage: shader-selector-reference <toc> <requests.json>".into());
    }
    let toc = bundle::read_toc(&fs::read(&args[0])?)?;
    let cases: Vec<Value> = serde_json::from_slice(&fs::read(&args[1])?)?;
    let mut results = Vec::new();
    for case in cases {
        let mut defines = Defines::default();
        for d in case["defines"].as_array().ok_or("defines array required")? {
            defines.insert_missing(
                d["name"].as_str().ok_or("name required")?,
                d["value"].as_str().ok_or("value required")?,
            );
        }
        results.push(json!({"id":case["id"],"selectedRecordId":bundle::permutation(&toc,&defines)}));
    }
    println!("{}", serde_json::to_string(&results)?);
    Ok(())
}
