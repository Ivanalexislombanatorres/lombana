import { describe, expect, it } from 'vitest';
import { classifyDbError } from './diagnostics';

describe('classifyDbError', () => {
  it.each([
    [{ code: '28P01', message: 'password authentication failed for user "x"' }, 'auth_failed'],
    [{ code: 'XX000', message: 'Tenant or user not found' }, 'pooler_tenant_not_found'],
    [{ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND host' }, 'dns_failed'],
    [{ message: 'Connection terminated due to connection timeout' }, 'timeout'],
    [{ code: '42P01', message: 'relation does not exist' }, 'schema_missing'],
    [{ message: 'algo raro' }, 'other'],
  ])('%o → %s', (err, expected) => {
    expect(classifyDbError(err)).toBe(expected);
  });
});
