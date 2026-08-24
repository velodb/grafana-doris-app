import { reconcileColumnOrder, reconcileColumnSizing } from 'utils/column-layout';

describe('Discover column layout reconciliation', () => {
    it('pins the expand column, retains saved order, and appends new columns', () => {
        expect(reconcileColumnOrder(
            ['__expand', '__time', 'field:service', 'field:message'],
            ['field:service', '__expand', '__time', 'field:deleted'],
        )).toEqual(['__expand', 'field:service', '__time', 'field:message']);
    });

    it('drops unavailable sizes and clamps persisted values', () => {
        expect(reconcileColumnSizing(
            ['__expand', '__time', 'field:message'],
            { __expand: 200, __time: 20, 'field:message': 1200, 'field:deleted': 300 },
        )).toEqual({ __time: 80, 'field:message': 800 });
    });
});
