import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { renderRoute, sessionFixture } from '../../tests/renderWithProviders.jsx';
import * as authService from '../../services/authService.js';
import * as emailService from '../../services/emailService.js';

vi.mock('../../services/authService.js');
vi.mock('../../services/organizationService.js');
vi.mock('../../services/memberService.js');
vi.mock('../../services/emailService.js');

const OWNER = ['org:read', 'member:read', 'member:manage', 'audit:read'];
const delivery = (overrides) => ({
  id: overrides.to,
  kind: 'member.invitation',
  subject: 'You are invited to join Atlas Outfitters on Vendora',
  status: 'SENT',
  attempts: 1,
  lastError: null,
  createdAt: '2026-10-17T10:00:00Z',
  sentAt: '2026-10-17T10:00:02Z',
  failedAt: null,
  ...overrides,
});

beforeEach(() => {
  vi.mocked(authService.getSession).mockResolvedValue(
    sessionFixture({ role: 'OWNER', permissions: OWNER }),
  );
  vi.mocked(emailService.listEmailDeliveries).mockResolvedValue({
    data: [
      delivery({ to: 'hire@example.com', attempts: 3 }),
      delivery({
        to: 'bounce@example.com',
        status: 'FAILED',
        sentAt: null,
        failedAt: '2026-10-17T10:00:01Z',
        lastError: '550 Mailbox unavailable',
      }),
      delivery({
        to: 'slow@example.com',
        kind: 'organization.ownership_transfer',
        status: 'QUEUED',
        attempts: 2,
        sentAt: null,
        lastError: '421 Service not available',
      }),
    ],
    meta: { page: 1, pageSize: 25, total: 3 },
  });
});

const item = (email) => screen.getByText(email).closest('li');

describe('email log', () => {
  test('shows each email with its status in words and why it failed', async () => {
    renderRoute('/settings/emails');
    await screen.findByText('hire@example.com');

    const sent = item('hire@example.com');
    expect(within(sent).getByText('Sent')).toBeInTheDocument();
    expect(sent).toHaveTextContent(/after 3 attempts/);
    expect(sent).toHaveTextContent('Team invitation');

    const bounced = item('bounce@example.com');
    expect(within(bounced).getByText('Failed')).toBeInTheDocument();
    expect(bounced).toHaveTextContent('Gave up after 1 attempt');
    expect(bounced).toHaveTextContent('550 Mailbox unavailable');

    const pending = item('slow@example.com');
    expect(within(pending).getByText('Retrying')).toBeInTheDocument();
    expect(pending).toHaveTextContent('Failed 2 attempts, will retry');
    expect(pending).toHaveTextContent('Ownership transfer');
  });

  test('filters by status through the URL', async () => {
    const { router } = renderRoute('/settings/emails');
    await screen.findByText('hire@example.com');
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'Failed');
    await waitFor(() => expect(router.state.location.search).toBe('?status=FAILED'));
    expect(emailService.listEmailDeliveries).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 25,
      status: 'FAILED',
    });
  });

  test('says so when nothing was sent yet', async () => {
    vi.mocked(emailService.listEmailDeliveries).mockResolvedValue({
      data: [],
      meta: { page: 1, pageSize: 25, total: 0 },
    });
    renderRoute('/settings/emails');
    expect(await screen.findByText('No emails sent yet')).toBeInTheDocument();
  });

  test('is in the navigation for owners only', async () => {
    renderRoute('/settings/emails');
    expect(await screen.findByRole('link', { name: 'Email log' })).toHaveAttribute(
      'href',
      '/settings/emails',
    );
  });

  test('other roles get no entry and no data', async () => {
    vi.mocked(authService.getSession).mockResolvedValue(
      sessionFixture({ role: 'MANAGER', permissions: ['org:read', 'member:read'] }),
    );
    renderRoute('/settings/emails');
    expect(await screen.findByText('You do not have access to this page')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Email log' })).not.toBeInTheDocument();
    expect(emailService.listEmailDeliveries).not.toHaveBeenCalled();
  });
});
