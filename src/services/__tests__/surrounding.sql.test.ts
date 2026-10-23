import { getSurroundingSQL } from '../sql';

describe('getSurroundingSQL', () => {
    it('combines the time boundary with inherited Discover filters', () => {
        expect(
            getSurroundingSQL({
                catalog: 'internal',
                database: 'otel',
                table: 'logs',
                cluster: '',
                timeField: 'timestamp',
                time: '2026-09-20 10:00:00',
                data_filters: [{
                    id: 'level-error',
                    fieldName: 'level',
                    operator: '=',
                    value: ['ERROR'],
                }],
                pageSize: '5',
                operator: '>',
                theme: 'light',
            }),
        ).toBe(
            "SELECT * FROM `otel`.`logs` WHERE (`timestamp` BETWEEN '2026-09-20 10:00:00.000' AND '2026-09-20 10:00:00.000' + INTERVAL 1 HOUR) AND (`timestamp` > '2026-09-20 10:00:00.000') AND (`level` = 'ERROR') ORDER BY `timestamp` ASC LIMIT 5",
        );
    });
});
