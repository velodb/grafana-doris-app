import { getApplicationValuesSQL } from '../metaservice';

describe('application values SQL', () => {
    it('scopes distinct values to the configured table and time range', () => {
        const sql = getApplicationValuesSQL({
            database: 'otel',
            table: 'otel_logs',
            timeField: 'timestamp',
            startDate: '2026-07-16 00:00:00.000',
            endDate: '2026-07-17 00:00:00.000',
            attributeKey: 'k8s.pod.label.app',
        });

        expect(sql).toContain("CAST(`resource_attributes`['k8s.pod.label.app'] AS STRING) AS application");
        expect(sql).toContain('FROM `otel`.`otel_logs`');
        expect(sql).toContain("WHERE `timestamp` BETWEEN '2026-07-16 00:00:00.000' AND '2026-07-17 00:00:00.000'");
        expect(sql).toContain('GROUP BY application');
        expect(sql).toContain('ORDER BY application');
        expect(sql).toContain('LIMIT 200;');
    });

    it('escapes identifiers and the configured attribute key', () => {
        const sql = getApplicationValuesSQL({
            database: 'ot`el',
            table: 'log`s',
            timeField: 'time`stamp',
            startDate: 'start',
            endDate: 'end',
            attributeKey: "team'app",
        });

        expect(sql).toContain("CAST(`resource_attributes`['team''app'] AS STRING)");
        expect(sql).toContain('FROM `ot``el`.`log``s`');
        expect(sql).toContain("WHERE `time``stamp` BETWEEN 'start' AND 'end'");
    });
});
