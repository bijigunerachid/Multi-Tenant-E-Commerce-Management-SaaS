export const ROLE_OPTIONS = [
  {
    value: 'MANAGER',
    label: 'Store manager',
    description: 'Products, inventory, orders, customers and reports',
  },
  {
    value: 'INVENTORY_MANAGER',
    label: 'Inventory manager',
    description: 'Stock levels and stock movements',
  },
  {
    value: 'ORDER_MANAGER',
    label: 'Order manager',
    description: 'Orders, fulfilment and related customers',
  },
  { value: 'ANALYST', label: 'Analyst', description: 'Read-only access to reports and analytics' },
];

export const ROLE_LABELS = {
  OWNER: 'Owner',
  ...Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r.label])),
};
