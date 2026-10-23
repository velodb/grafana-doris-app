import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ConfigEditor } from './ConfigEditor';
import type { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import type { DorisSSOJsonData, DorisSecureJsonData } from './types';

type Props = DataSourcePluginOptionsEditorProps<DorisSSOJsonData, DorisSecureJsonData>;
function props(jsonData: DorisSSOJsonData = { enableSso: true }): Props {
    return {
        options: { jsonData, secureJsonData: { password: 'existing-password', tlsCACert: 'doris-ca' }, secureJsonFields: { password: true } },
        onOptionsChange: jest.fn(),
    } as unknown as Props;
}

describe('IDP TLS configuration', () => {
    it('verifies certificates by default and persists an explicit opt-out', () => {
        const input = props();
        render(<ConfigEditor {...input} />);
        const toggle = screen.getByRole('checkbox', { name: 'Skip IDP TLS certificate verification' });
        expect(toggle).not.toBeChecked();
        fireEvent.click(toggle);
        expect(input.onOptionsChange).toHaveBeenCalledWith(expect.objectContaining({ jsonData: expect.objectContaining({ idpTlsSkipVerify: true }) }));
    });

    it('stores PEM in secure data while preserving other secure fields', () => {
        const input = props();
        render(<ConfigEditor {...input} />);
        fireEvent.change(screen.getByRole('textbox', { name: 'IDP CA certificate' }), { target: { value: 'pem-bundle' } });
        expect(input.onOptionsChange).toHaveBeenCalledWith(
            expect.objectContaining({
                secureJsonData: { password: 'existing-password', tlsCACert: 'doris-ca', idpTlsCACert: 'pem-bundle' },
            }),
        );
    });

    it('shows configured state without revealing saved content and supports replacement', () => {
        const input = props();
        input.options.secureJsonFields!.idpTlsCACert = true;
        const { rerender } = render(<ConfigEditor {...input} />);
        expect(screen.getByText('IDP CA certificate configured')).toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: 'IDP CA certificate' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Reset IDP CA certificate' }));
        const updated = (input.onOptionsChange as jest.Mock).mock.calls.at(-1)[0];
        expect(updated.secureJsonFields).toEqual({ password: true, idpTlsCACert: false });
        expect(updated.secureJsonData).toEqual({ password: 'existing-password', tlsCACert: 'doris-ca', idpTlsCACert: '' });
        rerender(<ConfigEditor {...input} options={updated} />);
        fireEvent.change(screen.getByRole('textbox', { name: 'IDP CA certificate' }), { target: { value: 'replacement' } });
        expect(input.onOptionsChange).toHaveBeenLastCalledWith(expect.objectContaining({ secureJsonData: expect.objectContaining({ idpTlsCACert: 'replacement' }) }));
    });

    it('keeps CA editable when skipping and preserves settings when disabling SSO', () => {
        const input = props({ enableSso: true, idpTlsSkipVerify: true });
        render(<ConfigEditor {...input} />);
        expect(screen.getByRole('textbox', { name: 'IDP CA certificate' })).toBeEnabled();
        expect(screen.getByText(/It will be used when certificate verification/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('checkbox', { name: 'Enable SSO' }));
        expect(input.onOptionsChange).toHaveBeenCalledWith(
            expect.objectContaining({
                jsonData: expect.objectContaining({ enableSso: false, idpTlsSkipVerify: true }),
                secureJsonData: input.options.secureJsonData,
            }),
        );
    });

    it('hides IDP TLS settings in basic authentication mode', () => {
        render(<ConfigEditor {...props({ enableSso: false })} />);
        expect(screen.queryByRole('checkbox', { name: 'Skip IDP TLS certificate verification' })).not.toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: 'IDP CA certificate' })).not.toBeInTheDocument();
    });
});
