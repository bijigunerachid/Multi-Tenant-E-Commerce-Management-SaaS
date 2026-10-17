import { apiClient } from './apiClient.js';

/**
 * Downloads a file from the API and saves it under the name the server gives. Fetched through
 * the API client (not a plain link) so errors such as rate limits arrive as JSON and can be
 * shown to the user instead of being saved as a file. Resolves to the file name.
 */
export async function downloadFile(path, params, fallbackName) {
  let res;
  try {
    res = await apiClient.get(path, { params, responseType: 'blob' });
  } catch (error) {
    // With responseType blob, an error body is a Blob too: turn it back into JSON.
    const blob = error.response?.data;
    if (blob instanceof Blob) {
      try {
        error.response.data = JSON.parse(await blob.text());
      } catch {
        // leave as is
      }
    }
    throw error;
  }
  const name =
    /filename="([^"]+)"/.exec(res.headers['content-disposition'] ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(res.data);
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return name;
}
