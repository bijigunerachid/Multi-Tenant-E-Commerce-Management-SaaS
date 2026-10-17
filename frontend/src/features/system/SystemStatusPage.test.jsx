import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { renderRoute } from '../../tests/renderWithProviders.jsx';
import { fetchReadiness } from '../../services/healthService.js';

vi.mock('../../services/healthService.js', () => ({ fetchReadiness: vi.fn() }));

describe('SystemStatusPage', () => {
  test('shows a loading state, then every dependency as up', async () => {
    fetchReadiness.mockResolvedValue({ status: 'ready', checks: { database: 'up', redis: 'up' } });
    renderRoute('/status');

    expect(screen.getByLabelText('Loading status')).toBeInTheDocument();
    expect(await screen.findByText('All services are operational.')).toBeInTheDocument();
    expect(screen.getByText('Database').closest('li')).toHaveTextContent('Up');
    expect(screen.getByText('Cache and queues').closest('li')).toHaveTextContent('Up');
  });

  test('reports a degraded dependency', async () => {
    fetchReadiness.mockResolvedValue({
      status: 'unavailable',
      checks: { database: 'up', redis: 'down' },
    });
    renderRoute('/status');

    expect(await screen.findByText('Some services are unavailable.')).toBeInTheDocument();
    expect(screen.getByText('Cache and queues').closest('li')).toHaveTextContent('Down');
  });

  test('shows an error instead of fake data when the API cannot be reached, and can retry', async () => {
    fetchReadiness.mockRejectedValueOnce(new Error('Network Error'));
    renderRoute('/status');

    expect(await screen.findByRole('alert')).toHaveTextContent('The API is not responding.');
    expect(screen.queryByText('Database')).not.toBeInTheDocument();

    fetchReadiness.mockResolvedValue({ status: 'ready', checks: { database: 'up', redis: 'up' } });
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));

    expect(await screen.findByText('All services are operational.')).toBeInTheDocument();
  });
});

describe('routing', () => {
  test('unknown paths show the not-found page with a way back', async () => {
    renderRoute('/no-such-page');

    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the home page' })).toHaveAttribute('href', '/');
  });
});
