use std::error::Error;
use std::fs;
use std::env;

pub struct Config {
    query: String,
    file_name: String,
    is_case_sensitive: bool,
}

pub fn parse_config(mut arguments: std::env::Args) -> Result<Config, &'static str> {
    // The first argument is the path of the invoked executable, so we skip it.
    arguments.next();


    let query = match arguments.next() {
        Some(argument) => argument,
        None => return Err("No query provided"),
    };

    let file_name = match arguments.next() {
        Some(argument) => argument,
        None => return Err("No file name provided"),
    };

    return Ok(Config {
        query,
        file_name,
        is_case_sensitive: env::var("CASE_INSENSITIVE").is_err()
    });
}

pub fn run(config: Config) -> Result<(), Box<dyn Error>> {
    let contents = fs::read_to_string(config.file_name)?;

    let results = if config.is_case_sensitive {
        search(&config.query, &contents)
    } else {
        search_case_insensitive(&config.query, &contents)
    };

    for result in results {
        println!("{}", result);
    }

    return Ok(());
}

fn search<'a>(query: &str, contents: &'a str) -> Vec<&'a str> {
    return contents.lines()
        .filter(|line| line.contains(query))
        .collect();
}

fn search_case_insensitive<'a>(query: &str, contents: &'a str) -> Vec<&'a str> {
    let query = query.to_lowercase();
    return contents.lines()
        .filter(|line| line.to_lowercase().contains(&query))
        .collect();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_result() {
        let query = "duct";
        let contents = "\
Rust:
safe, fast, productive.
Pick three.";

        assert_eq!(
            vec!["safe, fast, productive."],
            search(query, contents)
        )
    }

    #[test]
    fn case_sensitive() {
        let query = "duct";
        let contents = "\
Rust:
safe, fast, productive.
Pick three.
Duct tape.";

        assert_eq!(
            vec!["safe, fast, productive."],
            search(query, contents)
        )
    }

    #[test]
    fn case_insensitive() {
        let query = "RUST";
        let contents = "\
Rust:
safe, fast, productive.
Pick three.
Trust me.";

        assert_eq!(
            vec!["Rust:", "Trust me."],
            search_case_insensitive(query, contents)
        )
    }
}

