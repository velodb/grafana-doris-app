// force timezone to UTC to allow tests to work regardless of local timezone
// generally used by snapshots, but can affect specific tests
process.env.TZ = 'UTC';

const baseConfig = require('./.config/jest.config');

module.exports = {
  // Jest configuration provided by Grafana scaffolding
  ...baseConfig,
  moduleNameMapper: {
    ...(baseConfig.moduleNameMapper || {}),
    '^react-dom/client$': '<rootDir>/jest-react-dom-client.js',
    '^lodash-es$': 'lodash',
    '^nanoid$': '<rootDir>/jest-nanoid.js',
  },
};
