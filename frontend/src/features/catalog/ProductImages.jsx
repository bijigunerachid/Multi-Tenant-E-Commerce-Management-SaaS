import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowUpTrayIcon, PhotoIcon, TrashIcon } from '@heroicons/react/20/solid';
import { Alert, Card, EmptyState } from '../../components/ui/layout.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { ConfirmDialog } from '../../components/ui/Dialog.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { getApiError } from '../../lib/apiClient.js';
import { deleteProductImage, uploadProductImage } from '../../services/catalogService.js';

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES = 10;

/** Upload, view and remove a product's images. The server re-checks every file. */
export function ProductImages({ product, editable }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const inputRef = useRef(null);
  const [error, setError] = useState(null);
  const [removing, setRemoving] = useState(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['product', product.id] });

  const upload = useMutation({
    mutationFn: (file) => uploadProductImage(product.id, file),
    onSuccess: () => {
      setError(null);
      refresh();
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Image uploaded.');
    },
    onError: (e) => {
      const apiError = getApiError(e);
      setError(apiError.details?.fieldErrors?.file ?? apiError.message);
    },
  });
  const remove = useMutation({
    mutationFn: (image) => deleteProductImage(product.id, image.id),
    onSuccess: () => {
      setRemoving(null);
      refresh();
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Image removed.');
    },
    onError: (e) => toast.error(getApiError(e).message),
  });

  const onFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) return setError('Choose a JPEG, PNG or WebP image.');
    if (file.size > MAX_BYTES) return setError('The image is larger than 5 MB.');
    upload.mutate(file);
  };

  const full = product.images.length >= MAX_IMAGES;

  return (
    <Card
      title="Images"
      description={`JPEG, PNG or WebP, up to 5 MB each, ${MAX_IMAGES} per product. The first image is used in lists.`}
      actions={
        editable && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED.join(',')}
              onChange={onFile}
              className="sr-only"
              aria-label="Choose an image to upload"
              tabIndex={-1}
            />
            <Button
              variant="secondary"
              size="sm"
              loading={upload.isPending}
              disabled={full}
              onClick={() => inputRef.current?.click()}
            >
              <ArrowUpTrayIcon aria-hidden="true" className="size-4" /> Upload image
            </Button>
          </>
        )
      }
    >
      {error && (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      {product.images.length === 0 ? (
        <EmptyState icon={PhotoIcon} title="No images yet" />
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {product.images.map((img, i) => (
            <li key={img.id} className="group relative">
              <img
                src={img.url}
                alt={img.altText ?? `${product.name}, image ${i + 1}`}
                className="aspect-square w-full rounded-md object-cover ring-1 ring-slate-200"
              />
              {editable && (
                <button
                  type="button"
                  onClick={() => setRemoving(img)}
                  aria-label={`Remove image ${i + 1}`}
                  className="absolute right-1.5 top-1.5 rounded-md bg-white/90 p-1 text-slate-600 shadow-sm ring-1 ring-slate-200 hover:text-red-600 focus-visible:outline-2 focus-visible:outline-indigo-600"
                >
                  <TrashIcon aria-hidden="true" className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={() => remove.mutate(removing)}
        loading={remove.isPending}
        title="Remove this image?"
        confirmLabel="Remove"
      >
        The image file is deleted. This cannot be undone.
      </ConfirmDialog>
    </Card>
  );
}
