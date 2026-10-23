import { t } from 'i18n';
import React from 'react';
import type { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { Button, Field, Input, SecretInput, Switch, TextArea } from '@grafana/ui';
import type { DorisSSOJsonData, DorisSecureJsonData, GroupRoleMapping } from './types';

type Props = DataSourcePluginOptionsEditorProps<DorisSSOJsonData, DorisSecureJsonData>;
export interface SSOProfileStatus {
    configured: boolean;
    issuer?: string;
    jwksPublicUrl?: string;
    signingKeyID?: string;
    audience?: string;
    message?: string;
}

const sectionHeadingStyle = { fontSize: '20px', lineHeight: '28px' };
// Grafana owns the Default control outside ConfigEditor. Keep its legacy switch
// and newer action button hidden only while this datasource editor is mounted.
const hiddenDefaultControls = `
    body:has([data-doris-datasource-config]) .gf-form-inline > :has(#basic-settings-default),
    body:has([data-doris-datasource-config]) .gf-form-button-row > button:not([data-testid]):has(+ button[type="submit"]) {
        display: none;
    }
`;

function normalizedJsonData(data?: DorisSSOJsonData): DorisSSOJsonData {
    const source = data ?? {};
    return {
        ...source,
        providerMode: 'oidcDiscovery',
        groupRoleMappings: Array.isArray(source.groupRoleMappings)
            ? source.groupRoleMappings
                  .filter((mapping): mapping is GroupRoleMapping => Boolean(mapping) && typeof mapping === 'object')
                  .map(mapping => ({
                      oidcGroup: mapping.oidcGroup ?? mapping.keycloakGroup ?? '',
                      dorisRole: typeof mapping.dorisRole === 'string' ? mapping.dorisRole : '',
                  }))
            : [],
    };
}

export function isSSOEnabled(data?: DorisSSOJsonData) {
    // Existing datasource configurations predate the toggle and were SSO-only.
    return data?.enableSso ?? Boolean(data?.oidcIssuer || data?.keyrockIssuer || data?.oauthPassThru);
}
const update = (props: Props, key: keyof DorisSSOJsonData, value: unknown) => {
    const jsonData = { ...normalizedJsonData(props.options.jsonData), [key]: value };
    props.onOptionsChange({ ...props.options, jsonData: { ...jsonData, oauthPassThru: isSSOEnabled(jsonData) } });
};
const updateMappings = (props: Props, mappings: GroupRoleMapping[]) => update(props, 'groupRoleMappings', mappings);
function quoteIdentifier(value: string) {
    return `\`${value.replace(/`/g, '``')}\``;
}

function quoteCelString(value: string) {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'");
}

function bootstrapIdentifier(profile?: SSOProfileStatus) {
    const uid = profile?.audience?.startsWith('velodb-doris:') ? profile.audience.slice('velodb-doris:'.length) : 'datasource';
    const suffix =
        uid
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 40) || 'datasource';
    return `grafana_doris_sso_${suffix}`;
}

export function buildDorisBootstrapSQL(data: DorisSSOJsonData, profile?: SSOProfileStatus) {
    const mappings = (Array.isArray(data?.groupRoleMappings) ? data.groupRoleMappings : [])
        .filter((mapping): mapping is GroupRoleMapping => Boolean(mapping) && typeof mapping === 'object')
        .map(mapping => ({
            oidcGroup: typeof (mapping.oidcGroup ?? mapping.keycloakGroup) === 'string' ? (mapping.oidcGroup ?? mapping.keycloakGroup)!.trim() : '',
            dorisRole: typeof mapping.dorisRole === 'string' ? mapping.dorisRole.trim() : '',
        }))
        .filter(mapping => mapping.oidcGroup && mapping.dorisRole);
    const roles = Array.from(new Set(mappings.map(mapping => mapping.dorisRole))).sort();
    const roleSQL = roles.map(role => `CREATE ROLE ${quoteIdentifier(role)};`).join('\n');
    const mappingSQL = mappings.map(mapping => `RULE (USING CEL 'has_group("${quoteCelString(mapping.oidcGroup)}")' GRANT ROLE ${quoteIdentifier(mapping.dorisRole)})`).join(',\n');
    const integration = bootstrapIdentifier(profile);
    const roleMapping = `${integration}_roles`;
    return `CREATE AUTHENTICATION INTEGRATION ${quoteIdentifier(integration)} PROPERTIES (
  'type'='oidc', 'enable_jit_user'='true',
  'oidc.issuer'='${profile?.issuer || '<doris-issuer>'}',
  'oidc.jwks_uri'='${profile?.jwksPublicUrl || '<public-jwks-url>'}',
  'oidc.allowed_audiences'='${profile?.audience || '<datasource-audience>'}',
  'oidc.required_scopes'='doris.query',
  'oidc.username_claim'='username', 'oidc.subject_claim'='sub',
  'oidc.groups_claim'='doris_groups', 'oidc.allowed_algorithms'='RS256'
);
${roleSQL || '-- No Doris roles configured.'}
${
    mappingSQL
        ? `CREATE ROLE MAPPING ${quoteIdentifier(roleMapping)} ON AUTHENTICATION INTEGRATION ${quoteIdentifier(integration)}
${mappingSQL};`
        : '-- Add an OIDC group to Doris role mapping before creating a role mapping.'
}`;
}

export function ConfigEditor(props: Props) {
    const { options, onOptionsChange } = props;
    const data = normalizedJsonData(props.options.jsonData);
    const ssoEnabled = isSSOEnabled(data);
    const tlsEnabled = ssoEnabled || data.tlsEnabled || Boolean(data.tlsServerName);
    const mappings = data.groupRoleMappings ?? [];
    const datasourceUID = props.options.uid;
    const [profile, setProfile] = React.useState<SSOProfileStatus | undefined>();

    // Repair existing SSO configurations so opening the editor and saving also
    // enables Grafana's token forwarding, even without toggling SSO again.
    React.useEffect(() => {
        const jsonData = options.jsonData;
        if (ssoEnabled ? jsonData.oauthPassThru === true : jsonData.oauthPassThru !== true) {
            return;
        }
        onOptionsChange({
            ...options,
            jsonData: { ...jsonData, enableSso: ssoEnabled, oauthPassThru: ssoEnabled },
        });
    }, [ssoEnabled, options, onOptionsChange]);

    React.useEffect(() => {
        if (!datasourceUID || !ssoEnabled) {
            setProfile(undefined);
            return;
        }
        const subscription = getBackendSrv()
            .fetch<SSOProfileStatus>({ url: `/api/datasources/uid/${datasourceUID}/resources/profile` })
            .subscribe({
                next: response => setProfile(response.data),
                error: error => setProfile({ configured: false, message: error?.message ?? t('Unable to read the deployment SSO Profile.') }),
            });
        return () => subscription.unsubscribe();
    }, [datasourceUID, ssoEnabled]);

    const updatePassword = (value: string) =>
        props.onOptionsChange({
            ...props.options,
            secureJsonData: { ...props.options.secureJsonData, password: value },
        });
    const resetPassword = () =>
        props.onOptionsChange({
            ...props.options,
            secureJsonData: { ...props.options.secureJsonData, password: '' },
            secureJsonFields: { ...props.options.secureJsonFields, password: false },
        });

    const dorisSQL = buildDorisBootstrapSQL(data, profile);
    return (
        <div data-doris-datasource-config>
            <style>{hiddenDefaultControls}</style>
            <h2 style={sectionHeadingStyle}>{t('Connection')}</h2>
            <Field label={t('Doris host')}>
                <Input value={data.host ?? ''} onChange={e => update(props, 'host', e.currentTarget.value)} />
            </Field>
            <Field label={t('Doris MySQL port')}>
                <Input type="number" value={data.port ?? 9030} onChange={e => update(props, 'port', Number(e.currentTarget.value))} />
            </Field>
            <Field label={t('Enable TLS')} description={ssoEnabled ? t('TLS is required when SSO is enabled.') : t('Enable this when the Doris MySQL port is configured for TLS.')}>
                <Switch value={tlsEnabled} disabled={ssoEnabled} onChange={event => update(props, 'tlsEnabled', event.currentTarget.checked)} />
            </Field>
            {tlsEnabled && (
                <Field
                    label={t('Verify Doris TLS certificate')}
                    description={t('When disabled, TLS remains encrypted, but the certificate\'s CA and host/IP are not verified (like MySQL ssl-mode=REQUIRED).')}
                >
                    <Switch
                        aria-label={t('Verify Doris TLS certificate')}
                        value={!data.tlsSkipVerify}
                        onChange={event => update(props, 'tlsSkipVerify', !event.currentTarget.checked)}
                    />
                </Field>
            )}
            <Field label={t('Enable SSO')} description={t('Automatically forwards the signed-in user\'s OAuth identity when enabled. When disabled, uses the configured shared Doris username and password.')}>
                <Switch aria-label={t('Enable SSO')} value={ssoEnabled} onChange={event => update(props, 'enableSso', event.currentTarget.checked)} />
            </Field>
            {!ssoEnabled ? (
                <>
                    <Field label={t('Doris username')}>
                        <Input value={data.username ?? ''} onChange={e => update(props, 'username', e.currentTarget.value)} />
                    </Field>
                    <Field label={t('Doris password')}>
                        <SecretInput
                            isConfigured={Boolean(props.options.secureJsonFields?.password)}
                            placeholder={t('Doris password')}
                            value={props.options.secureJsonData?.password ?? ''}
                            onChange={event => updatePassword(event.currentTarget.value)}
                            onReset={resetPassword}
                        />
                    </Field>
                </>
            ) : (
                <>
                    <h2 style={sectionHeadingStyle}>{t('Identity and access')}</h2>
                    <p>
                        {t('Administrators can save SSO configuration without signing in through OIDC. Save & test checks the configuration; without an OIDC ID token, SSO verification remains pending. An OIDC user with datasource query access can sign in and run a query in Explore or Doris App Discover to verify the connection. Datasource management permissions are not required.')}
                    </p>
                    <Field label={t('OIDC issuer')} description={t('The issuer must expose /.well-known/openid-configuration.')}>
                        <Input
                            placeholder="https://idp.example.com/realms/velodb"
                            value={data.oidcIssuer ?? ''}
                            onChange={e => update(props, 'oidcIssuer', e.currentTarget.value)}
                        />
                    </Field>
                    <Field label={t('OIDC audience / Grafana OAuth Client ID')}>
                        <Input value={data.oidcAudience ?? ''} onChange={e => update(props, 'oidcAudience', e.currentTarget.value)} />
                    </Field>
                    <Field
                        label={t('Skip IDP TLS certificate verification')}
                        description={t('Disables certificate chain and hostname verification for IDP Discovery and JWKS requests. Disabled by default; enable only for testing.')}
                    >
                        <Switch
                            aria-label={t('Skip IDP TLS certificate verification')}
                            value={data.idpTlsSkipVerify ?? false}
                            onChange={event => update(props, 'idpTlsSkipVerify', event.currentTarget.checked)}
                        />
                    </Field>
                    <Field
                        label={t('IDP CA certificate')}
                        description={
                            data.idpTlsSkipVerify
                                ? t('Paste a PEM CA bundle. It will be used when certificate verification is enabled again.')
                                : t('Optional PEM CA bundle added to the system trusted certificates for IDP Discovery and JWKS requests.')
                        }
                    >
                        {props.options.secureJsonFields?.idpTlsCACert ? (
                            <div>
                                <span>{t('IDP CA certificate configured')}</span>{' '}
                                <Button
                                    variant="secondary"
                                    onClick={() =>
                                        props.onOptionsChange({
                                            ...props.options,
                                            secureJsonData: { ...props.options.secureJsonData, idpTlsCACert: '' },
                                            secureJsonFields: { ...props.options.secureJsonFields, idpTlsCACert: false },
                                        })
                                    }
                                >
                                    {t('Reset IDP CA certificate')}
                                </Button>
                            </div>
                        ) : (
                            <TextArea
                                aria-label={t('IDP CA certificate')}
                                rows={6}
                                placeholder="-----BEGIN CERTIFICATE-----"
                                value={props.options.secureJsonData?.idpTlsCACert ?? ''}
                                onChange={event =>
                                    props.onOptionsChange({
                                        ...props.options,
                                        secureJsonData: { ...props.options.secureJsonData, idpTlsCACert: event.currentTarget.value },
                                    })
                                }
                            />
                        )}
                    </Field>
                    <Field label={t('Resolved identity provider')} description={t('Derived values are validated by Save & test; they are not independently editable.')}>
                        <TextArea
                            readOnly
                            rows={4}
                            value={t('Issuer: {{issuer}}\nJWKS: Resolved through OIDC Discovery when saved/tested\nAudience: {{audience}}', { issuer: data.oidcIssuer || t('<not configured>'), audience: data.oidcAudience || t('<not configured>') })}
                        />
                    </Field>
                    <Field
                        label={t('OIDC group to Doris role mappings')}
                        description={t('Match complete OIDC group paths exactly, for example /team/readers. These rules generate the Doris authorization SQL; the datasource forwards verified OIDC groups unchanged.')}
                    >
                        <div>
                            {mappings.map((mapping, index) => (
                                <div key={index} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                                    <Input
                                        aria-label={t('OIDC group {{index}}', { index: index + 1 })}
                                        placeholder="/team/readers"
                                        value={mapping.oidcGroup ?? mapping.keycloakGroup ?? ''}
                                        onChange={e => {
                                            const next = [...mappings];
                                            next[index] = { oidcGroup: e.currentTarget.value, dorisRole: mapping.dorisRole };
                                            updateMappings(props, next);
                                        }}
                                    />
                                    <Input
                                        aria-label={t('Doris role {{index}}', { index: index + 1 })}
                                        placeholder="doris_reader"
                                        value={mapping.dorisRole}
                                        onChange={e => {
                                            const next = [...mappings];
                                            next[index] = { ...mapping, dorisRole: e.currentTarget.value };
                                            updateMappings(props, next);
                                        }}
                                    />
                                    <Button
                                        aria-label={t('Remove group mapping {{index}}', { index: index + 1 })}
                                        variant="secondary"
                                        onClick={() =>
                                            updateMappings(
                                                props,
                                                mappings.filter((_, row) => row !== index),
                                            )
                                        }
                                    >
                                        {t('Remove')}
                                    </Button>
                                </div>
                            ))}
                            <Button variant="secondary" onClick={() => updateMappings(props, [...mappings, { oidcGroup: '', dorisRole: '' }])}>
                                {t('Add group mapping')}
                            </Button>
                        </div>
                    </Field>
                    <h2 style={sectionHeadingStyle}>{t('Doris SSO bootstrap')}</h2>
                    {!datasourceUID ? <p>{t('Save this datasource first to generate its Doris token audience and bootstrap SQL.')}</p> : null}
                    {datasourceUID && !profile ? <p>{t('Loading the deployment SSO Profile…')}</p> : null}
                    {profile && !profile.configured ? <p>{t('Doris SSO Profile is unavailable:')}{profile.message ?? t('Contact the Grafana deployment administrator.')}</p> : null}
                    {profile?.configured ? (
                        <div>
                            <p>{t('Doris SSO Profile: Configured ✓')}</p>
                            <p>
                                {t('Issuer:')}{profile.issuer}
                                <br />
                                {t('JWKS:')}{profile.jwksPublicUrl}
                                <br />
                                {t('Audience:')}{profile.audience}
                                <br />
                                {t('Signing key: configured ✓')}
                            </p>
                        </div>
                    ) : null}
                    {profile?.configured ? (
                        <div style={{ marginTop: 32 }}>
                            <Field
                                label={t('Doris bootstrap SQL')}
                                description={t('Run this once for this datasource as a Doris administrator after enabling FE TLS. Each datasource has its own integration and audience; the datasource never applies SQL automatically.')}
                            >
                                <TextArea value={dorisSQL} readOnly rows={14} />
                            </Field>
                        </div>
                    ) : null}
                </>
            )}
        </div>
    );
}
