import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { PluginType } from '@grafana/data';
import AppConfig, { AppConfigProps } from './AppConfig';
import { testIds } from 'components/testIds';

jest.mock('@grafana/runtime', () => {
  const actual = jest.requireActual('@grafana/runtime');
  const React = jest.requireActual('react');
  const { of } = jest.requireActual('rxjs');

  return {
    ...actual,
    DataSourcePicker: () => React.createElement('div', { 'data-testid': 'datasource-picker' }),
    getBackendSrv: () => ({ fetch: () => of({ data: { teams: [] }, ok: true }) }),
    getDataSourceSrv: () => ({ getList: () => [] }),
  };
});

jest.mock('services/grafana-permissions', () => {
  const actual = jest.requireActual('services/grafana-permissions');
  return {
    ...actual,
    fetchTeams: () => new Promise(() => undefined),
  };
});

describe('Components/AppConfig', () => {
  let props: AppConfigProps;

  beforeEach(() => {
    jest.resetAllMocks();

    props = {
      plugin: {
        meta: {
          id: 'sample-app',
          name: 'Sample App',
          type: PluginType.app,
          enabled: true,
          jsonData: {},
        },
      },
      query: {},
    } as unknown as AppConfigProps;
  });

  test('renders the "API Settings" fieldset with API key, API url inputs and button', () => {
    const plugin = { ...props.plugin, meta: { ...props.plugin.meta, enabled: false } } as AppConfigProps['plugin'];

    render(<AppConfig plugin={plugin} query={props.query} />);

    expect(screen.queryByRole('group', { name: /api settings/i })).toBeInTheDocument();
    expect(screen.queryByTestId(testIds.appConfig.apiKey)).toBeInTheDocument();
    expect(screen.queryByTestId(testIds.appConfig.apiUrl)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save api settings/i })).toBeInTheDocument();
  });

  test('renders and validates the application resource attribute key', () => {
    render(<AppConfig plugin={props.plugin} query={props.query} />);

    const input = screen.getByTestId(testIds.appConfig.applicationAttributeKey);
    expect(input).toHaveValue('app');

    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: /save plugin settings/i })).toBeDisabled();
    expect(screen.getByText(/application resource attribute key is required/i)).toBeInTheDocument();
  });

  test('normalizes a configured application resource attribute key', () => {
    const plugin = {
      ...props.plugin,
      meta: {
        ...props.plugin.meta,
        jsonData: {
          logsConfig: {
            applicationAttributeKey: '  k8s.pod.label.app  ',
          },
        },
      },
    } as AppConfigProps['plugin'];

    render(<AppConfig plugin={plugin} query={props.query} />);

    expect(screen.getByTestId(testIds.appConfig.applicationAttributeKey)).toHaveValue('k8s.pod.label.app');
  });
});
