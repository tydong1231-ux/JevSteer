import { createHash, randomUUID } from 'node:crypto';
import { sensitiveField } from '../sensitive.mjs';

// This selector is only a discovery surface. It is never a durable identity.
// antd draws a select's options as divs with aria-selected and no role (its
// role=option copies sit in a hidden 0×0 listbox): those are options too.
export const INTERACTIVE = 'a[href],button,input:not([type=hidden]),textarea,select,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=switch],[role=tab],[role=menuitem],[role=option],[role=combobox],[role=listbox],[role=textbox],[role=searchbox],[role=spinbutton],[contenteditable=true],[onclick],[tabindex]:not([tabindex="-1"]),.cursor-pointer,[aria-selected]:not([role]):not(td):not(th):not(tr)';

// Runs in the browser exclusively to READ state. No attributes, handlers,
// hidden nodes, DOM values or application state are changed by observation.
export function readDOM(elements) {
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
  const visible = (e) => {
    if (!e.isConnected || !e.getClientRects().length) return false;
    return !ancestors(e).some((p) => {
      const style = getComputedStyle(p);
      return p.hidden || p.inert || p.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || clipsAll(p, style);
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
    return ancestors(shown).some((p) => p.hidden || p.inert || p.getAttribute('aria-hidden') === 'true' || getComputedStyle(p).display === 'none');
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
  // The leaf header cell of each column: from the table's thead, a thead of
  // a separate header table (antd with a fixed header), or a first row of th.
  const tableHeadings = (table) => {
    if (headings.has(table)) return headings.get(table);
    let rows = table.tHead?.rows;
    for (let up = table.parentElement, depth = 0; !rows?.length && up && depth < 4; up = up.parentElement, depth++) {
      const head = [...up.querySelectorAll('thead')].find((h) => !table.contains(h) && h.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING);
      rows = head?.rows;
    }
    if (!rows?.length && table.rows[0] && [...table.rows[0].cells].every((c) => c.tagName === 'TH')) rows = [table.rows[0]];
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
  const cellHeader = (e) => {
    const cell = closest(e, 'td,[role=cell],[role=gridcell]');
    const row = cell && closest(cell, 'tr,[role=row]');
    if (!row) return '';
    let head;
    if (cell.tagName === 'TD' && row.tagName === 'TR') {
      const table = row.closest('table');
      if (!table) return '';
      const columns = tableHeadings(table);
      const width = [...row.cells].reduce((n, c) => n + Math.max(1, c.colSpan || 1), 0);
      // antd adds a scrollbar column to a separate header table.
      if (columns.length < width || columns.length > width + 1) return '';
      let index = 0;
      for (const c of row.cells) { if (c === cell) break; index += Math.max(1, c.colSpan || 1); }
      head = columns[index];
    } else {
      const grid = closest(row, '[role=grid],[role=table],[role=treegrid]');
      if (!grid) return '';
      const cellsOf = (r) => [...r.querySelectorAll('[role=cell],[role=gridcell],[role=columnheader],[role=rowheader]')].filter((c) => closest(c, '[role=row]') === r);
      if (!headings.has(grid)) {
        const headRow = [...grid.querySelectorAll('[role=row]')].find((r) => r.querySelector('[role=columnheader]'));
        headings.set(grid, headRow ? cellsOf(headRow) : []);
      }
      const heads = headings.get(grid);
      const at = cell.getAttribute('aria-colindex');
      const cells = cellsOf(row);
      head = at ? heads.find((h) => h.getAttribute('aria-colindex') === at) : heads.length === cells.length ? heads[cells.indexOf(cell)] : undefined;
    }
    const words = head ? labelText(head) : '';
    return words.length <= 60 ? words : '';
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
  // control in between ends the search.
  const precedingLabel = (e) => {
    let cur = e;
    for (let depth = 0; depth < 8; depth++) {
      const box = parent(cur);
      if (!box || box === document.body || box === document.documentElement || fieldsIn(box) > 1) return '';
      for (let n = cur.previousSibling; n; n = n.previousSibling) {
        if (n.nodeType === Node.ELEMENT_NODE) {
          if (n.matches(FIELD) || n.querySelector(FIELD)) return '';
          const owner = n.matches('label') ? n : n.querySelector('label');
          if (owner?.control && owner.control !== e) return '';
          if (n.matches(UNLABEL)) continue;
          if (n.textContent.length > 300) return '';
        } else if (n.nodeType !== Node.TEXT_NODE) continue;
        const words = labelText(n);
        if (words) return words.length <= 60 && beside(n, cur) ? words : '';
      }
      cur = box;
    }
    return '';
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
    || (e.matches('button,[role=button],.cursor-pointer') ? iconName(e) || iconHint(e) : '') || placeholderName(e) || e.getAttribute('name'));
  const role = (e) => e.getAttribute('role') || ({ A: 'link', BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox', SUMMARY: 'button' })[e.tagName]
    || (e.tagName === 'INPUT' ? ({ checkbox: 'checkbox', radio: 'radio', search: 'searchbox', submit: 'button', reset: 'button', button: 'button', number: 'spinbutton' })[e.type] || 'textbox' : e.isContentEditable ? 'textbox'
      : e.hasAttribute('aria-selected') && !/^(TD|TH|TR)$/.test(e.tagName) ? 'option' : undefined);
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
    const ariaOff = ancestors(e).filter((p) => p.getAttribute('aria-disabled') === 'true');
    const descriptor = {
      ordinal: index, tag: e.tagName.toLowerCase(), role: role(e), type: e.getAttribute('type') || (e.tagName === 'INPUT' ? e.type : undefined),
      label, text: own, name: e.getAttribute('name') || '', placeholder: e.getAttribute('placeholder') || '',
      href: e.getAttribute('href') || undefined,
      // Where a link opens: two same-address links are one click only when both match.
      link_target: e.matches('a[href]') && e.getAttribute('target') || undefined,
      download: e.matches('a[href]') && e.hasAttribute('download') || undefined,
      value: 'value' in e ? String(e.value) : e.isContentEditable ? e.innerText : undefined,
      display: shown(e),
      // The table column a field sits in: such a field belongs to its row's
      // item (an invoice line), not to the document.
      column: e.matches(TYPABLE) && cellHeader(e) || undefined,
      // What text drawn over an unnamed field says it is for.
      hint: (!label || label === e.getAttribute('name')) && hintText(e) || undefined,
      checked: 'checked' in e ? e.checked : e.hasAttribute('aria-checked') ? e.getAttribute('aria-checked') === 'true' : undefined,
      selected: e.hasAttribute('aria-selected') ? e.getAttribute('aria-selected') === 'true' : undefined,
      expanded: e.hasAttribute('aria-expanded') ? e.getAttribute('aria-expanded') === 'true' : undefined,
      disabled: e.matches(':disabled') || ariaOff.some((p) => !dragOnly(p)),
      // Inside a drag-only one. Playwright's input checks still count it as
      // disabled; the driver checks such targets itself.
      drag_disabled: ariaOff.some(dragOnly) || undefined,
      readonly: e.readOnly === true || e.getAttribute('aria-readonly') === 'true', contenteditable: e.isContentEditable,
      invalid: e.getAttribute('aria-invalid') === 'true' || (e.willValidate && !e.validity.valid) || false,
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
const readDOMJson = new Function('elements', `const data = (${readDOM.toString()})(elements);
  try { if (JSON.stringify({ a: [1, 'x', true, null], b: { c: 2 } }) === '{"a":[1,"x",true,null],"b":{"c":2}}') return JSON.stringify(data); } catch {}
  return data;`);

export async function captureSnapshot(page, { pageId, sessionId, frameInfo, scope, maxElements = 2000 }) {
  const snapshotId = randomUUID();
  const refs = new Map();
  const frames = [];
  for (const frame of page.frames()) {
    if (frame !== page.mainFrame()) {
      const owner = await frame.frameElement().catch(() => null);
      try { if (!owner || !await owner.isVisible()) continue; } finally { await owner?.dispose(); }
    }
    const info = frameInfo(frame);
    const revision = info.revision;
    const query = scope ? frame.locator(scope).locator(INTERACTIVE) : frame.locator(INTERACTIVE + ',dialog[open],[role=dialog][aria-modal=true]');
    if (scope && !await frame.locator(scope).count()) continue;
    let data;
    try {
      const raw = await query.evaluateAll(readDOMJson);
      data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    }
    catch (error) { if (frame.isDetached()) continue; throw error; }
    if (info.revision !== revision) throw new Error('SNAPSHOT_CHANGED: document navigated during capture');
    const documentId = `${info.id}:${revision}:${data.documentKey}`;
    for (const e of data.elements) {
      const selector = `pw-ref:${snapshotId}:${info.id}:${e.ordinal}`;
      const target = { ...e, selector, snapshot_id: snapshotId, page_id: pageId, session_id: sessionId, frame_id: info.id, document_id: documentId, identity_version: 2 };
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
      frames: active.map((f) => ({ frame_id: f.info.id, document_id: f.documentId, url: f.data.url })),
      metrics: { element_count: elements.length, frame_count: active.length },
    },
  };
}
