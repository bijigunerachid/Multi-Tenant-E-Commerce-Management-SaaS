import { createBrowserRouter } from 'react-router';
import { SystemStatusPage } from '../features/system/SystemStatusPage.jsx';
import { LoginPage } from '../features/auth/LoginPage.jsx';
import { RegisterPage } from '../features/auth/RegisterPage.jsx';
import { ForgotPasswordPage, ResetPasswordPage } from '../features/auth/PasswordResetPages.jsx';
import { VerifyEmailPage } from '../features/auth/VerifyEmailPage.jsx';
import { AcceptInvitationPage } from '../features/auth/AcceptInvitationPage.jsx';
import { OnboardingPage } from '../features/organizations/OnboardingPage.jsx';
import { AppLayout } from '../layouts/AppLayout.jsx';
import {
  GuestOnly,
  RequireAuth,
  RequireNoOrganization,
  RequireOrganization,
  RequirePermission,
} from './guards.jsx';
import { NotFoundPage } from './NotFoundPage.jsx';
import { RouteErrorPage } from './RouteErrorPage.jsx';
import { FullPageSpinner } from '../components/ui/Spinner.jsx';

// Pages inside the app shell are loaded on demand, one chunk per page, so signing in does not
// download the whole application.
const page = (load, name) => async () => ({ Component: (await load())[name] });
// Dashboard for report readers, organization overview for everyone else.
const HomePage = page(() => import('../features/dashboard/HomePage.jsx'), 'HomePage');
const EmployeesPage = page(() => import('../features/members/EmployeesPage.jsx'), 'EmployeesPage');
const OrganizationSettingsPage = page(
  () => import('../features/organizations/OrganizationSettingsPage.jsx'),
  'OrganizationSettingsPage',
);
const ProfilePage = page(() => import('../features/auth/ProfilePage.jsx'), 'ProfilePage');
const ProductsPage = page(() => import('../features/catalog/ProductsPage.jsx'), 'ProductsPage');
const ProductFormPage = page(
  () => import('../features/catalog/ProductFormPage.jsx'),
  'ProductFormPage',
);
const CategoriesPage = page(
  () => import('../features/catalog/CategoriesPage.jsx'),
  'CategoriesPage',
);
const InventoryPage = page(
  () => import('../features/inventory/InventoryPage.jsx'),
  'InventoryPage',
);
const MovementsPage = page(
  () => import('../features/inventory/MovementsPage.jsx'),
  'MovementsPage',
);
const CustomersPage = page(
  () => import('../features/customers/CustomersPage.jsx'),
  'CustomersPage',
);
const CustomerDetailPage = page(
  () => import('../features/customers/CustomerDetailPage.jsx'),
  'CustomerDetailPage',
);
const OrdersPage = page(() => import('../features/orders/OrdersPage.jsx'), 'OrdersPage');
const OrderFormPage = page(() => import('../features/orders/OrderFormPage.jsx'), 'OrderFormPage');
const EmailDeliveriesPage = page(
  () => import('../features/emails/EmailDeliveriesPage.jsx'),
  'EmailDeliveriesPage',
);
const NotificationsPage = page(
  () => import('../features/notifications/NotificationsPage.jsx'),
  'NotificationsPage',
);
const ReportsPage = page(() => import('../features/reports/ReportsPage.jsx'), 'ReportsPage');
const OrderDetailPage = page(
  () => import('../features/orders/OrderDetailPage.jsx'),
  'OrderDetailPage',
);

export const routes = [
  {
    errorElement: <RouteErrorPage />,
    // Shown while the first lazily loaded page of a visit is downloading.
    hydrateFallbackElement: <FullPageSpinner />,
    children: [
      { path: '/status', element: <SystemStatusPage /> },

      // Signed-out visitors
      {
        element: <GuestOnly />,
        children: [
          { path: '/login', element: <LoginPage /> },
          { path: '/register', element: <RegisterPage /> },
          { path: '/forgot-password', element: <ForgotPasswordPage /> },
        ],
      },

      // Links from emails: they work whether or not someone is signed in.
      { path: '/reset-password', element: <ResetPasswordPage /> },
      { path: '/verify-email', element: <VerifyEmailPage /> },
      { path: '/invitations/accept', element: <AcceptInvitationPage /> },

      // Signed-in users
      {
        element: <RequireAuth />,
        children: [
          {
            element: <RequireNoOrganization />,
            children: [{ path: '/onboarding', element: <OnboardingPage /> }],
          },
          { path: '/organizations/new', element: <OnboardingPage /> },
          {
            element: <RequireOrganization />,
            children: [
              {
                path: '/',
                element: <AppLayout />,
                handle: { crumb: 'Home' },
                children: [
                  { index: true, lazy: HomePage },
                  {
                    element: <RequirePermission permission="product:read" />,
                    children: [
                      {
                        path: 'products',
                        handle: { crumb: 'Products' },
                        children: [
                          { index: true, lazy: ProductsPage },
                          { path: 'new', lazy: ProductFormPage, handle: { crumb: 'New product' } },
                          {
                            path: ':productId',
                            lazy: ProductFormPage,
                            handle: { crumb: 'Product details' },
                          },
                        ],
                      },
                      { path: 'categories', lazy: CategoriesPage, handle: { crumb: 'Categories' } },
                    ],
                  },
                  {
                    element: <RequirePermission permission="inventory:read" />,
                    children: [
                      {
                        path: 'inventory',
                        handle: { crumb: 'Inventory' },
                        children: [
                          { index: true, lazy: InventoryPage },
                          {
                            path: 'movements',
                            lazy: MovementsPage,
                            handle: { crumb: 'Movement history' },
                          },
                        ],
                      },
                    ],
                  },
                  {
                    element: <RequirePermission permission="order:read" />,
                    children: [
                      {
                        path: 'orders',
                        handle: { crumb: 'Orders' },
                        children: [
                          { index: true, lazy: OrdersPage },
                          {
                            element: <RequirePermission permission="order:write" />,
                            children: [
                              { path: 'new', lazy: OrderFormPage, handle: { crumb: 'New order' } },
                              {
                                path: ':orderId/edit',
                                lazy: OrderFormPage,
                                handle: { crumb: 'Edit draft' },
                              },
                            ],
                          },
                          { path: ':orderId', lazy: OrderDetailPage, handle: { crumb: 'Order' } },
                        ],
                      },
                    ],
                  },
                  {
                    element: <RequirePermission permission="customer:read" />,
                    children: [
                      {
                        path: 'customers',
                        handle: { crumb: 'Customers' },
                        children: [
                          { index: true, lazy: CustomersPage },
                          {
                            path: ':customerId',
                            lazy: CustomerDetailPage,
                            handle: { crumb: 'Customer' },
                          },
                        ],
                      },
                    ],
                  },
                  {
                    element: <RequirePermission permission="report:read" />,
                    children: [
                      { path: 'reports', lazy: ReportsPage, handle: { crumb: 'Reports' } },
                    ],
                  },
                  {
                    element: <RequirePermission permission="member:read" />,
                    children: [
                      { path: 'employees', lazy: EmployeesPage, handle: { crumb: 'Employees' } },
                    ],
                  },
                  {
                    path: 'settings/organization',
                    lazy: OrganizationSettingsPage,
                    handle: { crumb: 'Organization settings' },
                  },
                  {
                    element: <RequirePermission permission="audit:read" />,
                    children: [
                      {
                        path: 'settings/emails',
                        lazy: EmailDeliveriesPage,
                        handle: { crumb: 'Email log' },
                      },
                    ],
                  },
                  {
                    path: 'notifications',
                    lazy: NotificationsPage,
                    handle: { crumb: 'Notifications' },
                  },
                  {
                    path: 'settings/profile',
                    lazy: ProfilePage,
                    handle: { crumb: 'Your profile' },
                  },
                ],
              },
            ],
          },
        ],
      },

      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
