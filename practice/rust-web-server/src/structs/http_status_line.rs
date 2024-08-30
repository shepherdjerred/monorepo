use crate::structs::http_protocol_version::HttpProtocolVersion;

#[derive(Debug)]
pub struct HttpStatusLine {
    pub protocol_version: HttpProtocolVersion,
    pub status_code: String,
    pub status_text: String,
}

impl ToString for HttpStatusLine {
    fn to_string(&self) -> String {
        format!("{} {} {}", self.protocol_version.to_string(), self.status_code, self.status_text)
    }
}
