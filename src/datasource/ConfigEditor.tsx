import React from 'react';
import type { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { Button, Field, Input, SecretInput, Switch, TextArea } from '@grafana/ui';
import type { DorisSSOJsonData, GroupRoleMapping } from './types';

type Props = DataSourcePluginOptionsEditorProps<DorisSSOJsonData>;
export interface SSOProfileStatus {
    configured: boolean;
    issuer?: string;
    jwksPublicUrl?: string;
    signingKeyID?: string;
    audience?: string;
    message?: string;
}

const sectionHeadingStyle = { fontSize: '20px', lineHeight: '28px' };
function normalizedJsonData(data: DorisSSOJsonData): DorisSSOJsonData {
    return {
        ...data,
        providerMode: 'oidcDiscovery',
        groupRoleMappings: data.groupRoleMappings?.map(mapping => ({ oidcGroup: mapping.oidcGroup ?? mapping.keycloakGroup ?? '', dorisRole: mapping.dorisRole })),
    };
}

export function isSSOEnabled(data: DorisSSOJsonData) {
    // Existing datasource configurations predate the toggle and were SSO-only.
    return data.enableSso ?? Boolean(data.oidcIssuer || data.keyrockIssuer || data.oauthPassThru);
}
const update = (props: Props, key: keyof DorisSSOJsonData, value: unknown) =>
    props.onOptionsChange({ ...props.options, jsonData: { ...normalizedJsonData(props.options.jsonData), [key]: value } });
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
    const mappings = (data.groupRoleMappings ?? [])
        .map(mapping => ({
            oidcGroup: (mapping.oidcGroup ?? mapping.keycloakGroup ?? '').trim(),
            dorisRole: mapping.dorisRole.trim(),
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
    const data = props.options.jsonData;
    const ssoEnabled = isSSOEnabled(data);
    const tlsEnabled = ssoEnabled || data.tlsEnabled || Boolean(data.tlsServerName);
    const mappings = data.groupRoleMappings ?? [];
    const datasourceUID = props.options.uid;
    const [profile, setProfile] = React.useState<SSOProfileStatus | undefined>();

    React.useEffect(() => {
        if (!datasourceUID || !ssoEnabled) {
            setProfile(undefined);
            return;
        }
        const subscription = getBackendSrv()
            .fetch<SSOProfileStatus>({ url: `/api/datasources/uid/${datasourceUID}/resources/profile` })
            .subscribe({
                next: response => setProfile(response.data),
                error: error => setProfile({ configured: false, message: error?.message ?? 'Unable to read the deployment SSO Profile.' }),
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
        <>
            <h2 style={sectionHeadingStyle}>Connection</h2>
            <Field label="Doris host">
                <Input value={data.host ?? ''} onChange={e => update(props, 'host', e.currentTarget.value)} />
            </Field>
            <Field label="Doris MySQL port">
                <Input type="number" value={data.port ?? 9030} onChange={e => update(props, 'port', Number(e.currentTarget.value))} />
            </Field>
            <Field label="Enable TLS" description={ssoEnabled ? 'TLS is required when SSO is enabled.' : 'Enable this when the Doris MySQL port is configured for TLS.'}>
                <Switch value={tlsEnabled} disabled={ssoEnabled} onChange={event => update(props, 'tlsEnabled', event.currentTarget.checked)} />
            </Field>
            <Field label="Default database">
                <Input value={data.database ?? ''} onChange={e => update(props, 'database', e.currentTarget.value)} />
            </Field>
            <Field label="Enable SSO" description="When disabled, the datasource uses the configured shared Doris username and password.">
                <Switch value={ssoEnabled} onChange={event => update(props, 'enableSso', event.currentTarget.checked)} />
            </Field>
            {!ssoEnabled ? (
                <>
                    <Field label="Doris username">
                        <Input value={data.username ?? ''} onChange={e => update(props, 'username', e.currentTarget.value)} />
                    </Field>
                    <Field label="Doris password">
                        <SecretInput
                            isConfigured={Boolean(props.options.secureJsonFields?.password)}
                            placeholder="Doris password"
                            value=""
                            onChange={event => updatePassword(event.currentTarget.value)}
                            onReset={resetPassword}
                        />
                    </Field>
                </>
            ) : (
                <>
                    <h2 style={sectionHeadingStyle}>Identity and access</h2>
                    <Field label="OIDC issuer" description="The issuer must expose /.well-known/openid-configuration.">
                        <Input
                            placeholder="https://idp.example.com/realms/velodb"
                            value={data.oidcIssuer ?? ''}
                            onChange={e => update(props, 'oidcIssuer', e.currentTarget.value)}
                        />
                    </Field>
                    <Field label="OIDC audience / Grafana OAuth Client ID">
                        <Input value={data.oidcAudience ?? ''} onChange={e => update(props, 'oidcAudience', e.currentTarget.value)} />
                    </Field>
                    <Field label="Resolved identity provider" description="Derived values are validated by Save & test; they are not independently editable.">
                        <TextArea
                            readOnly
                            rows={4}
                            value={`Issuer: ${data.oidcIssuer || '<not configured>'}\nJWKS: Resolved through OIDC Discovery when saved/tested\nAudience: ${
                                data.oidcAudience || '<not configured>'
                            }`}
                        />
                    </Field>
                    <Field
                        label="OIDC group to Doris role mappings"
                        description="Match complete OIDC group paths exactly, for example /team/readers. These rules generate the Doris authorization SQL; the datasource forwards verified OIDC groups unchanged."
                    >
                        <div>
                            {mappings.map((mapping, index) => (
                                <div key={index} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                                    <Input
                                        aria-label={`OIDC group ${index + 1}`}
                                        placeholder="/team/readers"
                                        value={mapping.oidcGroup ?? mapping.keycloakGroup ?? ''}
                                        onChange={e => {
                                            const next = [...mappings];
                                            next[index] = { oidcGroup: e.currentTarget.value, dorisRole: mapping.dorisRole };
                                            updateMappings(props, next);
                                        }}
                                    />
                                    <Input
                                        aria-label={`Doris role ${index + 1}`}
                                        placeholder="doris_reader"
                                        value={mapping.dorisRole}
                                        onChange={e => {
                                            const next = [...mappings];
                                            next[index] = { ...mapping, dorisRole: e.currentTarget.value };
                                            updateMappings(props, next);
                                        }}
                                    />
                                    <Button
                                        aria-label={`Remove group mapping ${index + 1}`}
                                        variant="secondary"
                                        onClick={() =>
                                            updateMappings(
                                                props,
                                                mappings.filter((_, row) => row !== index),
                                            )
                                        }
                                    >
                                        Remove
                                    </Button>
                                </div>
                            ))}
                            <Button variant="secondary" onClick={() => updateMappings(props, [...mappings, { oidcGroup: '', dorisRole: '' }])}>
                                Add group mapping
                            </Button>
                        </div>
                    </Field>
                    <h2 style={sectionHeadingStyle}>Doris SSO bootstrap</h2>
                    {!datasourceUID ? <p>Save this datasource first to generate its Doris token audience and bootstrap SQL.</p> : null}
                    {datasourceUID && !profile ? <p>Loading the deployment SSO Profile…</p> : null}
                    {profile && !profile.configured ? <p>Doris SSO Profile is unavailable: {profile.message ?? 'Contact the Grafana deployment administrator.'}</p> : null}
                    {profile?.configured ? (
                        <div>
                            <p>Doris SSO Profile: Configured ✓</p>
                            <p>
                                Issuer: {profile.issuer}
                                <br />
                                JWKS: {profile.jwksPublicUrl}
                                <br />
                                Audience: {profile.audience}
                                <br />
                                Signing key: configured ✓
                            </p>
                        </div>
                    ) : null}
                    {profile?.configured ? (
                        <div style={{ marginTop: 32 }}>
                            <Field
                                label="Doris bootstrap SQL"
                                description="Run this once for this datasource as a Doris administrator after enabling FE TLS. Each datasource has its own integration and audience; the datasource never applies SQL automatically."
                            >
                                <TextArea value={dorisSQL} readOnly rows={14} />
                            </Field>
                        </div>
                    ) : null}
                </>
            )}
        </>
    );
}
