use std::str::FromStr;

#[derive(Debug)]
#[derive(PartialEq)]
pub enum HttpMethod {
    GET,
    POST,
    HEAD,
    PUT,
    DELETE,
    CONNECT,
    OPTIONS,
    TRACE,
    PATCH,
}

// TODO: this could probably be done with a macro
impl FromStr for HttpMethod {
    type Err = String;

    fn from_str(http_method: &str) -> Result<Self, String> {
        match http_method {
            "GET" => Ok(HttpMethod::GET),
            "POST" => Ok(HttpMethod::POST),
            "HEAD" => Ok(HttpMethod::HEAD),
            "PUT" => Ok(HttpMethod::PUT),
            "DELETE" => Ok(HttpMethod::DELETE),
            "CONNECT" => Ok(HttpMethod::CONNECT),
            "OPTIONS" => Ok(HttpMethod::OPTIONS),
            "TRACE" => Ok(HttpMethod::TRACE),
            "PATCH" => Ok(HttpMethod::PATCH),
            _ => Err("Input had no match".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_str_returns_get_when_given_correct_string() {
        let actual = HttpMethod::from_str("GET").unwrap();
        assert_eq!(actual, HttpMethod::GET);
    }
}
