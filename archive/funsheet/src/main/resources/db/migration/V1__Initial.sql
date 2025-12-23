CREATE TABLE location (
  location_uuid CHAR(36) PRIMARY KEY,
  name          VARCHAR(255) UNIQUE,
  placeId       TEXT
);

CREATE TABLE tag (
  tag_uuid CHAR(36) PRIMARY KEY,
  name     VARCHAR(255) UNIQUE
);

CREATE TABLE type (
  type_uuid CHAR(36) PRIMARY KEY,
  name      VARCHAR(255) UNIQUE
);

CREATE TABLE type_tags (
  type_uuid CHAR(36),
  tag_uuid  CHAR(36),
  PRIMARY KEY (type_uuid, tag_uuid),
  FOREIGN KEY (type_uuid) REFERENCES type (type_uuid),
  FOREIGN KEY (tag_uuid) REFERENCES tag (tag_uuid)
);

CREATE TABLE activity (
  activity_uuid CHAR(36) PRIMARY KEY,
  name          VARCHAR(255) UNIQUE,
  type_uuid     CHAR(36),
  rating        INT,
  location_uuid CHAR(36),
  cost          DOUBLE,
  description   TEXT,
  FOREIGN KEY (type_uuid) REFERENCES type (type_uuid),
  FOREIGN KEY (location_uuid) REFERENCES location (location_uuid)
);
