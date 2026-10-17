import { apiClient, unwrap } from '../lib/apiClient.js';

export const listCategories = () => unwrap(apiClient.get('/categories'));
export const createCategory = (body) => unwrap(apiClient.post('/categories', body));
export const updateCategory = (id, body) => unwrap(apiClient.patch(`/categories/${id}`, body));
export const deleteCategory = (id) => apiClient.delete(`/categories/${id}`);

/** Returns { data, meta } (the list endpoint is paginated). */
export const listProducts = (params) =>
  apiClient.get('/products', { params }).then((res) => res.data);
export const getProduct = (id) => unwrap(apiClient.get(`/products/${id}`));
export const createProduct = (body) => unwrap(apiClient.post('/products', body));
export const saveProduct = (id, body) => unwrap(apiClient.put(`/products/${id}`, body));
export const setProductStatus = (id, status) =>
  unwrap(apiClient.patch(`/products/${id}/status`, { status }));
export const deleteProduct = (id) => apiClient.delete(`/products/${id}`);

export function uploadProductImage(productId, file) {
  const form = new FormData();
  form.append('file', file);
  return unwrap(apiClient.post(`/products/${productId}/images`, form));
}
export const updateProductImage = (productId, imageId, body) =>
  unwrap(apiClient.patch(`/products/${productId}/images/${imageId}`, body));
export const deleteProductImage = (productId, imageId) =>
  apiClient.delete(`/products/${productId}/images/${imageId}`);
