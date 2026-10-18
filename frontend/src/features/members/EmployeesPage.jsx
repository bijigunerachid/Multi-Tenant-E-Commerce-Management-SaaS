import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EnvelopeIcon, UserPlusIcon, UsersIcon } from '@heroicons/react/24/outline';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  PageHeader,
  SkeletonRows,
} from '../../components/ui/layout.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { ConfirmDialog, Dialog } from '../../components/ui/Dialog.jsx';
import { SelectField, TextField } from '../../components/ui/fields.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useServerErrors } from '../../hooks/useServerErrors.js';
import { getApiError } from '../../lib/apiClient.js';
import { ROLE_LABELS, ROLE_OPTIONS } from '../../lib/roles.js';
import {
  changeMemberRole,
  deactivateMember,
  inviteMember,
  listInvitations,
  listMembers,
  reactivateMember,
  revokeInvitation,
} from '../../services/memberService.js';
import { emailField } from '../auth/schemas.js';
import { useHasPermission, useSession } from '../auth/useSession.js';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const inviteSchema = z.object({ email: emailField, role: z.string().min(1, 'Choose a role') });

function InviteDialog({ open, onClose }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: '', role: 'ANALYST' },
  });
  const [formError, handleError, clearFormError] = useServerErrors(setError);
  const close = () => {
    reset();
    clearFormError();
    onClose();
  };
  const invite = useMutation({
    mutationFn: inviteMember,
    onSuccess: (inv) => {
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
      toast.success(`Invitation sent to ${inv.email}.`);
      close();
    },
    onError: handleError,
  });

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Invite an employee"
      description="They will get an email with a link that is valid for 7 days."
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={invite.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="invite-form" loading={invite.isPending}>
            Send invitation
          </Button>
        </>
      }
    >
      <form
        id="invite-form"
        noValidate
        onSubmit={handleSubmit((v) => invite.mutate(v))}
        className="space-y-4"
      >
        {formError && <Alert tone="error">{formError}</Alert>}
        <TextField
          label="Email"
          type="email"
          autoComplete="off"
          error={errors.email?.message}
          {...register('email')}
        />
        <SelectField
          label="Role"
          options={ROLE_OPTIONS}
          hint="Owners are changed through an ownership transfer in organization settings."
          error={errors.role?.message}
          {...register('role')}
        />
      </form>
    </Dialog>
  );
}

function MembersTable({ members, canManage, selfMembershipId }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(null); // { member, action }

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['members'] });
  const roleChange = useMutation({
    mutationFn: ({ id, role }) => changeMemberRole(id, role),
    onSuccess: (m) => {
      refresh();
      toast.success(`${m.name} is now ${ROLE_LABELS[m.role].toLowerCase()}.`);
    },
    onError: (e) => {
      refresh();
      toast.error(getApiError(e).message);
    },
  });
  const statusChange = useMutation({
    mutationFn: ({ member, action }) =>
      action === 'deactivate' ? deactivateMember(member.id) : reactivateMember(member.id),
    onSuccess: (m) => {
      refresh();
      setConfirm(null);
      toast.success(
        m.status === 'ACTIVE' ? `${m.name} has access again.` : `${m.name} no longer has access.`,
      );
    },
    onError: (e) => toast.error(getApiError(e).message),
  });

  return (
    <>
      <div className="relative -mx-5 -my-4 overflow-x-auto">
        <table className="min-w-full divide-y divide-ink-200 text-sm">
          <thead className="bg-ink-50 text-left text-[0.8125rem] font-semibold text-ink-600">
            <tr>
              <th scope="col" className="px-5 py-3">
                Name
              </th>
              <th scope="col" className="px-5 py-3">
                Role
              </th>
              <th scope="col" className="px-5 py-3">
                Status
              </th>
              <th scope="col" className="hidden px-5 py-3 md:table-cell">
                Joined
              </th>
              {canManage && (
                <th scope="col" className="px-5 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {members.map((m) => {
              const editable = canManage && m.role !== 'OWNER' && m.id !== selfMembershipId;
              return (
                <tr key={m.id}>
                  <td className="px-5 py-3">
                    <p className="font-medium text-ink-900">
                      {m.name}{' '}
                      {m.id === selfMembershipId && <span className="text-ink-500">(you)</span>}
                    </p>
                    <p className="text-ink-500">{m.email}</p>
                  </td>
                  <td className="px-5 py-3">
                    {editable && m.status === 'ACTIVE' ? (
                      <label>
                        <span className="sr-only">Role of {m.name}</span>
                        <select
                          value={m.role}
                          disabled={roleChange.isPending}
                          onChange={(e) => roleChange.mutate({ id: m.id, role: e.target.value })}
                          className="rounded-md border-0 py-1.5 pl-2.5 pr-8 text-sm ring-1 ring-inset ring-ink-300 focus:ring-2 focus:ring-brand-600"
                        >
                          {ROLE_OPTIONS.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <Badge tone={m.role === 'OWNER' ? 'accent' : 'neutral'}>
                        {ROLE_LABELS[m.role]}
                      </Badge>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <Badge tone={m.status === 'ACTIVE' ? 'success' : 'warning'}>
                      {m.status === 'ACTIVE' ? 'Active' : 'Deactivated'}
                    </Badge>
                  </td>
                  <td className="hidden px-5 py-3 text-ink-500 md:table-cell">
                    {dateFormat.format(new Date(m.joinedAt))}
                  </td>
                  {canManage && (
                    <td className="px-5 py-3 text-right">
                      {editable && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`${m.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'} ${m.name}`}
                          onClick={() =>
                            setConfirm({
                              member: m,
                              action: m.status === 'ACTIVE' ? 'deactivate' : 'reactivate',
                            })
                          }
                        >
                          {m.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => statusChange.mutate(confirm)}
        loading={statusChange.isPending}
        tone={confirm?.action === 'deactivate' ? 'danger' : 'primary'}
        title={
          confirm?.action === 'deactivate'
            ? `Deactivate ${confirm?.member.name}?`
            : `Reactivate ${confirm?.member.name}?`
        }
        confirmLabel={confirm?.action === 'deactivate' ? 'Deactivate' : 'Reactivate'}
      >
        {confirm?.action === 'deactivate'
          ? 'They lose access to this organization immediately. Their past activity stays in the audit log. You can reactivate them later.'
          : 'They will regain access with their current role.'}
      </ConfirmDialog>
    </>
  );
}

function InvitationsCard({ canManage }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [revoking, setRevoking] = useState(null);
  const invitations = useQuery({ queryKey: ['invitations'], queryFn: listInvitations });
  const revoke = useMutation({
    mutationFn: (inv) => revokeInvitation(inv.id),
    onSuccess: (_, inv) => {
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
      setRevoking(null);
      toast.success(`Invitation for ${inv.email} revoked.`);
    },
    onError: (e) => toast.error(getApiError(e).message),
  });

  return (
    <Card title="Pending invitations">
      {invitations.isPending ? (
        <SkeletonRows rows={2} label="Loading invitations" />
      ) : invitations.isError ? (
        <Alert
          tone="error"
          action={
            <Button size="sm" variant="secondary" onClick={() => invitations.refetch()}>
              Retry
            </Button>
          }
        >
          {getApiError(invitations.error).message}
        </Alert>
      ) : invitations.data.length === 0 ? (
        <EmptyState icon={EnvelopeIcon} title="No pending invitations" />
      ) : (
        <ul className="divide-y divide-ink-100">
          {invitations.data.map((inv) => (
            <li
              key={inv.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
            >
              <div>
                <p className="font-medium text-ink-900">{inv.email}</p>
                <p className="text-ink-500">
                  {ROLE_LABELS[inv.role]} ·{' '}
                  {inv.expired
                    ? 'Expired'
                    : `Expires ${dateFormat.format(new Date(inv.expiresAt))}`}
                  {inv.invitedBy && ` · Invited by ${inv.invitedBy.name}`}
                </p>
              </div>
              {canManage && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Revoke invitation for ${inv.email}`}
                  onClick={() => setRevoking(inv)}
                >
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={Boolean(revoking)}
        onClose={() => setRevoking(null)}
        onConfirm={() => revoke.mutate(revoking)}
        loading={revoke.isPending}
        title="Revoke this invitation?"
        confirmLabel="Revoke"
      >
        The link sent to {revoking?.email} will stop working.
      </ConfirmDialog>
    </Card>
  );
}

export function EmployeesPage() {
  const { data: session } = useSession();
  const can = useHasPermission();
  const canManage = can('member:manage');
  const [inviting, setInviting] = useState(false);
  const members = useQuery({ queryKey: ['members'], queryFn: listMembers });

  return (
    <>
      <PageHeader
        title="Employees"
        description="People who can access this organization, and what they can do."
        actions={
          canManage && (
            <Button onClick={() => setInviting(true)}>
              <UserPlusIcon aria-hidden="true" className="size-5" /> Invite employee
            </Button>
          )
        }
      />
      <div className="space-y-6">
        <Card title="Members">
          {members.isPending ? (
            <SkeletonRows rows={3} label="Loading members" />
          ) : members.isError ? (
            <Alert
              tone="error"
              action={
                <Button size="sm" variant="secondary" onClick={() => members.refetch()}>
                  Retry
                </Button>
              }
            >
              {getApiError(members.error).message}
            </Alert>
          ) : members.data.length === 0 ? (
            <EmptyState icon={UsersIcon} title="No members yet" />
          ) : (
            <MembersTable
              members={members.data}
              canManage={canManage}
              selfMembershipId={session.activeOrganization.membershipId}
            />
          )}
        </Card>
        <InvitationsCard canManage={canManage} />
      </div>
      {canManage && <InviteDialog open={inviting} onClose={() => setInviting(false)} />}
    </>
  );
}
