import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { ConfigEditor } from './ConfigEditor';
import type { DorisSSOJsonData, DorisSecureJsonData } from './types';

type Props = DataSourcePluginOptionsEditorProps<DorisSSOJsonData, DorisSecureJsonData>;

function props(jsonData: DorisSSOJsonData): Props {
    return {
        options: { jsonData, secureJsonData: { password: 'existing-password' }, secureJsonFields: { password: true } },
        onOptionsChange: jest.fn(),
    } as unknown as Props;
}

describe('Hidden datasource defaults', () => {
    it('omits the default database field while preserving saved defaults when another field changes', () => {
        const input = props({ enableSso: false, database: 'otel' });
        input.options.isDefault = true;
        render(<ConfigEditor {...input} />);
        expect(screen.queryByText('Default database')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('checkbox', { name: 'Enable SSO' }));
        expect(input.onOptionsChange).toHaveBeenLastCalledWith(expect.objectContaining({
            isDefault: true,
            jsonData: expect.objectContaining({ enableSso: true, database: 'otel' }),
        }));
    });

    it('hides both Grafana default controls only while the Doris editor is mounted', () => {
        render(<>
            <div className="gf-form-inline">
                <div><label htmlFor="basic-settings-name">Name</label><input id="basic-settings-name" /></div>
                <div><label htmlFor="basic-settings-default">Default</label><input type="checkbox" id="basic-settings-default" /></div>
            </div>
            <div className="gf-form-button-row">
                <button type="button" data-testid="delete-datasource">Delete</button>
                <button type="button">Remove default</button>
                <button type="submit" data-testid="save-datasource">Save &amp; test</button>
            </div>
        </>);
        const legacyDefault = screen.getByRole('checkbox', { name: 'Default' });
        const defaultAction = screen.getByRole('button', { name: 'Remove default' });
        const { unmount } = render(<ConfigEditor {...props({ enableSso: false })} />);
        expect(legacyDefault).not.toBeVisible();
        expect(defaultAction).not.toBeVisible();
        expect(screen.getByRole('textbox', { name: 'Name' })).toBeVisible();
        expect(screen.getByRole('button', { name: 'Delete' })).toBeVisible();
        expect(screen.getByRole('button', { name: 'Save & test' })).toBeVisible();
        unmount();
        expect(legacyDefault).toBeVisible();
        expect(defaultAction).toBeVisible();
    });
});

describe('SSO identity forwarding', () => {
    it('enables forwarding together with SSO and disables it when switching back to password authentication', () => {
        const input = props({ enableSso: false, host: 'doris.example' });
        const { rerender } = render(<ConfigEditor {...input} />);
        expect(input.onOptionsChange).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('checkbox', { name: /^Enable SSO/ }));
        const enabled = (input.onOptionsChange as jest.Mock).mock.calls[0][0];
        expect(enabled.jsonData).toEqual(expect.objectContaining({ enableSso: true, oauthPassThru: true, host: 'doris.example' }));
        expect(enabled.secureJsonData).toEqual(input.options.secureJsonData);
        rerender(<ConfigEditor {...input} options={enabled} />);
        fireEvent.click(screen.getByRole('checkbox', { name: /^Enable SSO/ }));
        expect(input.onOptionsChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ jsonData: expect.objectContaining({ enableSso: false, oauthPassThru: false }) }),
        );
    });

    it.each([undefined, false])('repairs existing SSO configurations with oauthPassThru=%s when opened', oauthPassThru => {
        const input = props({ enableSso: true, oauthPassThru, oidcIssuer: 'https://idp.example', host: 'doris.example' });
        const { rerender } = render(<ConfigEditor {...input} />);
        expect(input.onOptionsChange).toHaveBeenCalledTimes(1);
        const updated = (input.onOptionsChange as jest.Mock).mock.calls[0][0];
        expect(updated.jsonData).toEqual({ ...input.options.jsonData, oauthPassThru: true });
        expect(updated.secureJsonData).toEqual(input.options.secureJsonData);
        rerender(<ConfigEditor {...input} options={updated} />);
        expect(input.onOptionsChange).toHaveBeenCalledTimes(1);
    });

    it('preserves legacy SSO mode while repairing forwarding', () => {
        const input = props({ oidcIssuer: 'https://idp.example' });
        render(<ConfigEditor {...input} />);
        expect(input.onOptionsChange).toHaveBeenCalledWith(
            expect.objectContaining({ jsonData: expect.objectContaining({ enableSso: true, oauthPassThru: true }) }),
        );
    });

    it('turns off stale identity forwarding for explicit password authentication', () => {
        const input = props({ enableSso: false, oauthPassThru: true });
        render(<ConfigEditor {...input} />);
        expect(input.onOptionsChange).toHaveBeenCalledWith(
            expect.objectContaining({ jsonData: expect.objectContaining({ enableSso: false, oauthPassThru: false }) }),
        );
    });
});

describe('Doris TLS certificate verification', () => {
    it.each([true, false])('can select REQUIRED-style verification with enableSso=%s while preserving IDP settings', enableSso => {
        const input = props({ enableSso, oauthPassThru: enableSso, tlsEnabled: true, idpTlsSkipVerify: false });
        const { rerender } = render(<ConfigEditor {...input} />);
        const toggle = screen.getByRole('checkbox', { name: 'Verify Doris TLS certificate' });
        expect(toggle).toBeChecked();
        fireEvent.click(toggle);
        const updated = (input.onOptionsChange as jest.Mock).mock.calls[0][0];
        expect(updated.jsonData).toEqual(expect.objectContaining({ tlsEnabled: true, tlsSkipVerify: true, idpTlsSkipVerify: false, enableSso }));
        expect(updated.secureJsonData).toEqual(input.options.secureJsonData);
        rerender(<ConfigEditor {...input} options={updated} />);
        expect(screen.getByRole('checkbox', { name: 'Verify Doris TLS certificate' })).not.toBeChecked();
        fireEvent.click(screen.getByRole('checkbox', { name: 'Verify Doris TLS certificate' }));
        expect(input.onOptionsChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ jsonData: expect.objectContaining({ tlsEnabled: true, tlsSkipVerify: false, idpTlsSkipVerify: false }) }),
        );
    });

    it('hides certificate verification when TLS is disabled', () => {
        render(<ConfigEditor {...props({ enableSso: false, tlsEnabled: false })} />);
        expect(screen.queryByRole('checkbox', { name: 'Verify Doris TLS certificate' })).not.toBeInTheDocument();
    });
});
