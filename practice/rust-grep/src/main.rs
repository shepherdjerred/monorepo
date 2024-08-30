use std::env;
use std::process;

use rust_grep::parse_config;
use rust_grep::run;

fn main() {
    let config = parse_config(env::args()).unwrap_or_else(|error| {
        eprintln!("{}", error);
        process::exit(1);
    });

    if let Err(error) = run(config) {
        eprintln!("Error: {}", error);
        process::exit(1);
    }
}

