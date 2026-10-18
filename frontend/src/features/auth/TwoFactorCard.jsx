import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheckIcon } from '@heroicons/react/24/outline';
import { Alert, Badge, Card, SkeletonRows } from '../../components/ui/layout.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Dialog } from '../../components/ui/Dialog.jsx';
import { TextField } from '../../components/ui/fields.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useServerErrors } from '../../hooks/useServerErrors.js';
import { getApiError } from '../../lib/apiClient.js';
import { formatDate } from '../../lib/format.js';
import {
  disableMfa,
  enableMfa,
  getMfaStatus,
  regenerateRecoveryCodes,
  startMfaSetup,
} from '../../services/authService.js';
import { QrCode } from './QrCode.jsx';
import { SESSION_KEY } from './useSession.js';

const MFA_KEY = ['mfa'];
const passwordSchema = z.object({ password: z.string().min(1, 'Enter your password') });
const codeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app'),
});
const confirmSchema = z.object({
  password: z.string().min(1, 'Enter your password'),
  code: z.string().trim().min(6, 'Enter a code from your app, or a recovery code'),
});

/** "ABCD EFGH IJKL ..." is easier to type into an app than one long string. */
const groupKey = (secret) => secret.match(/.{1,4}/g).join(' ');

function saveCodes(codes) {
  const text = [
    'Vendora recovery codes',
    'Each code signs you in once if you cannot use your authenticator app.',
    '',
    ...codes,
    '',
  ].join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: 'vendora-recovery-codes.txt',
  });
  a.click();
  URL.revokeObjectURL(url);
}

/** Shown once, right after they are created: the server keeps only their hashes. */
function RecoveryCodes({ codes, onDone }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-4">
      <Alert tone="warning" title="Save these recovery codes now">
        If you lose your phone, each code signs you in once. They will not be shown again.
      </Alert>
      <ul
        translate="no"
        aria-label="Recovery codes"
        className="grid grid-cols-2 gap-2 rounded-md bg-ink-50 p-4 font-mono text-sm text-ink-900"
      >
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => saveCodes(codes)}>
          Download as a file
        </Button>
        <Button
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard?.writeText(codes.join('\n'));
            setCopied(true);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button className="ml-auto" onClick={onDone}>
          I saved them
        </Button>
      </div>
    </div>
  );
}

/** Turning it on: password, then scan and confirm a code, then save the recovery codes. */
function SetupDialog({ open, onClose }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [setup, setSetup] = useState(null); // { secret, otpauthUrl }
  const [codes, setCodes] = useState(null);
  const passwordForm = useForm({ resolver: zodResolver(passwordSchema) });
  const codeForm = useForm({ resolver: zodResolver(codeSchema) });
  const [passwordError, onPasswordError] = useServerErrors(passwordForm.setError);
  const [codeError, onCodeError] = useServerErrors(codeForm.setError);

  const start = useMutation({
    mutationFn: ({ password }) => startMfaSetup(password),
    onSuccess: setSetup,
    onError: onPasswordError,
  });
  const confirm = useMutation({
    mutationFn: ({ code }) => enableMfa(code),
    onSuccess: ({ recoveryCodes }) => {
      setCodes(recoveryCodes);
      queryClient.invalidateQueries({ queryKey: MFA_KEY });
      queryClient.invalidateQueries({ queryKey: SESSION_KEY });
    },
    onError: onCodeError,
  });
  const close = () => {
    setSetup(null);
    setCodes(null);
    passwordForm.reset();
    codeForm.reset();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={codes ? () => {} : close}
      title={codes ? 'Two-factor sign-in is on' : 'Turn on two-factor sign-in'}
      description={
        codes
          ? 'From now on, signing in asks for a code from your authenticator app. Other devices were signed out.'
          : 'You will need an authenticator app, such as Google Authenticator, Microsoft Authenticator or 1Password.'
      }
    >
      {codes ? (
        <RecoveryCodes
          codes={codes}
          onDone={() => {
            toast.success('Two-factor sign-in is on.');
            close();
          }}
        />
      ) : !setup ? (
        <form
          noValidate
          onSubmit={passwordForm.handleSubmit((v) => start.mutate(v))}
          className="space-y-4"
        >
          {passwordError && <Alert tone="error">{passwordError}</Alert>}
          <TextField
            label="Your password"
            type="password"
            autoComplete="current-password"
            error={passwordForm.formState.errors.password?.message}
            {...passwordForm.register('password')}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" loading={start.isPending}>
              Continue
            </Button>
          </div>
        </form>
      ) : (
        <form
          noValidate
          onSubmit={codeForm.handleSubmit((v) => confirm.mutate(v))}
          className="space-y-4"
        >
          {codeError && <Alert tone="error">{codeError}</Alert>}
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
            <QrCode value={setup.otpauthUrl} label="QR code to scan with your authenticator app" />
            <div className="min-w-0 text-sm text-ink-700">
              <p>Scan the code with your app, then enter the 6 digits it shows.</p>
              <p className="mt-3 text-ink-500">Cannot scan? Enter this setup key instead:</p>
              <p
                translate="no"
                data-testid="mfa-setup-key"
                className="mt-1 break-words font-mono text-sm font-medium text-ink-900"
              >
                {groupKey(setup.secret)}
              </p>
            </div>
          </div>
          <TextField
            label="Code from the app"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            error={codeForm.formState.errors.code?.message}
            {...codeForm.register('code')}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" loading={confirm.isPending}>
              Turn on
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

/** Turning it off, or new recovery codes: both need the password and a current code. */
function ConfirmDialog({ open, action, onClose }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [codes, setCodes] = useState(null);
  const form = useForm({ resolver: zodResolver(confirmSchema) });
  const [formError, onError] = useServerErrors(form.setError);
  const turningOff = action === 'disable';
  const run = useMutation({
    mutationFn: (values) => (turningOff ? disableMfa(values) : regenerateRecoveryCodes(values)),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: MFA_KEY });
      queryClient.invalidateQueries({ queryKey: SESSION_KEY });
      if (turningOff) {
        toast.success('Two-factor sign-in is off.');
        close();
      } else {
        setCodes(result.recoveryCodes);
      }
    },
    onError,
  });
  const close = () => {
    setCodes(null);
    form.reset();
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={codes ? () => {} : close}
      title={turningOff ? 'Turn off two-factor sign-in?' : 'New recovery codes'}
      description={
        turningOff
          ? 'Signing in will need your password only. Platform administrators lose access to the admin area.'
          : 'Your old recovery codes stop working.'
      }
    >
      {codes ? (
        <RecoveryCodes codes={codes} onDone={close} />
      ) : (
        <form noValidate onSubmit={form.handleSubmit((v) => run.mutate(v))} className="space-y-4">
          {formError && <Alert tone="error">{formError}</Alert>}
          <TextField
            label="Your password"
            type="password"
            autoComplete="current-password"
            error={form.formState.errors.password?.message}
            {...form.register('password')}
          />
          <TextField
            label="Code from your app, or a recovery code"
            autoComplete="one-time-code"
            spellCheck={false}
            error={form.formState.errors.code?.message}
            {...form.register('code')}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={turningOff ? 'danger' : 'primary'}
              loading={run.isPending}
            >
              {turningOff ? 'Turn off' : 'Create new codes'}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

export function TwoFactorCard() {
  const status = useQuery({ queryKey: MFA_KEY, queryFn: getMfaStatus });
  const [dialog, setDialog] = useState(null); // 'setup' | 'disable' | 'codes'
  const s = status.data;

  return (
    <Card
      title="Two-factor sign-in"
      description="A code from an app on your phone, asked after your password. Required to use the platform admin area."
    >
      {status.isPending ? (
        <SkeletonRows rows={1} label="Loading two-factor status" />
      ) : status.isError ? (
        <Alert tone="error">{getApiError(status.error).message}</Alert>
      ) : s.enabled ? (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink-700">
            <ShieldCheckIcon aria-hidden="true" className="size-5 text-brand-600" />
            <Badge tone="success">On</Badge>
            since {formatDate(s.enabledAt)} · {s.recoveryCodesLeft}{' '}
            {s.recoveryCodesLeft === 1 ? 'recovery code' : 'recovery codes'} left
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setDialog('codes')}>
              New recovery codes
            </Button>
            <Button variant="secondary" onClick={() => setDialog('disable')}>
              Turn off
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-ink-700">
            <Badge>Off</Badge> Anyone with your password can sign in as you.
          </p>
          <Button onClick={() => setDialog('setup')}>Turn on</Button>
        </div>
      )}
      <SetupDialog open={dialog === 'setup'} onClose={() => setDialog(null)} />
      <ConfirmDialog
        open={dialog === 'disable' || dialog === 'codes'}
        action={dialog === 'disable' ? 'disable' : 'codes'}
        onClose={() => setDialog(null)}
      />
    </Card>
  );
}
