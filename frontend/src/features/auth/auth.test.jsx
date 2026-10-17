import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { renderRoute, sessionFixture } from '../../tests/renderWithProviders.jsx';
import * as authService from '../../services/authService.js';
import * as orgService from '../../services/organizationService.js';
import { safeNextPath } from './schemas.js';

vi.mock('../../services/authService.js');
vi.mock('../../services/organizationService.js');
vi.mock('../../services/memberService.js');

const apiError = (status, error) =>
  Object.assign(new Error('Request failed'), { response: { status, data: { error } } });

beforeEach(() => {
  vi.mocked(orgService.listStores).mockResolvedValue([
    {
      id: 's1',
      name: 'Main store',
      slug: 'main',
      currency: 'USD',
      timezone: 'UTC',
      status: 'ACTIVE',
    },
  ]);
});

describe('route guards', () => {
  test('a signed-out visitor is sent to sign in, keeping the destination', async () => {
    vi.mocked(authService.getSession).mockResolvedValue(null);
    const { router } = renderRoute('/settings/profile');

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.search).toBe('?next=%2Fsettings%2Fprofile');
  });

  test('a signed-in user without an organization is sent to onboarding', async () => {
    vi.mocked(authService.getSession).mockResolvedValue(
      sessionFixture({ withOrganization: false }),
    );
    renderRoute('/');
    expect(
      await screen.findByRole('heading', { name: 'Set up your organization' }),
    ).toBeInTheDocument();
  });

  test('a signed-in user with an organization sees the app shell', async () => {
    vi.mocked(authService.getSession).mockResolvedValue(sessionFixture());
    renderRoute('/');
    expect(
      await screen.findByRole('heading', { name: 'Atlas Outfitters', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(await screen.findByText('Main store')).toBeInTheDocument();
  });

  test('when the session cannot be loaded, an error with a retry is shown instead of a blank page', async () => {
    vi.mocked(authService.getSession).mockRejectedValueOnce(new Error('Network Error'));
    renderRoute('/');
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not load your account');

    vi.mocked(authService.getSession).mockResolvedValue(sessionFixture());
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', { name: 'Atlas Outfitters', level: 1 }),
    ).toBeInTheDocument();
  });
});

describe('sign in', () => {
  beforeEach(() => {
    vi.mocked(authService.getSession).mockResolvedValue(null);
  });

  test('shows field errors without calling the API when the form is incomplete', async () => {
    renderRoute('/login');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Enter your email address')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(authService.login).not.toHaveBeenCalled();
  });

  test('shows the server message for wrong credentials', async () => {
    vi.mocked(authService.login).mockRejectedValue(
      apiError(401, { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' }),
    );
    renderRoute('/login');
    await userEvent.type(await screen.findByLabelText('Email'), 'amina@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect');
  });

  test('goes to the requested page after signing in', async () => {
    vi.mocked(authService.login).mockResolvedValue(sessionFixture());
    const { router } = renderRoute('/login?next=%2Fsettings%2Fprofile');
    await userEvent.type(await screen.findByLabelText('Email'), 'amina@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/profile'));
    expect(vi.mocked(authService.login).mock.calls[0][0]).toEqual({
      email: 'amina@example.com',
      password: 'correct-horse-battery',
    });
  });
});

describe('registration', () => {
  test('shows a server-side field error next to the field', async () => {
    vi.mocked(authService.getSession).mockResolvedValue(null);
    vi.mocked(authService.register).mockRejectedValue(
      apiError(409, {
        code: 'EMAIL_TAKEN',
        message: 'An account with this email already exists',
        details: { fieldErrors: { email: 'An account with this email already exists' } },
      }),
    );
    renderRoute('/register');
    await userEvent.type(await screen.findByLabelText('Full name'), 'Amina Haddad');
    await userEvent.type(screen.getByLabelText('Work email'), 'amina@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'a-long-enough-password');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    const field = screen.getByLabelText('Work email');
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
    expect(field).toHaveAccessibleDescription('An account with this email already exists');
  });

  test('the submit button is disabled while the request is in flight (no double submit)', async () => {
    vi.mocked(authService.getSession).mockResolvedValue(null);
    vi.mocked(authService.register).mockReturnValue(new Promise(() => {}));
    renderRoute('/register');
    await userEvent.type(await screen.findByLabelText('Full name'), 'Amina');
    await userEvent.type(screen.getByLabelText('Work email'), 'amina@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'a-long-enough-password');
    const button = screen.getByRole('button', { name: 'Create account' });
    await userEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    await userEvent.click(button);
    expect(authService.register).toHaveBeenCalledTimes(1);
  });
});

describe('onboarding', () => {
  test('an unverified user is asked to confirm their email, and the form is disabled', async () => {
    vi.mocked(authService.getSession).mockResolvedValue(
      sessionFixture({ withOrganization: false, verified: false }),
    );
    renderRoute('/onboarding');

    expect(await screen.findByText('Confirm your email address first')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create organization' })).toBeDisabled();
  });
});

describe('safeNextPath', () => {
  test.each([
    ['/settings/profile', '/settings/profile'],
    ['//evil.example/path', '/'],
    ['/\\evil.example', '/'],
    ['https://evil.example', '/'],
    [null, '/'],
  ])('%s → %s', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});
