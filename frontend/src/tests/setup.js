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

// Pages are lazy-loaded route chunks; the first load of a chunk in a test run can take more
// than the default 1 s while Vitest transforms it.
configure({ asyncUtilTimeout: 4000 });

afterEach(() => {
  cleanup();
});
