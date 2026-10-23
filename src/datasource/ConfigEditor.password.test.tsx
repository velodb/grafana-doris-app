import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { ConfigEditor } from './ConfigEditor';
import type { DorisSSOJsonData, DorisSecureJsonData } from './types';

type Props = DataSourcePluginOptionsEditorProps<DorisSSOJsonData, DorisSecureJsonData>;

describe('Doris password authentication', () => {
    it.each([false, true])('retains an editable password across renders when a saved password exists: %s', configured => {
        const input = {
            options: {
                jsonData: { enableSso: false, username: 'reader', host: 'doris.example' },
                secureJsonFields: { password: configured, idpTlsCACert: true },
                secureJsonData: { idpTlsCACert: 'idp-ca' },
            },
            onOptionsChange: jest.fn(),
        } as unknown as Props;
        const onOptionsChange = jest.mocked(input.onOptionsChange);
        const { rerender } = render(<ConfigEditor {...input} />);

        if (configured) {
            expect(screen.getByPlaceholderText('Doris password')).toBeDisabled();
            fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
            const reset = onOptionsChange.mock.calls.at(-1)![0];
            expect(reset.secureJsonFields).toEqual({ password: false, idpTlsCACert: true });
            expect(reset.secureJsonData).toEqual({ password: '', idpTlsCACert: 'idp-ca' });
            rerender(<ConfigEditor {...input} options={reset} />);
        }

        const password = screen.getByPlaceholderText('Doris password');
        expect(password).toBeEnabled();
        fireEvent.change(password, { target: { value: 'new-password' } });
        const changed = onOptionsChange.mock.calls.at(-1)![0];
        expect(changed.secureJsonData).toEqual({ password: 'new-password', idpTlsCACert: 'idp-ca' });
        expect(changed.jsonData).toEqual(input.options.jsonData);
        rerender(<ConfigEditor {...input} options={changed} />);
        expect(screen.getByPlaceholderText('Doris password')).toHaveValue('new-password');

        fireEvent.change(screen.getByPlaceholderText('Doris password'), { target: { value: 'new-password!' } });
        const edited = onOptionsChange.mock.calls.at(-1)![0];
        rerender(<ConfigEditor {...input} options={edited} />);
        expect(screen.getByPlaceholderText('Doris password')).toHaveValue('new-password!');

        fireEvent.change(screen.getByPlaceholderText('Doris password'), { target: { value: '' } });
        const cleared = onOptionsChange.mock.calls.at(-1)![0];
        expect(cleared.secureJsonData).toEqual({ password: '', idpTlsCACert: 'idp-ca' });
        expect(cleared.secureJsonFields?.password).toBe(false);
        rerender(<ConfigEditor {...input} options={cleared} />);
        expect(screen.getByPlaceholderText('Doris password')).toHaveValue('');
    });
});

it('translates standalone datasource configuration without changing saved values', async () => {
    const { pluginI18n } = await import('i18n');
    await pluginI18n.changeLanguage('zh-CN');
    try {
        const props = {
            options: { jsonData: { enableSso: false, username: 'reader', host: 'doris.example' }, secureJsonFields: {}, secureJsonData: {} },
            onOptionsChange: jest.fn(),
        } as unknown as Props;
        render(<ConfigEditor {...props} />);
        expect(screen.getByText('Doris 用户名')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Doris 密码')).toBeInTheDocument();
        expect(screen.getByDisplayValue('reader')).toBeInTheDocument();
        expect(screen.getByDisplayValue('doris.example')).toBeInTheDocument();
    } finally {
        await pluginI18n.changeLanguage('en-US');
    }
});
