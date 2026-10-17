// Role → permission matrix. This is the single source of truth for authorization and mirrors
// the table in docs/architecture.md. The frontend receives the caller's permission list to
// decide what to show, but every check that matters happens on the server.

export const ROLES = ['OWNER', 'MANAGER', 'INVENTORY_MANAGER', 'ORDER_MANAGER', 'ANALYST'];

export const ROLE_LABELS = {
  OWNER: 'Owner',
  MANAGER: 'Store manager',
  INVENTORY_MANAGER: 'Inventory manager',
  ORDER_MANAGER: 'Order manager',
  ANALYST: 'Analyst',
};

const MATRIX = {
  'org:read': ['OWNER', 'MANAGER', 'INVENTORY_MANAGER', 'ORDER_MANAGER', 'ANALYST'],
  'org:update': ['OWNER'],
  'org:transfer_ownership': ['OWNER'],
  'member:read': ['OWNER', 'MANAGER'],
  'member:manage': ['OWNER'],
  'product:read': ['OWNER', 'MANAGER', 'INVENTORY_MANAGER', 'ORDER_MANAGER', 'ANALYST'],
  'product:write': ['OWNER', 'MANAGER'],
  'inventory:read': ['OWNER', 'MANAGER', 'INVENTORY_MANAGER', 'ORDER_MANAGER', 'ANALYST'],
  'inventory:adjust': ['OWNER', 'MANAGER', 'INVENTORY_MANAGER'],
  'customer:read': ['OWNER', 'MANAGER', 'ORDER_MANAGER'],
  'customer:write': ['OWNER', 'MANAGER', 'ORDER_MANAGER'],
  'customer:export': ['OWNER', 'MANAGER'],
  'order:read': ['OWNER', 'MANAGER', 'ORDER_MANAGER'],
  'order:write': ['OWNER', 'MANAGER', 'ORDER_MANAGER'],
  'order:transition': ['OWNER', 'MANAGER', 'ORDER_MANAGER'],
  'order:cancel': ['OWNER', 'MANAGER', 'ORDER_MANAGER'],
  'report:read': ['OWNER', 'MANAGER', 'ANALYST'],
  'report:export': ['OWNER', 'MANAGER', 'ANALYST'],
  'billing:read': ['OWNER'],
  'billing:manage': ['OWNER'],
  'audit:read': ['OWNER'],
};

export const PERMISSIONS = Object.keys(MATRIX);

const BY_ROLE = Object.fromEntries(
  ROLES.map((role) => [role, PERMISSIONS.filter((p) => MATRIX[p].includes(role))]),
);

export function permissionsFor(role) {
  return BY_ROLE[role] ?? [];
}

export function roleHas(role, permission) {
  if (!MATRIX[permission]) throw new Error(`Unknown permission: ${permission}`);
  return MATRIX[permission].includes(role);
}
