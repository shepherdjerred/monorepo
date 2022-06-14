CREATE TABLE user (
  user_uuid CHAR(36) PRIMARY KEY,
  email VARCHAR(255) UNIQUE,
  password CHAR(60) BINARY,
  easel_username VARCHAR(255) UNIQUE,
  easel_password VARCHAR(255)
);
