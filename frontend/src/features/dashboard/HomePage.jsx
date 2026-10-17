import { useHasPermission } from '../auth/useSession.js';
import { OverviewPage } from '../organizations/OverviewPage.jsx';
import { DashboardPage } from './DashboardPage.jsx';

/** The home page is the sales dashboard for roles that may read reports, else the overview. */
export function HomePage() {
  const can = useHasPermission();
  return can('report:read') ? <DashboardPage /> : <OverviewPage />;
}
