import { mergeLogsConfig, normalizeApplicationAttributeKey } from './plugin-settings';

describe('plugin settings', () => {
  it('defaults the application resource attribute key to app', () => {
    expect(mergeLogsConfig().applicationAttributeKey).toBe('app');
    expect(mergeLogsConfig({ database: 'logs' }).applicationAttributeKey).toBe('app');
  });

  it('trims configured application resource attribute keys', () => {
    expect(normalizeApplicationAttributeKey('  k8s.pod.label.app  ')).toBe('k8s.pod.label.app');
    expect(mergeLogsConfig({ applicationAttributeKey: '  service.name ' }).applicationAttributeKey).toBe('service.name');
  });
});
