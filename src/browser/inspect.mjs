// Fixed, read-only business oracle for the HOST, independent of Jev's target
// selection and completion decision. Never accepts executable caller code.
export function inspectBusinessDOM() {
  const clean = (s, max = 1800) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const visible = (e) => {
    if (!e.getClientRects().length) return false;
    for (let p = e; p; p = p.parentElement) {
      const style = getComputedStyle(p);
      if (p.hidden || p.inert || p.getAttribute('aria-hidden') === 'true' || ['none'].includes(style.display) || ['hidden', 'collapse'].includes(style.visibility)) return false;
    }
    return true;
  };
  const allTables = [...document.querySelectorAll('table,[role=table],[role=grid]')].filter(visible);
  const tables = allTables.slice(0, 12).map((table) => {
    const rows = [...table.querySelectorAll('tr,[role=row]')].filter(visible);
    return {
      caption: clean(table.querySelector('caption')?.innerText || table.getAttribute('aria-label')),
      row_count: rows.length,
      truncated: rows.length > 200,
      rows: rows.slice(0, 200).map((row) => [...row.querySelectorAll('th,td,[role=cell],[role=columnheader],[role=rowheader]')].filter(visible).slice(0, 50).map((cell) => clean(cell.innerText))),
    };
  });
  const allControls = [...document.querySelectorAll('input:not([type=hidden]),textarea,select,button,[role=button],.cursor-pointer')].filter(visible);
  const controls = allControls.slice(0, 1000).map((e) => {
    const label = clean(e.getAttribute('aria-label') || [...(e.labels || [])].map((l) => l.innerText).join(' ') || e.getAttribute('placeholder') || e.innerText, 180);
    const secret = e.type === 'password' || /password|passwd|secret|token|api.?key|credit.?card|cvv|cvc|otp|one-time-code|cc-number|cc-csc|(?:security|verification|access|private).?(?:key|code)/i.test([label, e.name, e.id, e.autocomplete].join(' '));
    const blockers = [];
    for (let p = e; p; p = p.parentElement) if (p.matches(':disabled,[aria-disabled=true],[inert]')) blockers.push({ tag: p.tagName.toLowerCase(), role: p.getAttribute('role'), id: p.id, aria_disabled: p.getAttribute('aria-disabled'), native_disabled: p.matches(':disabled') });
    return {
      tag: e.tagName.toLowerCase(), role: e.getAttribute('role'), type: e.type,
      label,
      value: secret ? '[REDACTED]' : 'value' in e ? clean(e.value) : undefined,
      checked: 'checked' in e ? e.checked : undefined,
      readonly: e.readOnly === true,
      disabled_ancestry: blockers,
    };
  });
  return { url: location.href, title: document.title, tables, controls, table_count: allTables.length, control_count: allControls.length, truncated_tables: allTables.length > tables.length, truncated_controls: allControls.length > controls.length, limits: { tables: 12, rows_per_table: 200, cells_per_row: 50, controls: 1000 } };
}
