import { createHash, randomUUID } from 'node:crypto';
import { sensitiveField } from '../sensitive.mjs';

// The clear button of a field: antd draws the one of a select (and the
// remove button of each value a multi-select shows) as an aria-hidden span
// with no role, and the ones of a date picker and an input as role=button.
// The class prefix ("ant") can be renamed, so any prefix counts. readDOM
// keeps its own copy, as page code cannot reach this module.
export const CLEAR = ['select-clear', 'select-selection-item-remove', 'picker-clear', 'input-clear-icon']
  .flatMap((c) => [`[class$="-${c}"]`, `[class*="-${c} "]`]).join(',');

// This selector is only a discovery surface. It is never a durable identity.
// antd draws a select's options as divs with aria-selected and no role (its
// role=option copies sit in a hidden 0×0 listbox): those are options too.
export const INTERACTIVE = 'a[href],button,input:not([type=hidden]),textarea,select,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=switch],[role=tab],[role=menuitem],[role=option],[role=combobox],[role=listbox],[role=textbox],[role=searchbox],[role=spinbutton],[contenteditable=true],[onclick],[tabindex]:not([tabindex="-1"]),.cursor-pointer,[aria-selected]:not([role]):not(td):not(th):not(tr),' + CLEAR;

// Form fields. The box a field is drawn in holds no other of them. readDOM
// keeps its own copy, as page code cannot reach this module.
export const FIELD = 'input:not([type=hidden]),textarea,select,[role=textbox],[role=searchbox],[role=combobox],[role=spinbutton],[role=checkbox],[role=radio],[role=switch],[role=slider],[contenteditable=true]';

// Runs in the browser exclusively to READ state. No attributes, handlers,
// hidden nodes, DOM values or application state are changed by observation.
// `nodes` is the frame's node registry (see nodeRegistry), when given.
export function readDOM(elements, nodes) {
  elements = Array.isArray(elements) ? elements : [elements];
  const clean = (s, max = 500) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const parent = (e) => e.parentElement || e.getRootNode()?.host;
  const ancestors = (e) => { const a = []; for (let p = e; p; p = parent(p)) a.push(p); return a; };
  const closest = (e, selector) => ancestors(e).find((p) => p.matches(selector));
  // A box of at most 1px that clips what overflows it draws nothing inside
  // it: antd's 0×0 accessibility listbox, "visually hidden" text clipped to
  // rect(0 0 0 0) or inset(50%). A click on its content waits until it times
  // out, so that content is not observed.
  const clipsAll = (p, style) => {
    if (style.display === 'inline' || style.display === 'contents') return false;
    const tiny = () => { const r = p.getBoundingClientRect(); return r.width <= 1 || r.height <= 1; };
    if (/hidden|clip/.test(`${style.overflowX} ${style.overflowY}`) && tiny()) return true;
    if (style.clipPath === 'inset(50%)') return true;
    const rect = style.clip.match(/^rect\(([-\d.]+)px,? ([-\d.]+)px,? ([-\d.]+)px,? ([-\d.]+)px\)$/);
    return !!rect && ['absolute', 'fixed'].includes(style.position) && (rect[2] - rect[4] <= 1 || rect[3] - rect[1] <= 1);
  };
  // A field's clear button (see CLEAR in this module). antd hides a
  // select's from screen readers, though a person sees and clicks it: its
  // own aria-hidden does not hide it here. It is drawn at opacity 0 until
  // the pointer is over its field, as the browser's click moves it there.
  const CLEAR = ['select-clear', 'select-selection-item-remove', 'picker-clear', 'input-clear-icon']
    .flatMap((c) => [`[class$="-${c}"]`, `[class*="-${c} "]`]).join(',');
  const ariaHidden = (p, e) => p.getAttribute('aria-hidden') === 'true' && !(p === e && e.matches(CLEAR));
  const visible = (e) => {
    if (!e.isConnected || !e.getClientRects().length) return false;
    return !ancestors(e).some((p) => {
      const style = getComputedStyle(p);
      return p.hidden || p.inert || ariaHidden(p, e) || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || clipsAll(p, style);
    });
  };
  // A count in a badge ("Todo 41") changes on its own as other work adds to
  // it. A badge has a class hook (badge, unread, antd's scroll-number) or is
  // a small filled pill, as Tailwind draws one. The review copy of a text
  // shows its count as "#" (see reviewedState); the text reads it as usual.
  const BADGE = 'sup,[class*="badge" i],[class*="scroll-number" i],[class*="counter" i],[class*="unread" i]';
  const COUNT = /^\s*\d{1,6}\+?\s*$/;
  const pill = (node) => {
    const box = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return box.height > 0 && box.height <= 24 && box.width <= 48 && parseFloat(style.borderTopLeftRadius) >= box.height / 3
      && !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(style.backgroundColor);
  };
  const badged = (node) => {
    if (node.matches(BADGE)) return COUNT.test(node.textContent);
    // A pill holds its number directly or in one wrapper.
    if (node.childElementCount > 1 || node.firstElementChild?.firstElementChild) return false;
    return COUNT.test(node.textContent) && pill(node);
  };
  // The text, and with `review` also its review copy when it holds a count.
  // Hidden, inert and aria-hidden content is not read: a walk checks each
  // node on its way down, and the ancestors of where it starts once. The
  // controls of one row share its text, so each text is read once.
  const unread = (p) => {
    if (p.hidden || p.inert || p.getAttribute('aria-hidden') === 'true') return true;
    const style = getComputedStyle(p);
    return style.display === 'none' || style.visibility === 'hidden';
  };
  const reads = new Map();
  const readNow = (e, max, review) => {
    if (ancestors(e).slice(1).some(unread)) return [''];
    const walk = (node, inBadge) => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent;
      if (node.nodeType !== Node.ELEMENT_NODE || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|INPUT|TEXTAREA|SELECT|OPTION)$/.test(node.tagName) || unread(node)) return '';
      const badge = review && !inBadge && badged(node);
      const inner = [...(node.shadowRoot || node).childNodes].map((child) => walk(child, inBadge || badge)).join(' ');
      return badge ? `\uE000${inner}\uE001` : inner;
    };
    const marked = walk(e, false);
    if (!marked.includes('\uE000')) return [clean(marked, max)];
    return [clean(marked.replace(/[\uE000\uE001]/g, ''), max), clean(marked.replace(/\uE000[^\uE001]*\uE001/g, ' # '), max)];
  };
  const read = (e, max = 500, review = false) => {
    if (!e) return [''];
    const key = `${max}:${review}`;
    let known = reads.get(e);
    if (!known) reads.set(e, known = new Map());
    if (!known.has(key)) known.set(key, readNow(e, max, review));
    return known.get(key);
  };
  const text = (e, max = 500) => read(e, max)[0];
  const idText = (e, ids) => (ids || '').split(/\s+/).map((id) => text(e.getRootNode().getElementById?.(id), 180)).filter(Boolean).join(' ');
  // Toggle buttons often keep the alternate icon in the DOM hidden with CSS
  // (favorite/unfavorite), so computed display/visibility counts too. An SVG
  // <title> is never rendered itself; judge it by its parent graphic.
  const iconHidden = (icon) => {
    const shown = icon.matches('svg title') ? icon.parentElement : icon;
    if (!shown || getComputedStyle(shown).visibility !== 'visible') return true;
    return ancestors(shown).some((p) => p.hidden || p.inert || ariaHidden(p, p) || getComputedStyle(p).display === 'none');
  };
  const iconName = (e) => [...e.querySelectorAll('[role=img][aria-label],svg title,img[alt]')]
    .filter((icon) => !iconHidden(icon))
    .map((icon) => clean(icon.getAttribute('aria-label') || icon.getAttribute('alt') || icon.textContent, 180)).filter(Boolean).join(' ');
  // Asset names are explicitly hints, never fabricated accessible names. Strip
  // query/fragment data; opaque or duplicate icons still fail unique identity.
  const iconHint = (e) => {
    const img = e.matches('img[src]') ? e : e.querySelector('img[src]');
    if (!img) return '';
    try {
      const url = new URL(img.getAttribute('src'), location.href);
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      const filename = decodeURIComponent(url.pathname.split('/').at(-1));
      if (!/\.(svg|png|webp|gif|jpe?g)$/i.test(filename)) return '';
      const hint = filename.split('.')[0].replace(/[_-]+/g, ' ');
      return /^[a-z][a-z0-9 ]{0,79}$/i.test(hint) ? `icon: ${hint}` : '';
    } catch { return ''; }
  };
  // A field with no accessible name still has the name a person reads next
  // to it: its column's header in a table, a label just before it in its own
  // box (an antd Form.Item label without `for`), or a search icon inside it.
  // Only text, search and select fields get these names, and only when no
  // attribute, label or placeholder names them.
  const FIELD = 'input:not([type=hidden]),textarea,select,[role=textbox],[role=searchbox],[role=combobox],[role=spinbutton],[role=checkbox],[role=radio],[role=switch],[role=slider],[contenteditable=true]';
  const TYPABLE = 'input:not([type=checkbox],[type=radio],[type=button],[type=submit],[type=reset],[type=image],[type=hidden],[type=range],[type=color],[type=file]),textarea,select,[role=textbox],[role=searchbox],[role=combobox],[role=spinbutton],[contenteditable=true]';
  // What a select shows as its value: antd's selection item, react-select's
  // single or multi value.
  const SHOWN = '[class*="selection-item" i],[class*="single-value" i],[class*="singlevalue" i],[class*="multi-value" i],[class*="multivalue" i],[class*="selected-value" i]';
  // Never a label: controls, icons, live regions, a select's value or placeholder.
  const UNLABEL = 'script,style,template,noscript,input,textarea,select,option,button,a[href],[role=button],[role=link],[role=img],svg,[aria-live],[role=status],[role=alert],[role=log],[role=tooltip],[class*="placeholder" i],[class*="material-icons" i],[class*="material-symbols" i],' + SHOWN;
  const fieldsIn = (box) => box.querySelectorAll(FIELD).length + (box.matches(FIELD) ? 1 : 0);
  const labelText = (n) => {
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent;
      if (node.nodeType !== Node.ELEMENT_NODE || node.matches(UNLABEL) || node.hidden || node.getAttribute('aria-hidden') === 'true') return '';
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return '';
      return [...node.childNodes].map(walk).join(' ');
    };
    // "* Bill to:" names the field "Bill to".
    return clean(walk(n), 200).replace(/^[*\s]+|[*:：\s]+$/g, '');
  };
  const headings = new Map();
  // The leaf header cell of each column: from the table's thead, a first row
  // of th, or a thead of a separate header table (antd with a fixed header).
  const tableHeadings = (table) => {
    if (headings.has(table)) return headings.get(table);
    let rows = table.tHead?.rows;
    if (!rows?.length && table.rows[0] && [...table.rows[0].cells].every((c) => c.tagName === 'TH')) rows = [table.rows[0]];
    // A header table of its own (antd's, Element's): drawn just before the
    // table or a box it is in, up to 4 levels out, heading no rows of its
    // own. Another table's head, or one further away, heads nothing here.
    for (let at = table, depth = 0; !rows?.length && at && depth < 4; at = at.parentElement, depth++) {
      const before = at.previousElementSibling;
      const head = before && [...(before.matches('thead') ? [before] : before.querySelectorAll('thead'))].at(-1);
      if (head && ![...(head.closest('table')?.tBodies || [])].some((b) => b.rows.length)) rows = head.rows;
    }
    const grid = [];
    [...(rows || [])].forEach((row, r) => {
      let c = 0;
      for (const cell of row.cells) {
        while (grid[r]?.[c]) c++;
        const span = Math.max(1, cell.colSpan || 1);
        const down = cell.rowSpan > 0 ? cell.rowSpan : rows.length - r;
        for (let dr = 0; dr < down; dr++) for (let dc = 0; dc < span; dc++) (grid[r + dr] ||= [])[c + dc] = cell;
        c += span;
      }
    });
    headings.set(table, grid.at(-1) || []);
    return headings.get(table);
  };
  // The header cell of the column a field's table cell is in.
  const headerCell = (e) => {
    const cell = closest(e, 'td,[role=cell],[role=gridcell]');
    const row = cell && closest(cell, 'tr,[role=row]');
    if (!row) return undefined;
    if (cell.tagName === 'TD' && row.tagName === 'TR') {
      const table = row.closest('table');
      if (!table) return undefined;
      const columns = tableHeadings(table);
      const width = [...row.cells].reduce((n, c) => n + Math.max(1, c.colSpan || 1), 0);
      // antd adds a scrollbar column to a separate header table.
      if (columns.length < width || columns.length > width + 1) return undefined;
      let index = 0;
      for (const c of row.cells) { if (c === cell) break; index += Math.max(1, c.colSpan || 1); }
      return columns[index];
    }
    const grid = closest(row, '[role=grid],[role=table],[role=treegrid]');
    if (!grid) return undefined;
    const cellsOf = (r) => [...r.querySelectorAll('[role=cell],[role=gridcell],[role=columnheader],[role=rowheader]')].filter((c) => closest(c, '[role=row]') === r);
    if (!headings.has(grid)) {
      const headRow = [...grid.querySelectorAll('[role=row]')].find((r) => r.querySelector('[role=columnheader]'));
      headings.set(grid, headRow ? cellsOf(headRow) : []);
    }
    const heads = headings.get(grid);
    const at = cell.getAttribute('aria-colindex');
    const cells = cellsOf(row);
    return at ? heads.find((h) => h.getAttribute('aria-colindex') === at) : heads.length === cells.length ? heads[cells.indexOf(cell)] : undefined;
  };
  const cellHeader = (e) => {
    const head = headerCell(e);
    const words = head ? labelText(head) : '';
    return words.length <= 60 ? words : '';
  };
  // Which row of its table a field's row is, counted as a person counts the
  // rows they see: a header row, or a row drawn with no height (antd's
  // measure row), does not count. ccMonet's invoice lines have no key of
  // their own, and fields of two lines read alike ("Unit Price"): the line
  // number tells them apart.
  const GRID = '[role=grid],[role=table],[role=treegrid]';
  const shownRows = new Map();
  const rowNumber = (e) => {
    const cell = closest(e, 'td,[role=cell],[role=gridcell]');
    const row = cell && closest(cell, 'tr,[role=row]');
    const table = row && (row.tagName === 'TR' ? row.closest('table') : closest(row, GRID));
    if (!table) return undefined;
    if (!shownRows.has(table)) {
      const rows = row.tagName === 'TR' ? [...table.rows] : [...table.querySelectorAll('[role=row]')].filter((r) => closest(r, GRID) === table);
      const head = (r) => r.parentElement?.tagName === 'THEAD'
        || (r.tagName === 'TR' ? [...r.cells].every((c) => c.tagName === 'TH') : !!r.querySelector('[role=columnheader]') && !r.querySelector('[role=gridcell],[role=cell]'));
      shownRows.set(table, {
        heads: rows.filter(head).length,
        rows: rows.filter((r) => !head(r) && r.getAttribute('aria-hidden') !== 'true' && r.getBoundingClientRect().height > 1),
      });
    }
    const { heads, rows } = shownRows.get(table);
    // A grid that draws only the rows in view numbers each of them, its
    // header rows included (aria-rowindex).
    const index = Number(row.getAttribute('aria-rowindex'));
    if (Number.isInteger(index) && index > heads) return index - heads;
    const at = rows.indexOf(row);
    return at < 0 ? undefined : at + 1;
  };
  // A label sits just above its field or just before it on the same line. A
  // logo or title further along a toolbar does not name the search box in it.
  const beside = (n, box) => {
    let l = n.getBoundingClientRect?.();
    if (!l) { const range = document.createRange(); range.selectNodeContents(n); l = range.getBoundingClientRect(); }
    const f = box.getBoundingClientRect();
    if (l.width <= 1 && l.height <= 1) return false;
    const rtl = getComputedStyle(box).direction === 'rtl';
    const gap = rtl ? l.left - f.right : f.left - l.right;
    const above = l.bottom <= f.top + 4 && f.top - l.bottom <= 48 && l.left < f.right + 8 && l.right > f.left - 8;
    return above || gap >= -4 && gap <= 120 && l.top < f.bottom && l.bottom > f.top;
  };
  // The nearest text before the field, in the boxes around it that hold no
  // other field: "Range [from] [to]" names neither. A label for another
  // control in between ends the search. Returns the node that holds it.
  const labelBefore = (e) => {
    let cur = e;
    for (let depth = 0; depth < 8; depth++) {
      const box = parent(cur);
      if (!box || box === document.body || box === document.documentElement || fieldsIn(box) > 1) return undefined;
      for (let n = cur.previousSibling; n; n = n.previousSibling) {
        if (n.nodeType === Node.ELEMENT_NODE) {
          if (n.matches(FIELD) || n.querySelector(FIELD)) return undefined;
          const owner = n.matches('label') ? n : n.querySelector('label');
          if (owner?.control && owner.control !== e) return undefined;
          if (n.matches(UNLABEL)) continue;
          if (n.textContent.length > 300) return undefined;
        } else if (n.nodeType !== Node.TEXT_NODE) continue;
        const words = labelText(n);
        if (words) return words.length <= 60 && beside(n, cur) ? n : undefined;
      }
      cur = box;
    }
    return undefined;
  };
  const precedingLabel = (e) => {
    const n = labelBefore(e);
    return n ? labelText(n) : '';
  };
  // What the page marks on a field, as a person reads it. Required: its
  // required attribute, or a mark on its label or its column's header: a
  // "*" before or after the words, or a class saying so (antd's
  // ant-form-item-required, a th.required). An error: a class saying so on
  // the field or a box it is drawn in, up to its table cell, while the box
  // holds no other field (antd's ant-select-status-error and
  // ant-form-item-has-error, Bootstrap's is-invalid, a cell's error). On
  // ccMonet's invoice, nothing else said Tracking Category was required: its
  // header is th.required, and its cell took an error class when Save as
  // Draft was refused (Mac run on 9a83708).
  const REQUIRED_CLASS = /(?:^|[-_])required$/i;
  const ERROR_CLASS = /(?:^|[-_])(?:error|invalid)$/i;
  const NEGATED = /(?:^|[-_])(?:no|not|non|un)[-_]?(?:required|error|invalid)$/i;
  const classed = (n, pattern) => [...(n?.classList || [])].some((c) => pattern.test(c) && !NEGATED.test(c));
  const shownText = (n) => (n?.nodeType === Node.TEXT_NODE ? clean(n.textContent, 200) : n?.nodeType === Node.ELEMENT_NODE ? text(n, 200) : '');
  const STARRED = /^[*＊]|[*＊]\s*[:：]?$/;
  // A "*" of its own just before or after the label: "<b>*</b> Customer".
  const starBeside = (n) => ['previousSibling', 'nextSibling'].some((step) => {
    let s = n[step];
    while (s?.nodeType === Node.TEXT_NODE && !s.textContent.trim()) s = s[step];
    return !!s && /^[*＊]$/.test(shownText(s));
  });
  const marksRequired = (n, { beside: near = false } = {}) => !!n && (
    n.nodeType === Node.ELEMENT_NODE && (classed(n, REQUIRED_CLASS) || [...n.querySelectorAll('[class]')].some((x) => classed(x, REQUIRED_CLASS)))
    || STARRED.test(shownText(n)) || near && starBeside(n));
  const requiredMark = (e) => {
    if (!e.matches(FIELD)) return false;
    if (e.required === true || e.getAttribute('aria-required') === 'true') return true;
    const labels = [...(e.labels || []), closest(e, 'label'),
      ...(e.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map((id) => e.getRootNode().getElementById?.(id))];
    return labels.some((l) => marksRequired(l)) || marksRequired(headerCell(e)) || marksRequired(labelBefore(e), { beside: true });
  };
  const errorMark = (e) => {
    if (!e.matches(FIELD)) return false;
    for (let box = e, depth = 0; box && box !== document.body && depth < 10; box = parent(box), depth++) {
      if (box !== e && fieldsIn(box) > 1) return false;
      if (classed(box, ERROR_CLASS)) return true;
      if (box.matches('td,th,[role=cell],[role=gridcell]')) return false;
    }
    return false;
  };
  // A search icon in the field's own box. An open antd Select shows a search
  // icon after its input, so only an icon before it names a combobox.
  const SEARCH_ICON = /(^|[^a-z])(search|magnif)|搜索|查找|検索/i;
  const searchHint = (e) => {
    let box = e;
    for (let depth = 0; depth < 3; depth++) {
      const up = parent(box);
      if (!up || up === document.body || fieldsIn(up) > 1) break;
      box = up;
    }
    if (box === e) return '';
    const combobox = role(e) === 'combobox';
    for (const icon of box.querySelectorAll('svg,img,i,[role=img],[class*="icon" i],[data-icon]')) {
      if (icon.contains(e) || e.contains(icon)) continue;
      if (combobox && !(icon.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      const use = icon.querySelector('use');
      const hint = [...['aria-label', 'title', 'alt', 'data-icon', 'class', 'src'].map((a) => icon.getAttribute(a)), use?.getAttribute('href'), use?.getAttribute('xlink:href')].filter(Boolean).join(' ');
      if (SEARCH_ICON.test(hint) && !iconHidden(icon)) return 'search';
    }
    return '';
  };
  // Text drawn over a field that has no placeholder attribute: a hint layer
  // ("Search contacts, vendor bills, ..."), or antd's select placeholder. It
  // goes away once the field holds a value, so it tells Jev what the field
  // is for but never names it: a name must stay the same while typing.
  const hintText = (e) => {
    if (!e.matches(TYPABLE) || e.getAttribute('placeholder')) return '';
    let box = e;
    for (let depth = 0; depth < 3; depth++) {
      const up = parent(box);
      if (!up || up === document.body || fieldsIn(up) > 1) break;
      box = up;
    }
    if (box === e) return '';
    const f = e.getBoundingClientRect();
    for (const n of box.querySelectorAll('*')) {
      if (n.contains(e) || e.contains(n) || closest(n, SHOWN) || n.matches(FIELD) || ![...n.childNodes].some((c) => c.nodeType === Node.TEXT_NODE && c.textContent.trim())) continue;
      const style = getComputedStyle(n);
      if (style.display === 'none' || style.visibility !== 'visible' || n.closest('[aria-hidden=true]')) continue;
      const own = closest(n, '[class*="placeholder" i]');
      const r = n.getBoundingClientRect();
      const over = Math.max(0, Math.min(r.right, f.right) - Math.max(r.left, f.left)) * Math.max(0, Math.min(r.bottom, f.bottom) - Math.max(r.top, f.top));
      if (!(own && box.contains(own)) && !(r.width * r.height > 0 && over >= r.width * r.height / 2)) continue;
      const words = text(own && box.contains(own) ? own : n, 121);
      if (words && words.length <= 120) return words;
    }
    return '';
  };
  const visualName = (e) => {
    if (!e.matches(TYPABLE)) return '';
    const label = cellHeader(e) || precedingLabel(e);
    const search = searchHint(e);
    return label && search ? `${label} (search)` : label || (search && 'Search');
  };
  // The value a select-like combobox shows when its input holds only the
  // search text, as in antd and react-select.
  const shown = (e) => {
    if (role(e) !== 'combobox' || e.tagName === 'SELECT' || !('value' in e) || String(e.value)) return undefined;
    let box = e;
    for (let depth = 0; depth < 4; depth++) {
      const up = parent(box);
      if (!up || up === document.body || fieldsIn(up) > 1) break;
      box = up;
    }
    const items = [...box.querySelectorAll(SHOWN)].filter((n) => !n.contains(e) && !n.querySelector(SHOWN));
    return clean(items.map((n) => text(n, 100)).filter(Boolean).join(', '), 200) || undefined;
  };
  // A placeholder that says how to fill a field ("Select date", "请输入",
  // "YYYY-MM-DD") names no field: on ccMonet every date says "Select date".
  // A label next to the field names it better.
  const GENERIC = /^((please\s+)?(select|choose|pick|enter|input|type|search)(\s+(a|an|the))?(\s+(date|time|month|year|week|quarter|value|option|one|item|text|here))?\s*(\.{3}|…)?|(请|請)?(选择|選擇|输入|輸入)(日期|时间|時間|月份|年份)?|[ymdhs]{1,4}([/\-. :][ymdhs]{1,4})*|[\d.,\s]+)$/i;
  const placeholderName = (e) => {
    const placeholder = clean(e.getAttribute('placeholder'));
    return placeholder && !GENERIC.test(placeholder) ? placeholder : visualName(e) || placeholder;
  };
  const name = (e) => clean(e.getAttribute('aria-label') || idText(e, e.getAttribute('aria-labelledby'))
    || [...(e.labels || [])].map((l) => text(l, 180)).join(' ') || text(closest(e, 'label'), 180)
    || e.getAttribute('alt') || e.getAttribute('title') || (e.matches('button,a,[role=button],.cursor-pointer') || role(e) === 'option' ? text(e, 180) : '')
    || (['submit', 'button', 'reset'].includes(e.type) ? e.value : '')
    || (e.matches('button,[role=button],.cursor-pointer') || e.matches(CLEAR) ? iconName(e) || iconHint(e) : '') || placeholderName(e) || e.getAttribute('name')
    || (e.matches(CLEAR) ? clean(e.textContent, 20) : ''));
  const role = (e) => e.getAttribute('role') || ({ A: 'link', BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox', SUMMARY: 'button' })[e.tagName]
    || (e.tagName === 'INPUT' ? ({ checkbox: 'checkbox', radio: 'radio', search: 'searchbox', submit: 'button', reset: 'button', button: 'button', number: 'spinbutton' })[e.type] || 'textbox' : e.isContentEditable ? 'textbox'
      : e.hasAttribute('aria-selected') && !/^(TD|TH|TR)$/.test(e.tagName) ? 'option' : e.matches(CLEAR) ? 'button' : undefined);
  // The field a clear button empties: the one field in the box it is drawn
  // in, up to 4 levels out.
  const clearedField = (e) => {
    if (!e.matches(CLEAR)) return undefined;
    for (let box = parent(e), depth = 0; box && box !== document.body && depth < 4; box = parent(box), depth++) {
      const count = fieldsIn(box);
      if (count > 1) return undefined;
      if (count === 1) return box.matches(FIELD) ? box : box.querySelector(FIELD);
    }
    return undefined;
  };
  const all = [...elements];
  const modals = all.filter((e) => e.matches('dialog[open],[role=dialog][aria-modal=true]') && visible(e));
  // Dialogs without focusable attributes are discovered independently.
  for (const e of document.querySelectorAll('dialog[open],[role=dialog][aria-modal=true]')) if (visible(e) && !modals.includes(e)) modals.push(e);
  const modal = modals.at(-1);
  // A popup that a control in the modal opened belongs to it, though it is
  // drawn outside: an antd select in a drawer shows its options at the end
  // of the body. The popup is its listbox's box, up to 4 levels out, short
  // of any box that holds the modal. Without such a link, an option that
  // floats outside the modal belongs to it while a control in it is open.
  const popups = !modal ? [] : [...modal.querySelectorAll('[aria-expanded=true][aria-controls],[aria-expanded=true][aria-owns]')]
    .flatMap((c) => `${c.getAttribute('aria-controls') || ''} ${c.getAttribute('aria-owns') || ''}`.split(/\s+/).filter(Boolean))
    .map((id) => modal.getRootNode().getElementById?.(id) || document.getElementById(id)).filter((p) => p && !modal.contains(p))
    .map((p) => { for (let up = 0; up < 4 && p.parentElement && p.parentElement !== document.body && !p.parentElement.contains(modal); up++) p = p.parentElement; return p; });
  const opened = !!modal?.querySelector('[aria-expanded=true]');
  const floats = (e) => ancestors(e).some((p) => ['absolute', 'fixed'].includes(getComputedStyle(p).position));
  const permitted = (e) => !modal || ancestors(e).includes(modal) || !!closest(e, '[role=listbox],[role=option]') || popups.some((p) => p.contains(e))
    || opened && role(e) === 'option' && floats(e);
  // The field whose popup holds an element. An open combobox names its list
  // in aria-controls or aria-owns. antd names a hidden copy and draws the
  // options beside it, so a list reaches out to the floating box that holds
  // it, unless that box also holds the combobox. Without such a link, an
  // option in a floating box of its own belongs to the one open combobox
  // only when that box is drawn for it (see drawnFor); a menu or another
  // widget floating elsewhere on the page is not its list.
  // A focused text field that holds text can draw a floating box under or
  // over itself with no link at all: suggestions, or the results of a global
  // search box ("Vendor 1 CP-MEIJI CO.,LTD." on ccMonet).
  const floating = (p) => ['absolute', 'fixed'].includes(getComputedStyle(p).position);
  const floatOf = (p) => {
    for (let up = 0; p && p !== document.body && up < 5; up++, p = p.parentElement) if (floating(p)) return p;
    return undefined;
  };
  // A list drawn for a combobox sits against the box the combobox is drawn
  // in (up to 4 levels out, while it holds no other field), or over it:
  // across from it, and at most 64px under or over it. The driver checks the
  // same before it clicks such an option (see listsOption there).
  const drawnFor = (list, c) => {
    let box = c;
    for (let depth = 0; depth < 4; depth++) {
      const up = parent(box);
      if (!up || up === document.body || fieldsIn(up) > 1) break;
      box = up;
    }
    const r = list.getBoundingClientRect(), f = box.getBoundingClientRect();
    return r.width * r.height > 0 && r.left < f.right && r.right > f.left && Math.max(r.top - f.bottom, f.top - r.bottom) <= 64;
  };
  const openBoxes = all.filter((c) => role(c) === 'combobox' && c.tagName !== 'SELECT' && c.getAttribute('aria-expanded') === 'true' && visible(c));
  const lists = openBoxes.map((c) => [c, `${c.getAttribute('aria-controls') || ''} ${c.getAttribute('aria-owns') || ''}`.split(/\s+/).filter(Boolean)
    .map((id) => c.getRootNode().getElementById?.(id) || document.getElementById(id)).filter(Boolean)
    .map((l) => { const box = floatOf(l); return box && !box.contains(c) ? box : l; })]);
  let focused = document.activeElement;
  while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
  if (!focused || !all.includes(focused) || !focused.matches(TYPABLE) || !String(focused.value ?? focused.textContent ?? '').trim() || !visible(focused)) focused = undefined;
  // A box drawn just under or over the focused field and across from it,
  // later in the page than the field, in a wrapper up to 4 levels out, that
  // holds a control other than a text field. Not a floating label or a clear
  // button inside the field, not a fixed header above it, and not the
  // floating parts of the next line item (an antd select's search box, a
  // remove button at the row's end).
  const popupBoxes = (() => {
    if (!focused || openBoxes.includes(focused)) return [];
    const f = focused.getBoundingClientRect();
    const controls = new Set(all);
    const judged = new Map();
    const fits = (n) => {
      if (!judged.has(n)) {
        const r = !n.contains(focused) && focused.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING && floating(n) && n.getBoundingClientRect();
        judged.set(n, !!r && r.width * r.height > 0 && r.left < f.right && r.right > f.left
          && (r.top >= f.bottom - 1 && r.top - f.bottom <= 64 || r.bottom <= f.top + 1 && f.top - r.bottom <= 64)
          && visible(n) && [n, ...n.querySelectorAll('*')].some((c) => controls.has(c) && !c.matches(TYPABLE) && visible(c)));
      }
      return judged.get(n);
    };
    for (let w = focused.parentElement, up = 0; w && w !== document.body && up < 4; w = w.parentElement, up++) {
      const boxes = [...w.querySelectorAll('*')].filter(fits);
      const outer = boxes.filter((b) => !boxes.some((o) => o !== b && o.contains(b)));
      if (outer.length) return outer;
    }
    return [];
  })();
  // The field whose popup holds `e`, and the popup's box.
  const popupOwner = (e) => {
    const option = role(e) === 'option' && !closest(e, 'select');
    for (const [c, roots] of lists) {
      if (option && c.contains(e)) return [c, c];
      const root = roots.find((r) => r.contains(e));
      if (root) return [c, root];
    }
    const box = option && openBoxes.length === 1 && ancestors(e).slice(1).find(floating);
    if (box && !box.contains(openBoxes[0]) && drawnFor(box, openBoxes[0])) return [openBoxes[0], box];
    const result = popupBoxes.find((b) => b.contains(e));
    return result ? [focused, result] : [];
  };
  // Whose popup each element is in, asked once per element.
  const owners = new Map();
  const popupOf = (e) => {
    if (!owners.has(e)) owners.set(e, popupOwner(e));
    return owners.get(e);
  };
  const ownerOf = (e) => popupOf(e)[0];
  // The open popup an element is in: a field's popup (see popupOwner), else
  // the outermost box around it with a popup's role (antd draws a popover's
  // body as a tooltip, a dropdown as a menu). A click that only closed what
  // was open took away the controls of such boxes alone (see closedOnly).
  const POPUP_ROLES = '[role=tooltip],[role=menu],[role=listbox],[role=dialog],[role=alertdialog]';
  const layerOf = (e) => {
    let outer = popupOf(e)[1];
    if (outer) return outer;
    for (let p = closest(e, POPUP_ROLES); p; p = parent(p) && closest(parent(p), POPUP_ROLES)) outer = p;
    return outer;
  };
  // Whether an open combobox's list holds options the page does not draw.
  // A virtual list (antd's) puts only the options in view in the page, in a
  // box that scrolls (antd's turns its own wheel: overflow hidden), and
  // leaves room for the others above and below them: ccMonet's filter field
  // list held "Vendor" below them (Mac rerun, 2026-10-20). A list that draws
  // all its options leaves no such room, though it may scroll.
  const moreOptions = (c) => {
    if (!openBoxes.includes(c)) return undefined;
    const drawn = all.filter((o) => role(o) === 'option' && ownerOf(o) === c && visible(o));
    for (let p = drawn.length ? parent(drawn[0]) : null; p && p !== document.body && p !== document.documentElement && !p.contains(c); p = parent(p)) {
      if (!/auto|scroll|hidden/.test(getComputedStyle(p).overflowY) || p.scrollHeight <= p.clientHeight + 1) continue;
      // Where the drawn options start and end in what the box scrolls.
      const box = p.getBoundingClientRect();
      const first = drawn[0].getBoundingClientRect();
      const last = drawn.at(-1).getBoundingClientRect();
      const top = first.top - box.top - p.clientTop + p.scrollTop;
      const bottom = last.bottom - box.top - p.clientTop + p.scrollTop;
      const above = top > first.height / 2;
      const below = p.scrollHeight - bottom > last.height / 2;
      return above && below ? 'above and below' : below ? 'below' : above ? 'above' : undefined;
    }
    return undefined;
  };
  // What the focused field's popup says, for Jev to read as that field's.
  const popupText = (() => {
    const own = focused && lists.find(([c]) => c === focused);
    const boxes = own ? own[1].filter((r) => visible(r)) : popupBoxes;
    return boxes.map((b) => text(b, 600)).filter(Boolean).join(' ').slice(0, 600);
  })();
  // A toast ("Update successfully") floats over the page and goes away on its
  // own: a message or notification notice under any class prefix (antd's
  // ant-message-notice, or a renamed one), a toast or snackbar, and any
  // fixed-position alert or status region. The outermost one that floats
  // counts. Host review tickets leave its text out of the state they bind.
  // (Page code: constants must live inside this function.) A toast shows
  // over an open drawer too, though it is drawn outside it: "Please select
  // Payment Terms" after a Save in the drawer.
  const TOAST = '[role=alert],[role=status],[aria-live=assertive],[aria-live=polite],[class*="message-notice" i],[class*="notification-notice" i],[class*="toast" i],[class*="snackbar" i],[data-sonner-toast],.el-message,.el-notification';
  const toastLike = [...document.querySelectorAll(TOAST)].filter((e) => visible(e)
    && !e.querySelector('input,textarea,select') && ancestors(e).some((p) => getComputedStyle(p).position === 'fixed') && text(e, 301).length <= 300);
  const toastRoots = toastLike.filter((e) => !toastLike.some((t) => t !== e && t.contains(e)));
  // dnd-kit renders each sortable or draggable item as role=button with
  // aria-disabled while dragging is off. That state is about dragging only:
  // ccMonet's bill rows still open on click. Any other aria-disabled ancestor
  // still disables everything inside it.
  const dragOnly = (p) => /\b(sortable|draggable)\b/i.test(p.getAttribute('aria-roledescription') || '')
    || /(^|\s)DndDescribedBy-\d+(\s|$)/.test(p.getAttribute('aria-describedby') || '');
  // Only a submit control of a GET form loads the form's action. Checkboxes,
  // radios and fields in that form change nothing until it is submitted.
  const getAction = (e) => {
    const submits = e.tagName === 'BUTTON' ? !['button', 'reset'].includes(e.type) : e.tagName === 'INPUT' && ['submit', 'image'].includes(e.type);
    if (!submits || !e.form) return undefined;
    const method = e.hasAttribute('formmethod') ? e.formMethod : e.form.method;
    const action = e.getAttribute('formaction') || e.form.getAttribute('action');
    if (String(method || 'get').toLowerCase() !== 'get' || !action) return undefined;
    try {
      const url = new URL(action, document.baseURI);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined;
    } catch { return undefined; }
  };
  // The number the registry gave this node when it first saw it: the same
  // node has the same number in every observation of its document.
  const nodeOf = (e) => {
    if (!nodes) return undefined;
    let n = nodes.ids.get(e);
    if (n == null) nodes.ids.set(e, n = nodes.next++);
    return `${nodes.token}:${n}`;
  };
  const describe = (e, index) => {
    const form = e.form || closest(e, 'form,[role=form]');
    const section = closest(e, 'fieldset,[role=group],[role=dialog],dialog');
    const record = closest(e, '[data-record-id],[data-row-key],[data-id],tr,[role=row],article');
    const recordKey = record && (record.getAttribute('data-record-id') || record.getAttribute('data-row-key') || record.getAttribute('data-id') || record.id);
    const formKey = form && (form.id || form.getAttribute('name') || name(form) || clean(form.getAttribute('action')));
    const scope = section && (section.matches('fieldset') ? text(section.querySelector('legend'), 180) : name(section));
    const [local, localReview] = read(record || parent(e), 500, true);
    const [own, ownReview] = read(e, 180, true);
    const label = name(e);
    // The table column a field sits in: such a field belongs to its row's
    // item (an invoice line), not to the document. A field's clear button
    // sits in its column too.
    const column = (e.matches(TYPABLE) || e.matches(CLEAR)) && cellHeader(e) || undefined;
    const ariaOff = ancestors(e).filter((p) => p.getAttribute('aria-disabled') === 'true');
    const descriptor = {
      ordinal: index, node: nodeOf(e), tag: e.tagName.toLowerCase(), role: role(e), type: e.getAttribute('type') || (e.tagName === 'INPUT' ? e.type : undefined),
      label, text: own, name: e.getAttribute('name') || '', placeholder: e.getAttribute('placeholder') || '',
      href: e.getAttribute('href') || undefined,
      // Where a link opens: two same-address links are one choice only when both match.
      link_target: e.matches('a[href]') && e.getAttribute('target') || undefined,
      download: e.matches('a[href]') && e.hasAttribute('download') || undefined,
      value: 'value' in e ? String(e.value) : e.isContentEditable ? e.innerText : undefined,
      display: shown(e),
      column,
      // Which row of its table the field is in (see rowNumber), when the
      // table heads its columns: the rows of a table that only lays a form
      // out hold no items.
      row: column && rowNumber(e) || undefined,
      // What text drawn over an unnamed field says it is for.
      hint: (!label || label === e.getAttribute('name')) && hintText(e) || undefined,
      checked: 'checked' in e ? e.checked : e.hasAttribute('aria-checked') ? e.getAttribute('aria-checked') === 'true' : undefined,
      selected: e.hasAttribute('aria-selected') ? e.getAttribute('aria-selected') === 'true' : undefined,
      expanded: e.hasAttribute('aria-expanded') ? e.getAttribute('aria-expanded') === 'true' : undefined,
      // The ordinal of the field whose popup holds this element (see popupOwner).
      popup_of: ((owner) => (owner ? all.indexOf(owner) : undefined))(ownerOf(e)),
      // The number of the open popup's box it is in (see layerOf, nodeOf).
      layer: ((box) => (box ? nodeOf(box) : undefined))(layerOf(e)),
      // Where an open combobox's list holds more options than it shows.
      more_options: moreOptions(e),
      // The ordinal of the field this clear button empties (see clearedField).
      clears: ((field) => (field && all.includes(field) ? all.indexOf(field) : undefined))(clearedField(e)),
      disabled: e.matches(':disabled') || ariaOff.some((p) => !dragOnly(p)),
      // Inside a drag-only one. Playwright's input checks still count it as
      // disabled; the driver checks such targets itself.
      drag_disabled: ariaOff.some(dragOnly) || undefined,
      readonly: e.readOnly === true || e.getAttribute('aria-readonly') === 'true', contenteditable: e.isContentEditable,
      invalid: e.getAttribute('aria-invalid') === 'true' || (e.willValidate && !e.validity.valid) || false,
      // What the page marks on the field (see requiredMark, errorMark).
      required: requiredMark(e) || undefined,
      error_mark: errorMark(e) || undefined,
      validation_message: e.validationMessage || '', context: local, scope: scope || '',
      form_key: formKey || '', record_key: recordKey || '',
      form_action: getAction(e),
      toast: toastRoots.some((t) => t.contains(e)) || undefined,
      options: e.tagName === 'SELECT' ? [...e.options].map((o) => ({ text: clean(o.text), value: o.value, selected: o.selected, disabled: o.disabled || o.parentElement?.disabled === true })) : undefined,
      // Review copies with badge counts as "#", only when they differ.
      review_label: ownReview !== undefined && label === own ? ownReview : undefined,
      review_context: localReview,
    };
    return descriptor;
  };
  const filtered = all.map((e, i) => visible(e) && permitted(e) && !e.matches('dialog,[role=dialog]') ? describe(e, i) : null).filter(Boolean);
  const [modalText, modalReview] = read(modal || document.body, 24000, true);
  // With a modal open, the page says what the modal says, and what a toast
  // over it says.
  const over = modal ? toastRoots.filter((t) => !modal.contains(t)).map((t) => text(t, 300)).filter(Boolean) : [];
  const pageText = [modalText, ...over].join(' ').trim();
  const pageReview = modalReview === undefined ? undefined : [modalReview, ...over].join(' ').trim();
  return {
    documentKey: String(performance.timeOrigin), url: location.href, title: document.title,
    text: pageText, review_text: pageReview, background_context: modal ? text(document.querySelector('h1'), 500) : undefined,
    modal: !!modal,
    popup: focused && popupText ? { field: all.indexOf(focused), text: popupText } : undefined,
    toasts: toastRoots.map((e) => text(e, 300)).filter(Boolean),
    loading: { busy: document.readyState === 'loading' || all.some((e) => visible(e) && permitted(e) && e.getAttribute('aria-busy') === 'true') || [...document.querySelectorAll('[aria-busy=true],[role=progressbar]')].some(visible) },
    elements: filtered,
  };
}

// Playwright's result serializer takes longer than readDOM itself on a large
// page (about 600 of 1,000 ms for 2,000 controls); one JSON string crosses
// in a few milliseconds. A page that changed how JSON encodes (old
// Prototype.js adds Array.prototype.toJSON) gets the object sent as before.
// The function is built here from readDOM's own source, so the page runs no
// eval of its own.
const readDOMJson = new Function('elements', 'nodes', `const data = (${readDOM.toString()})(elements, nodes);
  try { if (JSON.stringify({ a: [1, 'x', true, null], b: { c: 2 } }) === '{"a":[1,"x",true,null],"b":{"c":2}}') return JSON.stringify(data); } catch {}
  return data;`);

// Numbers for the nodes readDOM sees in a frame's document, so that two
// observations can tell whether a control is the same node. The registry
// lives in the page's heap, but only this handle reaches it: no global or
// node of the page refers to it, so the page sees no change. Each document
// gets its own registry, with a token that keeps its numbers apart from an
// earlier registry's.
async function nodeRegistry(frame, info) {
  if (!info.nodes?.handle || info.nodes.revision !== info.revision) {
    const old = info.nodes;
    const handle = await frame.evaluateHandle((token) => ({ token, next: 1, ids: new WeakMap() }), randomUUID().slice(0, 8)).catch(() => undefined);
    info.nodes = { revision: info.revision, handle };
    old?.handle?.dispose().catch(() => {});
  }
  return info.nodes.handle;
}

// A frame fixed outside the window stays out of view however the page
// scrolls: no one sees what it says. ccMonet parks a status page widget at
// left -9999px until an incident is posted; its text changed as it loaded,
// and a review ticket went stale (Mac rerun, 2026-10-20).
function fixedOutOfView(owner) {
  const view = owner.ownerDocument.defaultView;
  let fixed = false;
  for (let e = owner; e && !fixed; e = e.parentElement || e.getRootNode()?.host) fixed = view.getComputedStyle(e).position === 'fixed';
  const box = owner.getBoundingClientRect();
  return fixed && (box.right <= 0 || box.bottom <= 0 || box.left >= view.innerWidth || box.top >= view.innerHeight);
}

export async function captureSnapshot(page, { pageId, sessionId, frameInfo, scope, maxElements = 2000 }) {
  const snapshotId = randomUUID();
  const refs = new Map();
  const frames = [];
  // Frames no one sees, and the frames inside them. page.frames() lists a
  // frame after the frame it is in.
  const unseen = new Set();
  for (const frame of page.frames()) {
    if (frame !== page.mainFrame()) {
      const owner = await frame.frameElement().catch(() => null);
      try {
        if (!owner || unseen.has(frame.parentFrame()) || !await owner.isVisible() || await owner.evaluate(fixedOutOfView).catch(() => false)) {
          unseen.add(frame);
          continue;
        }
      } finally { await owner?.dispose(); }
    }
    const info = frameInfo(frame);
    const revision = info.revision;
    const query = scope ? frame.locator(scope).locator(INTERACTIVE) : frame.locator(INTERACTIVE + ',dialog[open],[role=dialog][aria-modal=true]');
    if (scope && !await frame.locator(scope).count()) continue;
    let data;
    try {
      let raw;
      try { raw = await query.evaluateAll(readDOMJson, await nodeRegistry(frame, info)); }
      catch (error) {
        // The registry may belong to a document the frame left before its
        // navigation was seen: start a new one and read once more.
        if (!info.nodes?.handle || frame.isDetached()) throw error;
        info.nodes = undefined;
        raw = await query.evaluateAll(readDOMJson, await nodeRegistry(frame, info));
      }
      data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    }
    catch (error) { if (frame.isDetached()) continue; throw error; }
    if (info.revision !== revision) throw new Error('SNAPSHOT_CHANGED: document navigated during capture');
    const documentId = `${info.id}:${revision}:${data.documentKey}`;
    for (const e of data.elements) {
      const selector = `pw-ref:${snapshotId}:${info.id}:${e.ordinal}`;
      const { popup_of: _, clears: __, ...described } = e;
      const target = { ...described, selector, snapshot_id: snapshotId, page_id: pageId, session_id: sessionId, frame_id: info.id, document_id: documentId, identity_version: 2 };
      target.value_hash = createHash('sha256').update(String(e.value ?? '')).digest('hex');
      if (sensitiveField(target)) {
        target.value = '[REDACTED]'; target.text = '';
        if (target.display) target.display = '[REDACTED]';
      }
      refs.set(selector, { locator: query.nth(e.ordinal), frame, target });
      e.target = target;
    }
    frames.push({ info, revision, documentId, data });
  }
  if (frames.some((f) => f.info.revision !== f.revision || f.info.frame.isDetached())) throw new Error('SNAPSHOT_CHANGED: frame/document changed during capture');
  if (scope && !frames.length) throw new Error('SCOPE_NOT_FOUND');
  const modalFrames = frames.filter((f) => f.data.modal);
  // A modal in the main frame prevents interaction with covered child frames.
  const active = modalFrames.some((f) => f.info.frame === page.mainFrame()) ? modalFrames : frames;
  const elements = active.flatMap((f) => f.data.elements.map((e) => e.target));
  if (elements.length > maxElements) throw new Error(`OBSERVATION_LIMIT: ${elements.length} interactive elements, more than ${maxElements}; narrow the observation scope`);
  elements.forEach((e, i) => { e.i = i; });
  // An element in a field's popup names that field by its index here, and so
  // do a field's clear button and the popup of the focused field.
  let popup;
  for (const f of active) {
    const byOrdinal = new Map(f.data.elements.map((e) => [e.ordinal, e.target]));
    for (const e of f.data.elements) {
      if (e.popup_of != null && byOrdinal.get(e.popup_of)?.i != null) e.target.popup_of = byOrdinal.get(e.popup_of).i;
      if (e.clears != null && byOrdinal.get(e.clears)?.i != null) e.target.clears = byOrdinal.get(e.clears).i;
    }
    const field = f.data.popup && byOrdinal.get(f.data.popup.field);
    if (!popup && field?.i != null) popup = { field: field.i, text: f.data.popup.text };
  }
  const main = frames.find((f) => f.info.frame === page.mainFrame())?.data;
  return {
    refs,
    observation: {
      snapshot_id: snapshotId, page_id: pageId, session_id: sessionId,
      url: page.url(), title: main?.title || await page.title(),
      text: active.map((f) => f.data.text).join('\n'), background_context: main?.background_context,
      ...(active.some((f) => f.data.review_text != null) ? { review_text: active.map((f) => f.data.review_text ?? f.data.text).join('\n') } : {}),
      loading: { busy: active.some((f) => f.data.loading.busy) }, elements,
      toasts: active.flatMap((f) => f.data.toasts),
      ...(popup ? { popup } : {}),
      frames: active.map((f) => ({ frame_id: f.info.id, document_id: f.documentId, url: f.data.url })),
      metrics: { element_count: elements.length, frame_count: active.length },
    },
  };
}
