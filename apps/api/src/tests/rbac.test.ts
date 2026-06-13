import { describe, expect, it } from 'vitest';
import { canRoleAccess } from '@autopilotops/shared';

describe('RBAC role hierarchy', () => {
  it('allows higher roles to access lower-role routes', () => {
    expect(canRoleAccess('OWNER', 'ADMIN')).toBe(true);
    expect(canRoleAccess('ADMIN', 'MANAGER')).toBe(true);
    expect(canRoleAccess('OPERATOR', 'VIEWER')).toBe(true);
  });

  it('blocks lower roles from privileged routes', () => {
    expect(canRoleAccess('VIEWER', 'OPERATOR')).toBe(false);
    expect(canRoleAccess('OPERATOR', 'MANAGER')).toBe(false);
    expect(canRoleAccess('MANAGER', 'ADMIN')).toBe(false);
  });

});
