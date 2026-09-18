jest.mock('@grafana/runtime', () => {
  const backendSrv = { fetch: jest.fn() };
  return { getBackendSrv: jest.fn(() => backendSrv) };
});

jest.mock('components/with-error-handler/withErrorHandler', () => ({
  withErrorHandler: jest.fn((response, options) => ({ response, options })),
}));

jest.mock('../traces.sql', () => ({
  getQueryTableTraceSQL: jest.fn(() => 'TRACE DETAIL SQL'),
  buildTraceAggSQLFromParams: jest.fn(() => 'TRACE LIST SQL'),
  getServiceListSQL: jest.fn(() => 'SERVICE LIST SQL'),
  getOperationListSQL: jest.fn(() => 'OPERATION LIST SQL'),
}));

import {
  getOperationListService,
  getServiceListService,
  getTableDataTraceService,
  getTracesService,
} from '../traces';
import {
  buildTraceAggSQLFromParams,
  getOperationListSQL,
  getQueryTableTraceSQL,
  getServiceListSQL,
} from '../traces.sql';
import { getBackendSrv } from '@grafana/runtime';
import { withErrorHandler } from 'components/with-error-handler/withErrorHandler';

const mockFetch = getBackendSrv().fetch as jest.Mock;
const mockWithErrorHandler = withErrorHandler as jest.Mock;

const payload = {
  selectdbDS: { type: 'velodb-doris-datasource', uid: 'doris-traces' },
  database: 'otel',
  table: 'traces',
};

describe('Trace service requests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReturnValue('response-stream');
  });

  it.each([
    ['trace detail', getTableDataTraceService, getQueryTableTraceSQL, 'TRACE DETAIL SQL', 'getTableDataTrace'],
    ['trace list', getTracesService, buildTraceAggSQLFromParams, 'TRACE LIST SQL', 'getTraces'],
    ['service list', getServiceListService, getServiceListSQL, 'SERVICE LIST SQL', 'getServiceList'],
    ['operation list', getOperationListService, getOperationListSQL, 'OPERATION LIST SQL', 'getOperationList'],
  ])('builds the expected request for %s', (_name, service, sqlBuilder, sql, refId) => {
    const options = { showBackendError: true };

    service(payload, options);

    expect(sqlBuilder).toHaveBeenCalledWith({ database: 'otel', table: 'traces' });
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
    expect(mockWithErrorHandler).toHaveBeenCalledWith('response-stream', options);
  });
});
