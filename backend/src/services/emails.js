// Plain, transactional email content. Links point at the web app, which calls the API.

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

function layout(paragraphs, action) {
  const text = [...paragraphs, action ? `${action.label}: ${action.url}` : null]
    .filter(Boolean)
    .join('\n\n');
  const html = [
    ...paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`),
    action ? `<p><a href="${escapeHtml(action.url)}">${escapeHtml(action.label)}</a></p>` : '',
  ].join('\n');
  return { text, html };
}

export function verifyEmailMessage({ appUrl, name, token }) {
  const url = `${appUrl}/verify-email?token=${encodeURIComponent(token)}`;
  return {
    subject: 'Confirm your email address',
    ...layout(
      [
        `Hello ${name},`,
        'Confirm your email address to finish setting up your Vendora account. The link expires in 24 hours.',
        'If you did not create an account, you can ignore this email.',
      ],
      { label: 'Confirm email address', url },
    ),
  };
}

export function passwordResetMessage({ appUrl, name, token }) {
  const url = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;
  return {
    subject: 'Reset your Vendora password',
    ...layout(
      [
        `Hello ${name},`,
        'Someone asked to reset the password for your Vendora account. The link expires in 30 minutes and works once.',
        'If this was not you, ignore this email: your password stays the same.',
      ],
      { label: 'Choose a new password', url },
    ),
  };
}

export function invitationMessage({ appUrl, organizationName, inviterName, role, token }) {
  const url = `${appUrl}/invitations/accept?token=${encodeURIComponent(token)}`;
  return {
    subject: `You are invited to join ${organizationName} on Vendora`,
    ...layout(
      [
        `${inviterName} invited you to join ${organizationName} as ${role}.`,
        'The invitation expires in 7 days.',
      ],
      { label: 'Accept the invitation', url },
    ),
  };
}

export function ownershipTransferMessage({ appUrl, organizationName, fromName }) {
  return {
    subject: `${fromName} wants to transfer ownership of ${organizationName} to you`,
    ...layout(
      [
        `${fromName} started transferring ownership of ${organizationName} to you.`,
        'Sign in and open the organization settings to accept. The request expires in 72 hours.',
      ],
      { label: 'Open organization settings', url: `${appUrl}/settings/organization` },
    ),
  };
}
