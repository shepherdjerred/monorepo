CREATE TABLE user (
  user_uuid CHAR(36) PRIMARY KEY,
  username VARCHAR(255) UNIQUE,
  password CHAR(60) BINARY
);
