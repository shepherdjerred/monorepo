use std::str::FromStr;

#[derive(Debug)]
#[derive(PartialEq)]
pub enum HttpProtocolVersion {
    ZeroPointNine,
    OnePointZero,
    OnePointOne,
    TwoPointZero,
    ThreePointZero,
}

impl FromStr for HttpProtocolVersion {
    type Err = String;

    fn from_str(version_string: &str) -> Result<Self, String> {
        match version_string {
            "HTTP/0.9" => Ok(HttpProtocolVersion::ZeroPointNine),
            "HTTP/1.0" => Ok(HttpProtocolVersion::OnePointZero),
            "HTTP/1.1" => Ok(HttpProtocolVersion::OnePointOne),
            "HTTP/2.0" => Ok(HttpProtocolVersion::TwoPointZero),
            "HTTP/3.0" => Ok(HttpProtocolVersion::ThreePointZero),
            _ => Err("No match".to_string())
        }
    }
}

impl ToString for HttpProtocolVersion {
    fn to_string(&self) -> String {
        let val = match self {
            HttpProtocolVersion::ZeroPointNine => "0.9",
            HttpProtocolVersion::OnePointZero => "1.0",
            HttpProtocolVersion::OnePointOne => "1.1",
            HttpProtocolVersion::TwoPointZero => "2.0",
            HttpProtocolVersion::ThreePointZero => "3.0"
        };

        format!("HTTP/{}", val)
    }
}
