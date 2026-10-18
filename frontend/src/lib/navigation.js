/** Leaves the app for an external page (Stripe Checkout, Customer Portal). Mocked in tests. */
export function goToExternal(url) {
  window.location.assign(url);
}
