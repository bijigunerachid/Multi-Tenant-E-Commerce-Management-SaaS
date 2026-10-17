import { apiClient, unwrap } from '../lib/apiClient.js';
import { downloadFile } from '../lib/download.js';

/** params: { days } or { from, to } (YYYY-MM-DD, in the organization's time zone). */
export const getDashboard = (params) => unwrap(apiClient.get('/reports/dashboard', { params }));

/**
 * report: 'sales' | 'products' | 'stores'. params: the range, plus `storeId` (sales,
 * products), `groupBy` (sales) and `page`/`pageSize` (products).
 */
export const getReport = (report, params) =>
  unwrap(apiClient.get(`/reports/${report}`, { params }));

/** Saves the report as CSV; resolves to the file name. */
export const downloadReport = (report, params) =>
  downloadFile(`/reports/${report}/export`, params, `${report}.csv`);
