import { FieldType } from '@grafana/data';
import { formatTracesResData } from 'utils/data';

jest.mock('lodash-es', () => ({
    flatten: (items: any[]) => items.flat(),
    orderBy: (items: any[]) => items,
    some: (items: any[], predicate: (item: any) => boolean) => items.some(predicate),
}));
jest.mock('nanoid', () => ({
    nanoid: () => 'test-id',
}));

describe('formatTracesResData', () => {
    it('normalizes Doris span events into Grafana trace logs', () => {
        const frame = {
            schema: {
                refId: 'getTableDataTrace',
                fields: [
                    { name: 'traceID', type: FieldType.string },
                    { name: 'logs', type: FieldType.string },
                ],
            },
            data: {
                values: [
                    ['trace-1'],
                    [
                        JSON.stringify([
                            {
                                timestamp: '2026-06-02 09:07:35.123456',
                                name: 'exception',
                                attributes: {
                                    'exception.message': 'boom',
                                    'exception.escaped': 'false',
                                },
                            },
                        ]),
                    ],
                ],
            },
        };

        const traceData = formatTracesResData(frame);
        const logsField = traceData.fields.find(field => field.name === 'logs');

        expect(logsField?.type).toBe(FieldType.other);
        expect(logsField?.values[0]).toEqual([
            {
                timestamp: expect.any(Number),
                fields: [
                    { key: 'event', value: 'exception' },
                    { key: 'exception.message', value: 'boom' },
                    { key: 'exception.escaped', value: 'false' },
                ],
            },
        ]);
    });

    it('normalizes Doris JSON logs returned as arrays', () => {
        const frame = {
            schema: {
                refId: 'getTableDataTrace',
                fields: [
                    { name: 'traceID', type: FieldType.string },
                    { name: 'logs', type: FieldType.other },
                ],
            },
            data: {
                values: [
                    ['trace-1'],
                    [
                        [
                            {
                                timestamp: 1780481472123,
                                name: 'exception',
                                attributes: {
                                    'exception.message': 'boom',
                                    'exception.type': 'panic',
                                },
                            },
                        ],
                    ],
                ],
            },
        };

        const traceData = formatTracesResData(frame);
        const logsField = traceData.fields.find(field => field.name === 'logs');

        expect(logsField?.values[0]).toEqual([
            {
                timestamp: 1780481472123,
                fields: [
                    { key: 'event', value: 'exception' },
                    { key: 'exception.message', value: 'boom' },
                    { key: 'exception.type', value: 'panic' },
                ],
            },
        ]);
    });
});

describe('Trace attributes', () => {
    it('flattens nested attributes and serializes scalar and array values', () => {
        const frame = {
            schema: { fields: [{ name: 'tags', type: FieldType.string }] },
            data: { values: [[JSON.stringify({ http: { method: 'GET', status: 200 }, ok: true, list: ['x'], missing: null })]] },
        };
        expect(formatTracesResData(frame).fields[0].values[0]).toEqual([
            { key: 'http.method', value: 'GET' }, { key: 'http.status', value: '200' },
            { key: 'ok', value: 'true' }, { key: 'list', value: '["x"]' }, { key: 'missing', value: 'null' },
        ]);
    });
    it('preserves old key/value arrays and handles malformed values', () => {
        const tags = [{ key: 'http.method', value: 'GET' }];
        const frame = { schema: { fields: [{ name: 'serviceTags', type: FieldType.string }] }, data: { values: [[JSON.stringify(tags), 'invalid', null]] } };
        expect(formatTracesResData(frame).fields[0].values).toEqual([tags, [], []]);
    });
});
