import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { renderRoute, sessionFixture } from '../../tests/renderWithProviders.jsx';
import * as authService from '../../services/authService.js';
import * as memberService from '../../services/memberService.js';

vi.mock('../../services/authService.js');
vi.mock('../../services/organizationService.js');
vi.mock('../../services/memberService.js');

const members = [
  {
    id: 'membership-1',
    userId: 'u1',
    name: 'Amina Haddad',
    email: 'amina@example.com',
    role: 'OWNER',
    status: 'ACTIVE',
    joinedAt: '2026-10-01T10:00:00Z',
  },
  {
    id: 'membership-2',
    userId: 'u2',
    name: 'Omar Idrissi',
    email: 'omar@example.com',
    role: 'ANALYST',
    status: 'ACTIVE',
    joinedAt: '2026-10-02T10:00:00Z',
  },
];

beforeEach(() => {
  vi.mocked(authService.getSession).mockResolvedValue(sessionFixture());
  vi.mocked(memberService.listMembers).mockResolvedValue(members);
  vi.mocked(memberService.listInvitations).mockResolvedValue([]);
});

describe('EmployeesPage', () => {
  test('lists members; the owner row and your own row cannot be edited', async () => {
    renderRoute('/employees');

    const table = await screen.findByRole('table');
    const ownerRow = within(table).getByText('Amina Haddad').closest('tr');
    const analystRow = within(table).getByText('Omar Idrissi').closest('tr');

    expect(within(ownerRow).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(ownerRow).getByText('(you)')).toBeInTheDocument();
    expect(within(analystRow).getByRole('combobox', { name: 'Role of Omar Idrissi' })).toHaveValue(
      'ANALYST',
    );
    expect(await screen.findByText('No pending invitations')).toBeInTheDocument();
  });

  test('deactivating asks for confirmation first', async () => {
    vi.mocked(memberService.deactivateMember).mockResolvedValue({
      ...members[1],
      status: 'DEACTIVATED',
    });
    renderRoute('/employees');

    await userEvent.click(await screen.findByRole('button', { name: 'Deactivate Omar Idrissi' }));
    expect(memberService.deactivateMember).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog', { name: 'Deactivate Omar Idrissi?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    expect(memberService.deactivateMember).toHaveBeenCalledWith('membership-2');
    expect(await screen.findByText('Omar Idrissi no longer has access.')).toBeInTheDocument();
  });

  test('the invite form shows a server field error', async () => {
    vi.mocked(memberService.inviteMember).mockRejectedValue(
      Object.assign(new Error('Conflict'), {
        response: {
          status: 409,
          data: {
            error: {
              code: 'INVITATION_PENDING',
              message: 'An invitation for this email is already pending',
              details: {
                fieldErrors: { email: 'An invitation is already pending for this email' },
              },
            },
          },
        },
      }),
    );
    renderRoute('/employees');

    await userEvent.click(await screen.findByRole('button', { name: 'Invite employee' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite an employee' });
    await userEvent.type(within(dialog).getByLabelText('Email'), 'omar@example.com');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send invitation' }));

    expect(
      await within(dialog).findByText('An invitation is already pending for this email'),
    ).toBeInTheDocument();
  });

  test('shows an error with a retry when members cannot be loaded', async () => {
    vi.mocked(memberService.listMembers).mockRejectedValueOnce(new Error('Network Error'));
    renderRoute('/employees');

    const alert = await screen.findByText('Could not reach the server. Check your connection.');
    expect(alert).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    expect(await screen.findByText('Omar Idrissi')).toBeInTheDocument();
  });

  test('a manager can see the team but has no management controls', async () => {
    vi.mocked(authService.getSession).mockResolvedValue(
      sessionFixture({ role: 'MANAGER', permissions: ['org:read', 'member:read'] }),
    );
    renderRoute('/employees');

    expect(await screen.findByText('Omar Idrissi')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invite employee' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  test('an analyst gets an explanation instead of the page, and no navigation link', async () => {
    vi.mocked(authService.getSession).mockResolvedValue(
      sessionFixture({ role: 'ANALYST', permissions: ['org:read'] }),
    );
    renderRoute('/employees');

    expect(await screen.findByText('You do not have access to this page')).toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: 'Main' })).queryByRole('link', {
        name: 'Employees',
      }),
    ).not.toBeInTheDocument();
    expect(memberService.listMembers).not.toHaveBeenCalled();
  });
});
