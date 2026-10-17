export function storeRoutes() {
  return {
    basePath: '/stores',
    routes: [
      {
        method: 'get',
        path: '/',
        access: { permission: 'org:read' },
        handler: async (req) => {
          const stores = await req.db.store.findMany({ orderBy: { createdAt: 'asc' } });
          return stores.map((s) => ({
            id: s.id,
            name: s.name,
            slug: s.slug,
            currency: s.currency,
            timezone: s.timezone,
            status: s.status,
          }));
        },
      },
    ],
  };
}
