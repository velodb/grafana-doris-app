import { buildDorisBootstrapSQL, isSSOEnabled } from './ConfigEditor';

describe('SSO mode selection', () => {
  it('defaults new datasources to basic authentication while preserving legacy SSO configurations', () => {
    expect(isSSOEnabled({})).toBe(false);
    expect(isSSOEnabled({ oidcIssuer: 'https://idp.example' })).toBe(true);
    expect(isSSOEnabled({ oidcIssuer: 'https://idp.example', enableSso: false })).toBe(false);
  });
});

describe('buildDorisBootstrapSQL', () => {
  it('maps original OIDC groups to Doris roles in bootstrap SQL', () => {
    const sql = buildDorisBootstrapSQL({
      dorisRole: 'doris_reader',
      groupRoleMappings: [
        { oidcGroup: '/doris-readers', dorisRole: 'doris_reader' },
        { oidcGroup: '/doris-writers', dorisRole: 'doris_writer' },
      ],
    }, {
      configured: true,
      issuer: 'https://grafana.example/doris-sso',
      jwksPublicUrl: 'https://grafana.example/.well-known/jwks.json',
      audience: 'velodb-doris:datasource-a',
    });

    expect(sql).toContain("'oidc.groups_claim'='doris_groups'");
    expect(sql).toContain("'oidc.allowed_audiences'='velodb-doris:datasource-a'");
    expect(sql).toContain('CREATE AUTHENTICATION INTEGRATION `grafana_doris_sso_datasource_a`');
    expect(sql).toContain('CREATE ROLE MAPPING `grafana_doris_sso_datasource_a_roles`');
    expect(sql.match(/CREATE ROLE `doris_reader`;/g)).toHaveLength(1);
    expect(sql).toContain(`has_group("/doris-readers")`);
    expect(sql).toContain(`has_group("/doris-writers")`);
    expect(sql).not.toContain(`has_group("doris_reader")`);
  });

  it('does not create an implicit default role mapping', () => {
    const sql = buildDorisBootstrapSQL({ dorisRole: 'doris_reader' });

    expect(sql).toContain('-- No Doris roles configured.');
    expect(sql).toContain('-- Add an OIDC group to Doris role mapping before creating a role mapping.');
    expect(sql).not.toContain('CREATE ROLE `doris_reader`;');
  });
});
