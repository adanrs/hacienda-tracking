// Utility to format dates as dd/mm/yyyy throughout the app

export function formatDate(dateStr) {
  if (!dateStr) return '-';
  // Handle ISO format (yyyy-mm-dd) or already formatted
  const parts = dateStr.split('-');
  if (parts.length === 3 && parts[0].length === 4) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

// For display in tables and details
export function FDate({ value }) {
  return <span>{formatDate(value)}</span>;
}
