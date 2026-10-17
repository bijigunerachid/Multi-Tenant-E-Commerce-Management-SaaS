import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PlusIcon } from '@heroicons/react/20/solid';
import { TagIcon } from '@heroicons/react/24/outline';
import { Alert, Card, EmptyState, PageHeader, SkeletonRows } from '../../components/ui/layout.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { ConfirmDialog, Dialog } from '../../components/ui/Dialog.jsx';
import { SelectField, TextField } from '../../components/ui/fields.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useServerErrors } from '../../hooks/useServerErrors.js';
import { getApiError } from '../../lib/apiClient.js';
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from '../../services/catalogService.js';
import { useHasPermission } from '../auth/useSession.js';

const schema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(120, 'Use at most 120 characters'),
  parentId: z.string(),
  description: z.string().max(1000, 'Use at most 1000 characters'),
});

/** Flattens the category list into tree order with a depth for indentation. */
function treeOrder(categories) {
  const byParent = new Map();
  for (const c of categories) {
    const key = c.parentId ?? 'root';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(c);
  }
  const out = [];
  const walk = (key, depth) => {
    for (const c of byParent.get(key) ?? []) {
      out.push({ ...c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk('root', 0);
  return out;
}

function CategoryDialog({ open, onClose, category, categories }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    values: {
      name: category?.name ?? '',
      parentId: category?.parentId ?? '',
      description: category?.description ?? '',
    },
  });
  const [formError, handleError, clearFormError] = useServerErrors(setError);
  const close = () => {
    reset();
    clearFormError();
    onClose();
  };

  // A category cannot be moved under itself or its own descendants (the server also checks).
  const parentOptions = useMemo(() => {
    if (!category) return categories;
    const excluded = new Set([category.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of categories) {
        if (c.parentId && excluded.has(c.parentId) && !excluded.has(c.id)) {
          excluded.add(c.id);
          grew = true;
        }
      }
    }
    return categories.filter((c) => !excluded.has(c.id));
  }, [categories, category]);

  const save = useMutation({
    mutationFn: (values) => {
      const body = {
        name: values.name,
        parentId: values.parentId || null,
        description: values.description.trim() || null,
      };
      return category ? updateCategory(category.id, body) : createCategory(body);
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      toast.success(category ? 'Category saved.' : `${saved.name} created.`);
      close();
    },
    onError: handleError,
  });

  return (
    <Dialog
      open={open}
      onClose={close}
      title={category ? `Edit ${category.name}` : 'New category'}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="category-form" loading={save.isPending}>
            {category ? 'Save' : 'Create category'}
          </Button>
        </>
      }
    >
      <form
        id="category-form"
        noValidate
        onSubmit={handleSubmit((v) => save.mutate(v))}
        className="space-y-4"
      >
        {formError && <Alert tone="error">{formError}</Alert>}
        <TextField
          label="Name"
          error={errors.name?.message ?? errors.slug?.message}
          {...register('name')}
        />
        <SelectField
          label="Parent category"
          placeholder="None (top level)"
          options={parentOptions.map((c) => ({ value: c.id, label: c.name }))}
          error={errors.parentId?.message}
          {...register('parentId')}
        />
        <TextField
          label="Description"
          hint="Optional."
          error={errors.description?.message}
          {...register('description')}
        />
      </form>
    </Dialog>
  );
}

export function CategoriesPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const can = useHasPermission();
  const editable = can('product:write');
  const [editing, setEditing] = useState(null); // null | 'new' | category
  const [deleting, setDeleting] = useState(null);
  const categories = useQuery({ queryKey: ['categories'], queryFn: listCategories });

  const remove = useMutation({
    mutationFn: (c) => deleteCategory(c.id),
    onSuccess: (_, c) => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      setDeleting(null);
      toast.success(`${c.name} deleted.`);
    },
    onError: (e) => {
      setDeleting(null);
      toast.error(getApiError(e).message);
    },
  });

  const rows = categories.data ? treeOrder(categories.data) : [];

  return (
    <>
      <PageHeader
        title="Categories"
        description="Group products so they are easier to find and report on."
        actions={
          editable && (
            <Button onClick={() => setEditing('new')}>
              <PlusIcon aria-hidden="true" className="size-5" /> New category
            </Button>
          )
        }
      />
      <Card>
        {categories.isPending ? (
          <SkeletonRows rows={4} label="Loading categories" />
        ) : categories.isError ? (
          <Alert
            tone="error"
            action={
              <Button size="sm" variant="secondary" onClick={() => categories.refetch()}>
                Retry
              </Button>
            }
          >
            {getApiError(categories.error).message}
          </Alert>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={TagIcon}
            title="No categories yet"
            description="Categories are optional, but they make large catalogs easier to manage."
            action={editable && <Button onClick={() => setEditing('new')}>New category</Button>}
          />
        ) : (
          <ul className="-my-4 divide-y divide-slate-100">
            {rows.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
              >
                <div style={{ paddingLeft: `${c.depth * 1.5}rem` }}>
                  <p className="font-medium text-slate-900">
                    {c.depth > 0 && (
                      <span aria-hidden="true" className="mr-1 text-slate-400">
                        └
                      </span>
                    )}
                    {c.name}
                  </p>
                  {c.description && <p className="text-slate-500">{c.description}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    to={`/products?categoryId=${c.id}`}
                    className="rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100"
                  >
                    {c.productCount} {c.productCount === 1 ? 'product' : 'products'}
                  </Link>
                  {editable && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Edit ${c.name}`}
                        onClick={() => setEditing(c)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Delete ${c.name}`}
                        onClick={() => setDeleting(c)}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editable && (
        <CategoryDialog
          open={editing !== null}
          onClose={() => setEditing(null)}
          category={editing === 'new' ? null : editing}
          categories={categories.data ?? []}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => remove.mutate(deleting)}
        loading={remove.isPending}
        title={`Delete ${deleting?.name}?`}
        confirmLabel="Delete category"
      >
        Only empty categories can be deleted: move their products and sub-categories first.
      </ConfirmDialog>
    </>
  );
}
