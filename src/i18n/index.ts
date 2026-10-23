import { config } from '@grafana/runtime';
import { createInstance, type i18n } from 'i18next';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import en from './locales/en-US.json';
import zh from './locales/zh-CN.json';

export type PluginLanguage = 'en-US' | 'zh-CN';
export type TranslationKey = keyof typeof en;

export function normalizeLanguage(language?: string): PluginLanguage {
    const normalized = language?.trim().replace(/_/g, '-').toLowerCase();
    return normalized === 'zh' || normalized === 'zh-cn' || normalized === 'zh-hans' || normalized === 'zh-hans-cn' ? 'zh-CN' : 'en-US';
}

export function getGrafanaLanguage(): PluginLanguage {
    return normalizeLanguage(config?.bootData?.user?.language);
}

/** Local resources initialize synchronously; never share Grafana's translation instance. */
export function createPluginI18n(language?: string): i18n {
    const instance = createInstance();
    void instance.init({
        lng: normalizeLanguage(language),
        fallbackLng: 'en-US',
        supportedLngs: ['en-US', 'zh-CN'],
        resources: { 'en-US': { translation: en }, 'zh-CN': { translation: zh } },
        initImmediate: false,
        keySeparator: false,
        nsSeparator: false,
        interpolation: { escapeValue: false },
        returnNull: false,
    });
    return instance;
}

export const pluginI18n = createPluginI18n(getGrafanaLanguage());
dayjs.locale(pluginI18n.language === 'zh-CN' ? 'zh-cn' : 'en');

export function t(key: TranslationKey, values?: Record<string, unknown>): string {
    return pluginI18n.t(key, { ...values, defaultValue: en[key] });
}
