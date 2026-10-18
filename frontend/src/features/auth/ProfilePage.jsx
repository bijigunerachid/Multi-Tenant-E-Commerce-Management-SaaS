import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { Alert, Card, PageHeader } from '../../components/ui/layout.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { ConfirmDialog } from '../../components/ui/Dialog.jsx';
import { TextField } from '../../components/ui/fields.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useServerErrors } from '../../hooks/useServerErrors.js';
import { getApiError } from '../../lib/apiClient.js';
import { changePassword, logoutEverywhere, updateProfile } from '../../services/authService.js';
import { nameField, newPasswordField } from './schemas.js';
import { useApplySession, useSession } from './useSession.js';

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: newPasswordField,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    error: 'The passwords do not match',
  });

function ProfileForm({ user }) {
  const toast = useToast();
  const applySession = useApplySession();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isDirty },
  } = useForm({
    resolver: zodResolver(z.object({ name: nameField })),
    values: { name: user.name },
  });
  const [formError, handleError] = useServerErrors(setError);
  const save = useMutation({
    mutationFn: updateProfile,
    onSuccess: (s) => {
      applySession(s);
      reset();
      toast.success('Profile saved.');
    },
    onError: handleError,
  });

  return (
    <form noValidate onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-5">
      {formError && <Alert tone="error">{formError}</Alert>}
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          label="Full name"
          autoComplete="name"
          error={errors.name?.message}
          {...register('name')}
        />
        <TextField label="Email" value={user.email} readOnly disabled />
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={save.isPending} disabled={!isDirty}>
          Save
        </Button>
      </div>
    </form>
  );
}

function PasswordForm() {
  const toast = useToast();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const [formError, handleError] = useServerErrors(setError);
  const save = useMutation({
    mutationFn: ({ currentPassword, newPassword }) =>
      changePassword({ currentPassword, newPassword }),
    onSuccess: () => {
      reset();
      toast.success('Password changed. Your other sessions were signed out.');
    },
    onError: handleError,
  });

  return (
    <form noValidate onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-5">
      {formError && <Alert tone="error">{formError}</Alert>}
      <div className="grid gap-5 sm:grid-cols-3">
        <TextField
          label="Current password"
          type="password"
          autoComplete="current-password"
          error={errors.currentPassword?.message}
          {...register('currentPassword')}
        />
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          error={errors.newPassword?.message}
          {...register('newPassword')}
        />
        <TextField
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={save.isPending}>
          Change password
        </Button>
      </div>
    </form>
  );
}

export function ProfilePage() {
  const { data: session } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const applySession = useApplySession();
  const [confirm, setConfirm] = useState(false);
  const everywhere = useMutation({
    mutationFn: logoutEverywhere,
    onSuccess: () => {
      applySession(null);
      navigate('/login', { replace: true });
    },
    onError: (e) => toast.error(getApiError(e).message),
  });

  return (
    <>
      <PageHeader title="Your profile" />
      <div className="space-y-6">
        <Card title="Personal details">
          <ProfileForm user={session.user} />
        </Card>
        <Card title="Password" description="Changing it signs you out on every other device.">
          <PasswordForm />
        </Card>
        <Card title="Sessions">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-600">Sign out on every device, including this one.</p>
            <Button variant="secondary" onClick={() => setConfirm(true)}>
              Sign out everywhere
            </Button>
          </div>
        </Card>
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => everywhere.mutate()}
        loading={everywhere.isPending}
        title="Sign out everywhere?"
        confirmLabel="Sign out everywhere"
      >
        Every session of your account ends now, including this one.
      </ConfirmDialog>
    </>
  );
}
