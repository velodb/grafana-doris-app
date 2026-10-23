import { toError } from '../errors';

describe('toError', () => {
  it('preserves Error instances', () => {
    const error = new TypeError('Invalid query');

    expect(toError(error)).toBe(error);
  });

  it.each([
    ['a string error', 'Datasource unavailable', 'Datasource unavailable'],
    ['an object message', { message: 'Permission denied' }, 'Permission denied'],
    ['a blank object message', { message: '   ' }, 'Unknown error'],
    ['an object without a string message', { message: 503 }, 'Unknown error'],
    ['null', null, 'Unknown error'],
  ])('normalizes %s', (_description, value, expectedMessage) => {
    expect(toError(value).message).toBe(expectedMessage);
  });
});
