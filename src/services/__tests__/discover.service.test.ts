jest.mock('@grafana/runtime', () => {
  const backendSrv = { fetch: jest.fn() };
  return { getBackendSrv: jest.fn(() => backendSrv) };
});

jest.mock('components/with-error-handler/withErrorHandler', () => ({
  withErrorHandler: jest.fn((response, options) => ({ response, options })),
}));

jest.mock('../sql', () => ({
  getQueryTableResultSQL: jest.fn(() => 'RESULT SQL'),
  getQueryTableChartsSQL: jest.fn(() => 'CHART SQL'),
  getQueryTableResultCountSQL: jest.fn(() => 'COUNT SQL'),
  getSurroundingSQL: jest.fn(() => 'SURROUNDING SQL'),
}));

import {
  getSurroundingDataService,
  getTableDataChartsService,
  getTableDataCountService,
  getTableDataService,
  getTopDataService,
} from '../discover';
import {
  getQueryTableChartsSQL,
  getQueryTableResultCountSQL,
  getQueryTableResultSQL,
  getSurroundingSQL,
} from '../sql';
import { getBackendSrv } from '@grafana/runtime';
import { withErrorHandler } from 'components/with-error-handler/withErrorHandler';

const mockFetch = getBackendSrv().fetch as jest.Mock;
const mockWithErrorHandler = withErrorHandler as jest.Mock;

const payload = {
  selectdbDS: { type: 'velodb-doris-datasource', uid: 'doris-main' },
  database: 'otel',
  table: 'logs',
};

describe('Discover service requests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReturnValue('response-stream');
  });

  it.each([
    ['table data', getTableDataService, getQueryTableResultSQL, 'RESULT SQL', 'getTableData'],
    ['chart data', getTableDataChartsService, getQueryTableChartsSQL, 'CHART SQL', 'getTableDataCharts'],
    ['count data', getTableDataCountService, getQueryTableResultCountSQL, 'COUNT SQL', 'getTableCountData'],
    ['top data', getTopDataService, getQueryTableResultSQL, 'RESULT SQL', 'getTableTopData'],
  ])('builds the expected request for %s', (_name, service, sqlBuilder, sql, refId) => {
    const options = { showBackendError: true, defaultMessage: 'Query failed' };

    service(payload, options);

    expect(sqlBuilder).toHaveBeenCalledWith({ database: 'otel', table: 'logs' });
    expect(mockFetch).toHaveBeenCalledWith({
      url: '/api/ds/query',
      method: 'POST',
      credentials: 'include',
      data: {
        queries: [{
          refId,
          datasource: payload.selectdbDS,
          rawSql: sql,
          format: 'table',
        }],
      },
    });
    expect(mockWithErrorHandler).toHaveBeenCalledWith('response-stream', { ...options, generatedSql: sql });
  });

  it('builds surrounding-log requests without leaking result-query error context', () => {
    getSurroundingDataService(payload);

    expect(getSurroundingSQL).toHaveBeenCalledWith({ database: 'otel', table: 'logs' });
    expect(mockFetch).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        queries: [expect.objectContaining({ refId: 'getSurroundingData', rawSql: 'SURROUNDING SQL' })],
      }),
    }));
    expect(mockWithErrorHandler).toHaveBeenCalledWith('response-stream');
  });
});
