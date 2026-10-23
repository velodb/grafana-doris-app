import { config } from '@grafana/runtime';
import { createInstance } from 'i18next';
import { createPluginI18n, getGrafanaLanguage, normalizeLanguage, pluginI18n, t } from './index';
import en from './locales/en-US.json';
import zh from './locales/zh-CN.json';
import { getQuerySuggestions } from 'components/discover-header/query-completion';
import { normalizeColumnType } from 'utils/query-parser/column-types';
import { getQueryErrorMessage, createDiscoverQueryError } from 'utils/query-error';

jest.mock('@grafana/runtime', () => ({ config: { bootData: { user: { language: 'en-US' } } } }));

afterEach(async () => {
    config.bootData.user.language = 'en-US';
    await pluginI18n.changeLanguage('en-US');
});

it.each([
    [undefined, 'en-US'],
    ['', 'en-US'],
    ['en', 'en-US'],
    ['en-GB', 'en-US'],
    ['fr-FR', 'en-US'],
    ['zh-TW', 'en-US'],
    ['zh', 'zh-CN'],
    ['ZH_cn', 'zh-CN'],
    ['zh-CN', 'zh-CN'],
    ['zh-Hans', 'zh-CN'],
    ['zh-Hans-CN', 'zh-CN'],
])('normalizes %s to %s', (language, expected) => {
    expect(normalizeLanguage(language)).toBe(expected);
});

it('uses Grafana settings even when the browser prefers another language', () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'language');
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'zh-CN' });
    try {
        config.bootData.user.language = 'en-US';
        expect(getGrafanaLanguage()).toBe('en-US');
        config.bootData.user.language = 'zh-CN';
        expect(getGrafanaLanguage()).toBe('zh-CN');
        config.bootData.user.language = '';
        expect(getGrafanaLanguage()).toBe('en-US');
    } finally {
        if (original) {
            Object.defineProperty(navigator, 'language', original);
        } else {
            Reflect.deleteProperty(navigator, 'language');
        }
    }
});

it('initializes translated resources synchronously and falls back for missing keys', () => {
    const instance = createPluginI18n('zh-CN');
    expect(instance.isInitialized).toBe(true);
    expect(instance.t('Save')).toBe('保存');
    instance.removeResourceBundle('zh-CN', 'translation');
    instance.addResourceBundle('zh-CN', 'translation', { Query: '查询' });
    expect(instance.t('Query')).toBe('查询');
    expect(instance.t('Save')).toBe('Save');
    expect(createPluginI18n('fr-FR').t('Save')).toBe('Save');
});

it('keeps the English and Chinese catalogs and interpolation parameters in sync', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    const parameters = (text: string) => [...text.matchAll(/{{\s*([^}]+)\s*}}/g)].map(match => match[1].trim()).sort();
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
        expect(en[key].trim()).not.toBe('');
        expect(zh[key].trim()).not.toBe('');
        expect(parameters(zh[key])).toEqual(parameters(en[key]));
    }
});

it('interpolates counts, plural forms, and user values in both languages', async () => {
    expect(t('{{count}} groups', { count: 0 })).toBe('0 groups');
    expect(t('{{count}} groups', { count: 1 })).toBe('1 group');
    expect(t('{{count}} groups', { count: 2000 })).toBe('2,000 groups');
    await pluginI18n.changeLanguage('zh-CN');
    expect(t('{{count}} groups', { count: 1 })).toBe('1 个分组');
    expect(t('{{count}} groups', { count: 2000 })).toBe('2,000 个分组');
    expect(t('Field statistics: {{field}}', { field: 'service_name' })).toBe('字段统计：service_name');
});

it('does not modify another translation instance', async () => {
    const host = createInstance();
    await host.init({ lng: 'fr', resources: { fr: { translation: { Save: 'Enregistrer' } } } });
    await pluginI18n.changeLanguage('zh-CN');
    expect(host.language).toBe('fr');
    expect(host.t('Save')).toBe('Enregistrer');
});

it('translates completion descriptions at use time and keeps query syntax and types unchanged', async () => {
    await pluginI18n.changeLanguage('zh-CN');
    const operators = getQuerySuggestions({ mode: 'sql', query: '`service_name`', fields: [{ Field: 'service_name', Type: 'STRING' }], rows: [] });
    expect(operators).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'LIKE', detail: '模式匹配' })]));
    expect(normalizeColumnType({ columnType: 'VARCHAR(255)' })).toBe('String');
    expect(normalizeColumnType({ columnType: 'VARIANT' })).toBe('Variant');
});

it('preserves original backend messages and SQL while translating error explanations', async () => {
    const message = 'Syntax error at line 1, column 7: unexpected bad_column';
    await pluginI18n.changeLanguage('zh-CN');
    expect(getQueryErrorMessage({ backendError: message })).toBe(message);
    const error = createDiscoverQueryError({ backendError: message, generatedSql: 'SELECT bad_column FROM logs' }, { source: 'results', searchType: 'SQL' });
    expect(error.message).toBe(message);
    expect(error.generatedSql).toBe('SELECT bad_column FROM logs');
    expect(error.summary).toBe('查询失败');
    expect(error.likelyCause).toContain('关键字');
});

it.each(['en-US', 'zh-CN'])('initializes the plugin and date locale from Grafana %s on a fresh entry', language => {
    config.bootData.user.language = language;
    jest.isolateModules(() => {
        const entry = require('./index');
        const isolatedDayjs = require('dayjs');
        expect(entry.pluginI18n.language).toBe(language);
        expect(isolatedDayjs.locale()).toBe(language === 'zh-CN' ? 'zh-cn' : 'en');
    });
});
