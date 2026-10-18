import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { renderRoute, sessionFixture } from '../../tests/renderWithProviders.jsx';
import * as authService from '../../services/authService.js';

vi.mock('../../services/authService.js');
vi.mock('../../services/organizationService.js');

const apiError = (status, error) =>
  Object.assign(new Error('Request failed'), { response: { status, data: { error } } });

describe('signing in with two-factor', () => {
  beforeEach(() => {
    vi.mocked(authService.getSession).mockResolvedValue(null);
    vi.mocked(authService.login).mockResolvedValue({ mfaRequired: true, csrfToken: 't' });
  });

  async function passwordStep() {
    renderRoute('/login?next=%2Forders');
    await userEvent.type(await screen.findByLabelText('Email'), 'amina@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'a-long-enough-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    return screen.findByRole('heading', { name: 'Two-factor sign-in' });
  }

  test('asks for the code after the password, then signs in', async () => {
    vi.mocked(authService.verifyMfa).mockImplementation(async () => {
      const session = sessionFixture();
      vi.mocked(authService.getSession).mockResolvedValue(session);
      return session;
    });
    await passwordStep();
    const code = screen.getByLabelText('Authentication code');
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    expect(code).toHaveAttribute('inputmode', 'numeric');

    await userEvent.type(code, '12345');
    await userEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));
    expect(
      await screen.findByText('Enter the 6-digit code from your authenticator app'),
    ).toBeVisible();
    expect(authService.verifyMfa).not.toHaveBeenCalled();

    await userEvent.type(code, '6');
    await userEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));
    await waitFor(() => expect(authService.verifyMfa).toHaveBeenCalledWith({ code: '123456' }));
  });

  test('a recovery code can be used instead', async () => {
    vi.mocked(authService.verifyMfa).mockResolvedValue(sessionFixture());
    await passwordStep();
    await userEvent.click(screen.getByRole('button', { name: 'Use a recovery code instead' }));
    await userEvent.type(screen.getByLabelText('Recovery code'), 'k7m2p-9xq4t');
    await userEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));
    await waitFor(() =>
      expect(authService.verifyMfa).toHaveBeenCalledWith({ recoveryCode: 'k7m2p-9xq4t' }),
    );
  });

  test('after too many wrong codes, it starts over at the password', async () => {
    vi.mocked(authService.verifyMfa).mockRejectedValue(
      apiError(401, {
        code: 'MFA_TOO_MANY_ATTEMPTS',
        message: 'Too many wrong codes. Sign in again.',
      }),
    );
    await passwordStep();
    await userEvent.type(screen.getByLabelText('Authentication code'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Too many wrong codes. Sign in again.');
  });
});

describe('turning two-factor sign-in on and off', () => {
  beforeEach(() => {
    vi.mocked(authService.getSession).mockResolvedValue(sessionFixture());
  });

  test('password, then scan and confirm, then the recovery codes once', async () => {
    vi.mocked(authService.getMfaStatus).mockResolvedValue({ enabled: false, recoveryCodesLeft: 0 });
    vi.mocked(authService.startMfaSetup).mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
      otpauthUrl:
        'otpauth://totp/Vendora:amina@example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    });
    vi.mocked(authService.enableMfa).mockResolvedValue({
      recoveryCodes: ['aaaaa-bbbbb', 'ccccc-ddddd'],
    });
    renderRoute('/settings/profile');
    const card = (await screen.findByRole('heading', { name: 'Two-factor sign-in' })).closest(
      'section',
    );
    await userEvent.click(await within(card).findByRole('button', { name: 'Turn on' }));

    const dialog = await screen.findByRole('dialog', { name: 'Turn on two-factor sign-in' });
    await userEvent.type(within(dialog).getByLabelText('Your password'), 'a-long-enough-password');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(authService.startMfaSetup).toHaveBeenCalledWith('a-long-enough-password');

    expect(
      await within(dialog).findByRole('img', {
        name: 'QR code to scan with your authenticator app',
      }),
    ).toBeVisible();
    expect(within(dialog).getByTestId('mfa-setup-key')).toHaveTextContent(
      'JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP',
    );
    await userEvent.type(within(dialog).getByLabelText('Code from the app'), '123456');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Turn on' }));
    expect(authService.enableMfa).toHaveBeenCalledWith('123456');

    const codes = await screen.findByRole('list', { name: 'Recovery codes' });
    expect(
      within(codes)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['aaaaa-bbbbb', 'ccccc-ddddd']);
    await userEvent.click(screen.getByRole('button', { name: 'I saved them' }));
    expect(await screen.findByText('Two-factor sign-in is on.')).toBeVisible();
  });

  test('turning it off needs the password and a code', async () => {
    vi.mocked(authService.getMfaStatus).mockResolvedValue({
      enabled: true,
      enabledAt: '2026-10-01T10:00:00Z',
      recoveryCodesLeft: 9,
    });
    vi.mocked(authService.disableMfa).mockResolvedValue({});
    renderRoute('/settings/profile');
    expect(await screen.findByText(/9 recovery codes left/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    const dialog = await screen.findByRole('dialog', { name: 'Turn off two-factor sign-in?' });
    await userEvent.type(within(dialog).getByLabelText('Your password'), 'pw');
    await userEvent.type(
      within(dialog).getByLabelText('Code from your app, or a recovery code'),
      '654321',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Turn off' }));
    await waitFor(() =>
      expect(authService.disableMfa).toHaveBeenCalledWith({ password: 'pw', code: '654321' }),
    );
  });
});
