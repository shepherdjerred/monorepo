CREATE TABLE user_permission (
  user_uuid CHAR(36),
  permission_key VARCHAR(255),
  permission_value BIT,
  PRIMARY KEY (user_uuid, permission_key),
  FOREIGN KEY (user_uuid) REFERENCES user(user_uuid)
);
