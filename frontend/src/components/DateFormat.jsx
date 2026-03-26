// Utility to format dates as dd/mm/yyyy throughout the app

export function formatDate(dateStr) {
  if (!dateStr) return '-';
  // Convert to string if it's a Date object
  const str = typeof dateStr === 'string' ? dateStr : String(dateStr);
  // Handle ISO datetime (2025-12-01T00:00:00.000Z) - extract date part
  const datePart = str.includes('T') ? str.split('T')[0] : str;
  // Handle yyyy-mm-dd format
  const parts = datePart.split('-');
  if (parts.length === 3 && parts[0].length === 4) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return str;
}

// For display in tables and details
export function FDate({ value }) {
  return <span>{formatDate(value)}</span>;
}
