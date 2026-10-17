// CSV writing for exports (RFC 4180 quoting) with protection against spreadsheet formula
// injection: a cell that starts with = + - @ tab or carriage return is executed as a formula
// by Excel and similar tools, so such values are prefixed with a single quote (OWASP guidance).

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(values) {
  return `${values.map(csvCell).join(',')}\r\n`;
}
