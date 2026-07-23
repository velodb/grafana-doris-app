CREATE DATABASE IF NOT EXISTS otel;

DROP TABLE IF EXISTS otel.otel_logs;

CREATE TABLE otel.otel_logs (
  `timestamp` DATETIMEV2(3) NOT NULL,
  `service_name` VARCHAR(128) NOT NULL,
  `service_instance_id` VARCHAR(128) NULL,
  `trace_id` VARCHAR(64) NULL,
  `span_id` VARCHAR(32) NULL,
  `severity_number` INT NULL,
  `severity_text` VARCHAR(32) NULL,
  `body` STRING NULL,
  `resource_attributes` VARIANT NULL,
  `log_attributes` VARIANT NULL,
  `scope_name` VARCHAR(128) NULL,
  `scope_version` VARCHAR(32) NULL
)
DUPLICATE KEY(`timestamp`, `service_name`)
DISTRIBUTED BY HASH(`service_name`) BUCKETS 1
PROPERTIES (
  "replication_num" = "1"
);

INSERT INTO otel.otel_logs VALUES
  (NOW(3) - INTERVAL 5 MINUTE,  'checkout', 'checkout-1', '00000000000000000000000000000001', '0000000000000001', 9,  'INFO',  'checkout request accepted',    '{"app":"app1","k8s.pod.label.app":"checkout","k8s.namespace.name":"shop","k8s.pod.name":"checkout-1"}', '{"http.method":"POST","http.route":"/checkout"}', 'demo.logger', '1.0.0'),
  (NOW(3) - INTERVAL 10 MINUTE, 'checkout', 'checkout-2', '00000000000000000000000000000002', '0000000000000002', 13, 'WARN',  'payment provider is slow',     '{"app":"app1","k8s.pod.label.app":"checkout","k8s.namespace.name":"shop","k8s.pod.name":"checkout-2"}', '{"duration_ms":850}', 'demo.logger', '1.0.0'),
  (NOW(3) - INTERVAL 20 MINUTE, 'checkout', 'checkout-1', '00000000000000000000000000000003', '0000000000000003', 17, 'ERROR', 'checkout request failed',      '{"app":"app1","k8s.pod.label.app":"checkout","k8s.namespace.name":"shop","k8s.pod.name":"checkout-1"}', '{"error.type":"PaymentDeclined"}', 'demo.logger', '1.0.0'),
  (NOW(3) - INTERVAL 35 MINUTE, 'catalog',  'catalog-1',  '00000000000000000000000000000004', '0000000000000004', 9,  'INFO',  'product list loaded',          '{"app":"app2","k8s.pod.label.app":"catalog","k8s.namespace.name":"shop","k8s.pod.name":"catalog-1"}', '{"items":24}', 'demo.logger', '1.0.0'),
  (NOW(3) - INTERVAL 50 MINUTE, 'catalog',  'catalog-2',  '00000000000000000000000000000005', '0000000000000005', 9,  'INFO',  'cache hit for product',        '{"app":"app2","k8s.pod.label.app":"catalog","k8s.namespace.name":"shop","k8s.pod.name":"catalog-2"}', '{"cache":"hit"}', 'demo.logger', '1.0.0'),
  (NOW(3) - INTERVAL 1 HOUR,    'catalog',  'catalog-1',  '00000000000000000000000000000006', '0000000000000006', 13, 'WARN',  'inventory response delayed',   '{"app":"app2","k8s.pod.label.app":"catalog","k8s.namespace.name":"shop","k8s.pod.name":"catalog-1"}', '{"duration_ms":420}', 'demo.logger', '1.0.0'),
  (NOW(3) - INTERVAL 2 HOUR,    'frontend', 'frontend-1', '00000000000000000000000000000007', '0000000000000007', 9,  'INFO',  'page rendered',                '{"app":"app3","k8s.pod.label.app":"frontend","k8s.namespace.name":"shop","k8s.pod.name":"frontend-1"}', '{"route":"/"}', 'demo.logger', '1.0.0'),
  (NOW(3) - INTERVAL 3 HOUR,    'frontend', 'frontend-2', '00000000000000000000000000000008', '0000000000000008', 9,  'INFO',  'assets loaded',                '{"app":"app3","k8s.pod.label.app":"frontend","k8s.namespace.name":"shop","k8s.pod.name":"frontend-2"}', '{"asset_count":18}', 'demo.logger', '1.0.0'),
  (NOW(3) - INTERVAL 4 HOUR,    'frontend', 'frontend-1', '00000000000000000000000000000009', '0000000000000009', 17, 'ERROR', 'upstream request failed',      '{"app":"app3","k8s.pod.label.app":"frontend","k8s.namespace.name":"shop","k8s.pod.name":"frontend-1"}', '{"status_code":503}', 'demo.logger', '1.0.0'),
  (NOW(3) - INTERVAL 6 HOUR,    'worker',   'worker-1',   '00000000000000000000000000000010', '000000000000000a', 9,  'INFO',  'background job completed',     '{"k8s.pod.label.app":"worker","k8s.namespace.name":"jobs","k8s.pod.name":"worker-1"}', '{"job":"reconcile"}', 'demo.logger', '1.0.0'),
  (NOW(3) - INTERVAL 12 HOUR,   'checkout', 'checkout-1', '00000000000000000000000000000011', '000000000000000b', 9,  'INFO',  'older checkout request',       '{"app":"app1","k8s.pod.label.app":"checkout","k8s.namespace.name":"shop","k8s.pod.name":"checkout-1"}', '{"http.method":"GET"}', 'demo.logger', '1.0.0'),
  (NOW(3) - INTERVAL 2 DAY,     'archive',  'archive-1',  '00000000000000000000000000000012', '000000000000000c', 9,  'INFO',  'outside default time range',    '{"app":"old-app","k8s.pod.label.app":"archive","k8s.namespace.name":"archive","k8s.pod.name":"archive-1"}', '{}', 'demo.logger', '1.0.0');

