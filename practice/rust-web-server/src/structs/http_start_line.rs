use crate::structs::http_method::HttpMethod;
use crate::structs::http_protocol_version::HttpProtocolVersion;
use std::str::FromStr;

#[derive(Debug)]
pub struct HttpStartLine {
    pub http_method: HttpMethod,
    pub protocol_version: HttpProtocolVersion,
    pub request_target: String,
}


impl FromStr for HttpStartLine {
    type Err = String;

    fn from_str(start_line_string: &str) -> Result<Self, String> {
        let mut parts = start_line_string.split(" ");
        let http_method = HttpMethod::from_str(parts.next().unwrap()).unwrap();
        let request_target = parts.next().unwrap().to_string();
        let protocol_version = HttpProtocolVersion::from_str(parts.next().unwrap()).unwrap();
        Ok(HttpStartLine{
            http_method,
            protocol_version,
            request_target
        })
    }
}
