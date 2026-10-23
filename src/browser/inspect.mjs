// Fixed, read-only business oracle for the HOST, independent of Jev's target
// selection and completion decision. Never accepts executable caller code.
// `patterns` is SENSITIVE_PATTERNS from src/sensitive.mjs: this function runs
// in the page and cannot import sensitiveName(), so it rebuilds the same rule.
// `registry` is the frame's node registry and `secret` the numbers of the
// nodes a snapshot saw as secret fields (see secretNodes in snapshot.mjs): a
// field named only by text drawn over it is secret here too, also once that
// text has gone. The registry is only read.
export function inspectBusinessDOM({ patterns, registry, secret = [] } = {}) {
  const clean = (s, max = 1800) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const visible = (e) => {
    if (!e.getClientRects().length) return false;
    for (let p = e; p; p = p.parentElement) {
      const style = getComputedStyle(p);
      if (p.hidden || p.inert || p.getAttribute('aria-hidden') === 'true' || ['none'].includes(style.display) || ['hidden', 'collapse'].includes(style.visibility)) return false;
    }
    return true;
  };
  const long = new RegExp(patterns?.long || '(?!)', 'i');
  const short = new RegExp(patterns?.short || '(?!)', 'i');
  const sensitiveName = (value) => {
    const words = value.replace(/([a-z])([A-Z])/g, '$1 $2');
    return long.test(value) || long.test(words) || short.test(words);
  };
  const seenSecret = new Set(secret);
  const secretNode = (e) => {
    const n = registry?.ids?.get(e);
    return n != null && seenSecret.has(`${registry.token}:${n}`);
  };
  // Card and one-time-code autocomplete tokens are secret here as well.
  const legacySecret = /password|passwd|secret|token|api.?key|credit.?card|cvv|cvc|otp|one-time-code|cc-number|cc-csc|(?:security|verification|access|private).?(?:key|code)/i;
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
    const names = [label, e.name, e.id, e.autocomplete].join(' ');
    const secret = e.type === 'password' || legacySecret.test(names) || sensitiveName(names) || secretNode(e);
    const blockers = [];
    // A dnd-kit item's aria-disabled only turns dragging off (see snapshot.mjs).
    const dragOnly = (p) => !p.matches(':disabled,[inert]') && (/\b(sortable|draggable)\b/i.test(p.getAttribute('aria-roledescription') || '')
      || /(^|\s)DndDescribedBy-\d+(\s|$)/.test(p.getAttribute('aria-describedby') || ''));
    for (let p = e; p; p = p.parentElement) if (p.matches(':disabled,[aria-disabled=true],[inert]')) blockers.push({ tag: p.tagName.toLowerCase(), role: p.getAttribute('role'), id: p.id, aria_disabled: p.getAttribute('aria-disabled'), native_disabled: p.matches(':disabled'), ...(dragOnly(p) ? { drag_only: true } : {}) });
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
