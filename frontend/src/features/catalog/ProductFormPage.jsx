import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { PlusIcon, TrashIcon } from '@heroicons/react/20/solid';
import { Alert, Badge, Card, PageHeader, SkeletonRows } from '../../components/ui/layout.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { ConfirmDialog } from '../../components/ui/Dialog.jsx';
import { SelectField, TextField } from '../../components/ui/fields.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useServerErrors } from '../../hooks/useServerErrors.js';
import { getApiError } from '../../lib/apiClient.js';
import { PRODUCT_STATUS } from '../../lib/format.js';
import {
  createProduct,
  deleteProduct,
  getProduct,
  listCategories,
  saveProduct,
  setProductStatus,
} from '../../services/catalogService.js';
import { useHasPermission, useSession } from '../auth/useSession.js';
import { ProductImages } from './ProductImages.jsx';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges.jsx';
import {
  MAX_OPTIONS,
  emptyVariant,
  productFormSchema,
  toApiBody,
  toFormValues,
} from './productForm.js';

const STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Draft (not for sale)' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'ARCHIVED', label: 'Archived' },
];
const cellInput = (invalid) =>
  `block w-full min-w-[6rem] rounded-md border-0 px-2.5 py-1.5 text-sm ring-1 ring-inset focus:ring-2 focus:ring-inset disabled:bg-ink-50 ${
    invalid ? 'ring-red-400 focus:ring-red-500' : 'ring-ink-300 focus:ring-brand-600'
  }`;

function ProductForm({ product, categories, editable }) {
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const {
    register,
    control,
    handleSubmit,
    setError,
    watch,
    setValue,
    getValues,
    reset,
    formState: { errors, isDirty },
  } = useForm({ resolver: zodResolver(productFormSchema), defaultValues: toFormValues(product) });
  const variants = useFieldArray({ control, name: 'variants' });
  const optionNames = watch('optionNames');
  const [formError, handleError] = useServerErrors(setError);
  const { prompt, allowNavigation } = useUnsavedChanges(isDirty);

  const save = useMutation({
    mutationFn: (values) =>
      product ? saveProduct(product.id, toApiBody(values)) : createProduct(toApiBody(values)),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.setQueryData(['product', saved.id], saved);
      if (product) {
        reset(toFormValues(saved));
        toast.success('Product saved.');
      } else {
        toast.success('Product created. You can now add images.');
        allowNavigation();
        navigate(`/products/${saved.id}`, { replace: true });
      }
    },
    onError: handleError,
  });

  const addOption = () => {
    setValue('optionNames', [...getValues('optionNames'), ''], { shouldDirty: true });
    getValues('variants').forEach((v, i) =>
      setValue(`variants.${i}.optionValues`, [...v.optionValues, ''], { shouldDirty: true }),
    );
  };
  const removeOption = (index) => {
    setValue(
      'optionNames',
      getValues('optionNames').filter((_, i) => i !== index),
      { shouldDirty: true },
    );
    getValues('variants').forEach((v, i) =>
      setValue(
        `variants.${i}.optionValues`,
        v.optionValues.filter((_, j) => j !== index),
        { shouldDirty: true },
      ),
    );
  };

  const variantErrors = errors.variants ?? [];
  const currency =
    product?.variants[0]?.currency ?? session.activeOrganization.defaultCurrency ?? '';

  return (
    <form noValidate onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-6">
      {prompt}
      {formError && <Alert tone="error">{formError}</Alert>}
      <fieldset disabled={!editable} className="space-y-6">
        <Card title="Details">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <TextField label="Product name" error={errors.name?.message} {...register('name')} />
            </div>
            <div className="sm:col-span-2">
              <label
                htmlFor="product-description"
                className="block text-sm font-medium text-ink-800"
              >
                Description <span className="font-normal text-ink-500">(optional)</span>
              </label>
              <textarea
                id="product-description"
                rows={4}
                aria-invalid={errors.description ? true : undefined}
                className="mt-1.5 block w-full rounded-md border-0 px-3 py-2 text-sm ring-1 ring-inset ring-ink-300 focus:ring-2 focus:ring-inset focus:ring-brand-600 disabled:bg-ink-50"
                {...register('description')}
              />
              {errors.description && (
                <p className="mt-1.5 text-sm text-red-600">{errors.description.message}</p>
              )}
            </div>
            <SelectField
              label="Category"
              placeholder="No category"
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
              error={errors.categoryId?.message}
              {...register('categoryId')}
            />
            <SelectField
              label="Status"
              options={STATUS_OPTIONS}
              error={errors.status?.message}
              {...register('status')}
            />
          </div>
        </Card>

        <Card
          title="Variants"
          description={`Each variant has its own SKU, price and stock. Prices are in ${currency}.`}
        >
          <div className="mb-4 flex flex-wrap items-end gap-3">
            {optionNames.map((_, i) => (
              <div key={i} className="flex items-end gap-1">
                <TextField
                  label={`Option ${i + 1}`}
                  placeholder={['Size', 'Color', 'Material'][i]}
                  error={errors.optionNames?.[i]?.message}
                  {...register(`optionNames.${i}`)}
                />
                {editable && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove option ${i + 1}`}
                    onClick={() => removeOption(i)}
                  >
                    <TrashIcon aria-hidden="true" className="size-4" />
                  </Button>
                )}
              </div>
            ))}
            {editable && optionNames.length < MAX_OPTIONS && (
              <Button size="sm" variant="secondary" onClick={addOption}>
                <PlusIcon aria-hidden="true" className="size-4" /> Add option (size, color…)
              </Button>
            )}
          </div>

          <div className="relative -mx-5 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-ink-50 text-left text-[0.8125rem] font-semibold text-ink-600">
                <tr>
                  {optionNames.map((name, i) => (
                    <th key={i} scope="col" className="px-3 py-2 first:pl-5">
                      {name || `Option ${i + 1}`}
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2 first:pl-5">
                    SKU
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Price
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Cost
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Low stock at
                  </th>
                  {editable && (
                    <th scope="col" className="px-3 py-2 pr-5">
                      <span className="sr-only">Remove</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {variants.fields.map((field, row) => {
                  const rowErrors = variantErrors[row] ?? {};
                  const cellError = (name) => rowErrors[name]?.message;
                  const input = (name, label, props = {}) => (
                    <td className="px-3 py-2 align-top first:pl-5">
                      <input
                        aria-label={`${label}, variant ${row + 1}`}
                        aria-invalid={cellError(name) ? true : undefined}
                        className={cellInput(Boolean(cellError(name)))}
                        {...props}
                        {...register(`variants.${row}.${name}`)}
                      />
                      {cellError(name) && (
                        <p className="mt-1 text-xs text-red-600">{cellError(name)}</p>
                      )}
                    </td>
                  );
                  return (
                    <tr key={field.id}>
                      {optionNames.map((name, i) => (
                        <td key={i} className="px-3 py-2 align-top first:pl-5">
                          <input
                            aria-label={`${name || `Option ${i + 1}`}, variant ${row + 1}`}
                            className={cellInput(Boolean(rowErrors.optionValues?.[i]))}
                            {...register(`variants.${row}.optionValues.${i}`)}
                          />
                        </td>
                      ))}
                      {input('sku', 'SKU', {
                        className: `${cellInput(Boolean(cellError('sku')))} font-mono uppercase`,
                      })}
                      {input('price', 'Price', { inputMode: 'decimal', placeholder: '0.00' })}
                      {input('cost', 'Cost', { inputMode: 'decimal', placeholder: 'Optional' })}
                      {input('lowStockThreshold', 'Low stock threshold', { inputMode: 'numeric' })}
                      {editable && (
                        <td className="px-3 py-2 pr-5 align-top">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Remove variant ${row + 1}`}
                            disabled={variants.fields.length === 1}
                            onClick={() => variants.remove(row)}
                          >
                            <TrashIcon aria-hidden="true" className="size-4" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {errors.variants?.root?.message && (
            <p className="mt-2 text-sm text-red-600">{errors.variants.root.message}</p>
          )}
          {editable && (
            <div className="mt-4">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => variants.append(emptyVariant(optionNames.length))}
              >
                <PlusIcon aria-hidden="true" className="size-4" /> Add variant
              </Button>
            </div>
          )}
        </Card>
      </fieldset>

      {editable && (
        <div className="flex justify-end gap-2">
          <Link
            to="/products"
            className="rounded-md px-3.5 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100"
          >
            Cancel
          </Link>
          <Button type="submit" loading={save.isPending} disabled={product && !isDirty}>
            {product ? 'Save changes' : 'Create product'}
          </Button>
        </div>
      )}
    </form>
  );
}

function ProductActions({ product }) {
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const archived = product.status === 'ARCHIVED';

  const status = useMutation({
    mutationFn: (next) => setProductStatus(product.id, next),
    onSuccess: (saved) => {
      queryClient.setQueryData(['product', saved.id], saved);
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(
        saved.status === 'ARCHIVED' ? 'Product archived.' : 'Product restored as a draft.',
      );
    },
    onError: (e) => toast.error(getApiError(e).message),
  });
  const remove = useMutation({
    mutationFn: () => deleteProduct(product.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success(`${product.name} deleted.`);
      navigate('/products', { replace: true });
    },
    onError: (e) => {
      setConfirmDelete(false);
      toast.error(getApiError(e).message);
    },
  });

  return (
    <>
      <Button
        variant="secondary"
        loading={status.isPending}
        onClick={() => status.mutate(archived ? 'DRAFT' : 'ARCHIVED')}
      >
        {archived ? 'Restore' : 'Archive'}
      </Button>
      <Button variant="danger" onClick={() => setConfirmDelete(true)}>
        Delete
      </Button>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        title={`Delete ${product.name}?`}
        confirmLabel="Delete product"
      >
        The product, its variants and images are deleted permanently. Products with stock or order
        history cannot be deleted; archive them instead.
      </ConfirmDialog>
    </>
  );
}

export function ProductFormPage() {
  const { productId } = useParams();
  const can = useHasPermission();
  const editable = can('product:write');
  const categories = useQuery({ queryKey: ['categories'], queryFn: listCategories });
  const product = useQuery({
    queryKey: ['product', productId],
    queryFn: () => getProduct(productId),
    enabled: Boolean(productId),
  });

  if (productId && product.isError) {
    return (
      <Alert
        tone="error"
        action={
          <Link to="/products" className="text-sm font-medium">
            Back to products
          </Link>
        }
      >
        {getApiError(product.error).message}
      </Alert>
    );
  }
  if ((productId && product.isPending) || categories.isPending) {
    return <SkeletonRows rows={6} label="Loading product" />;
  }
  if (categories.isError) {
    return <Alert tone="error">{getApiError(categories.error).message}</Alert>;
  }

  const data = productId ? product.data : null;
  return (
    <>
      <PageHeader
        title={data ? data.name : 'New product'}
        description={
          data ? (
            <Badge tone={PRODUCT_STATUS[data.status].tone}>
              {PRODUCT_STATUS[data.status].label}
            </Badge>
          ) : (
            'Add a product with at least one variant.'
          )
        }
        actions={data && editable && <ProductActions product={data} />}
      />
      <div className="space-y-6">
        {/* key: re-initialise the form when switching between products */}
        <ProductForm
          key={data?.id ?? 'new'}
          product={data}
          categories={categories.data}
          editable={editable}
        />
        {data && <ProductImages product={data} editable={editable} />}
      </div>
    </>
  );
}
