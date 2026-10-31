export function toCSV(rows, columns) {
  const escape = value => {
    let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return [columns, ...rows.map(row => columns.map(key => row[key]))].map(row => row.map(escape).join(',')).join('\r\n');
}
