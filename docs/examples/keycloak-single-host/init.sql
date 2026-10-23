CREATE DATABASE IF NOT EXISTS oidc_demo;
CREATE TABLE IF NOT EXISTS oidc_demo.logs (
  `timestamp` DATETIMEV2(3) NOT NULL,
  `service_name` VARCHAR(64) NOT NULL,
  `body` STRING
) DUPLICATE KEY (`timestamp`, `service_name`)
DISTRIBUTED BY HASH (`service_name`) BUCKETS 1
PROPERTIES ('replication_num'='1');
INSERT INTO oidc_demo.logs VALUES (NOW(3), 'oidc-lab', 'OIDC deployment verified');
CREATE ROLE IF NOT EXISTS doris_reader;
GRANT SELECT_PRIV ON oidc_demo.* TO ROLE doris_reader;
