import { MarketingLayout } from './MarketingLayout.jsx';
import { LandingPage } from './LandingPage.jsx';

/** The homepage as visitors see it: loaded on demand, so signed-in users never download it. */
export function PublicHome() {
  return (
    <MarketingLayout>
      <LandingPage />
    </MarketingLayout>
  );
}
