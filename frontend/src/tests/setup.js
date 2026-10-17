import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom does not implement HTMLDialogElement.showModal()/close() (all target browsers do).
// This stand-in only toggles the `open` attribute and fires `close`, which is all the app's
// Dialog component relies on. Focus trapping is the browser's job and is covered by E2E tests.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

// jsdom has no ResizeObserver, which Recharts' ResponsiveContainer uses to measure itself.
// Charts render at zero size in tests; what they show is checked through their table view.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Pages are lazy-loaded route chunks; the first load of a chunk in a full parallel run can take
// several seconds while Vitest transforms it (the dashboard also pulls in the chart library).
// Lookups that succeed only wait as long as they need to.
configure({ asyncUtilTimeout: 10_000 });

afterEach(() => {
  cleanup();
});
