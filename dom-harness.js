'use strict';
const fs = require('node:fs');
const vm = require('node:vm');

/* A strict browser contract for the local page. Nodes and selector groups are
 * built from index.html; unsupported canvas calls and missing nodes fail. */
function createWorkspace(options = {}) {
  const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
  const nodes = [], ids = new Map(), windowEvents = new Map(), documentEvents = new Map();
  const timers = new Map(), urls = new Map(), downloads = [], copies = [], errors = [], drawCalls = [];
  const storage = { ...(options.storage || {}) };
  let nextTimer = 0, nextUrl = 0, document;
  const bounds = { left: 0, top: 0, width: options.width || 900, height: options.height || 620 };
  const context = {};
  for (const method of ['setTransform', 'clearRect', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke', 'fillRect', 'strokeRect', 'save', 'restore']) {
    context[method] = (...values) => {
      if (!values.every(Number.isFinite)) { errors.push('nonfinite canvas arguments: ' + method); throw new Error('nonfinite canvas coordinates'); }
      drawCalls.push({ method, values });
    };
  }
  context.fillText = (text, x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('nonfinite canvas text coordinates');
    drawCalls.push({ method: 'fillText', values: [String(text), x, y] });
  };
  class Element {
    constructor(tag, attrs = {}) {
      this.tagName = tag.toUpperCase(); this.attrs = { ...attrs }; this.dataset = {};
      this.id = attrs.id || ''; this.children = []; this.listeners = new Map(); this.style = {};
      this.hidden = 'hidden' in attrs; this.disabled = 'disabled' in attrs;
      this._text = ''; this._value = attrs.value || ''; this._class = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
      this._captures = new Set(); this.clickCount = 0;
      for (const [name, value] of Object.entries(attrs)) if (name.startsWith('data-')) {
        this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
      }
      this.classList = {
        toggle: (name, force) => { const active = force === undefined ? !this._class.has(name) : !!force; active ? this._class.add(name) : this._class.delete(name); return active; },
        add: (...names) => names.forEach(name => this._class.add(name)),
        remove: (...names) => names.forEach(name => this._class.delete(name)),
        contains: name => this._class.has(name)
      };
      this.width = Number(attrs.width || 0); this.height = Number(attrs.height || 0);
    }
    get value() { return this._value; }
    set value(value) {
      value = String(value);
      if (this.attrs.type === 'range') {
        const low = Number(this.min || 0), high = Number(this.max || 100);
        value = String(Math.max(low, Math.min(high, Number.isFinite(Number(value)) ? Number(value) : (low + high) / 2)));
      }
      if (this.attrs.type === 'number' && value && !Number.isFinite(Number(value))) value = '';
      this._value = value;
    }
    get min() { return this.attrs.min || ''; }
    set min(value) { this.attrs.min = String(value); }
    get max() { return this.attrs.max || ''; }
    set max(value) { this.attrs.max = String(value); }
    get className() { return [...this._class].join(' '); }
    set className(value) { this._class = new Set(String(value).split(/\s+/).filter(Boolean)); }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this._text = String(value); this.children = []; }
    set innerHTML(_) { throw new Error('Use text nodes in dynamic diagnostics'); }
    get innerHTML() { return this.children.map(child => '<' + child.tagName.toLowerCase() + '>' + child.textContent + '</' + child.tagName.toLowerCase() + '>').join(''); }
    setAttribute(name, value) { this.attrs[name] = String(value); if (name === 'class') this.className = value; }
    getAttribute(name) { return name === 'class' ? this.className : this.attrs[name] === undefined ? null : this.attrs[name]; }
    addEventListener(type, handler, options) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push({ handler, options }); }
    appendChild(child) { child.parent = this; this.children.push(child); return child; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    focus() { document.activeElement = this; }
    select() { document.activeElement = this; }
    getBoundingClientRect() { return { ...bounds }; }
    getContext(type) { if (this.tagName !== 'CANVAS' || type !== '2d') throw new Error('unsupported drawing context'); return context; }
    setPointerCapture(id) { this._captures.add(id); }
    hasPointerCapture(id) { return this._captures.has(id); }
    releasePointerCapture(id) { this._captures.delete(id); }
    dispatch(type, event = {}) {
      const value = { target: this, currentTarget: this, preventDefault() { this.defaultPrevented = true; }, ...event };
      const results = (this.listeners.get(type) || []).map(({ handler }) => handler.call(this, value));
      return results.length === 1 ? results[0] : Promise.all(results);
    }
    click() {
      if (this.disabled) return;
      this.clickCount++;
      if (this.tagName === 'A' && this.download) downloads.push({ filename: this.download, blob: urls.get(this.href), url: this.href });
      return this.dispatch('click');
    }
  }
  const tagRe = /<(\/?)([A-Za-z][A-Za-z0-9]*)([^>]*)>/g;
  let match, currentSelect;
  while ((match = tagRe.exec(html))) {
    if (match[1]) { if (match[2].toLowerCase() === 'select') currentSelect = null; continue; }
    const attrs = {}, attrRe = /([A-Za-z_:][A-Za-z0-9_:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let attribute;
    while ((attribute = attrRe.exec(match[3]))) attrs[attribute[1]] = attribute[2] ?? attribute[3] ?? attribute[4] ?? '';
    const node = new Element(match[2], attrs); nodes.push(node);
    if (node.id) { if (ids.has(node.id)) throw new Error('duplicate id ' + node.id); ids.set(node.id, node); }
    if (node.tagName === 'SELECT') currentSelect = node;
    if (node.tagName === 'OPTION' && currentSelect && (!currentSelect.value || 'selected' in attrs)) currentSelect.value = attrs.value || '';
  }
  const body = nodes.find(node => node.tagName === 'BODY'), root = nodes.find(node => node.tagName === 'HTML');
  function matches(node, selector) {
    selector = selector.trim();
    const attribute = /^\[([^\]=]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (attribute) return attribute[1] in node.attrs && (attribute[2] === undefined || node.attrs[attribute[1]] === attribute[2]);
    if (selector[0] === '#') return node.id === selector.slice(1);
    if (selector[0] === '.') return node.classList.contains(selector.slice(1));
    return node.tagName.toLowerCase() === selector;
  }
  document = {
    documentElement: root, body, activeElement: body,
    getElementById: id => ids.get(id) || null,
    querySelectorAll: selector => nodes.filter(node => selector.split(',').some(part => matches(node, part))),
    createElement: tag => new Element(tag),
    createElementNS: (ns, tag) => new Element(tag),
    addEventListener: (type, handler) => documentEvents.set(type, handler),
    execCommand: command => command === 'copy' && options.legacyCopy !== false
  };
  const sandbox = {
    document, console: { log() {}, warn(...args) { errors.push(args.join(' ')); }, error(...args) { errors.push(args.join(' ')); } },
    Blob, btoa: text => Buffer.from(text, 'binary').toString('base64'), atob: text => Buffer.from(text, 'base64').toString('binary'),
    URL: { createObjectURL: blob => { const url = 'blob:voxelsynth-' + ++nextUrl; urls.set(url, blob); return url; }, revokeObjectURL: url => urls.delete(url) },
    navigator: { clipboard: options.clipboard === false ? undefined : { writeText: text => { copies.push(text); return options.clipboardRejects ? Promise.reject(new Error('denied')) : Promise.resolve(); } } },
    localStorage: {
      getItem: key => { if (options.blockStorage) throw new Error('blocked storage'); return storage[key] || null; },
      setItem: (key, value) => { if (options.blockStorage) throw new Error('blocked storage'); storage[key] = String(value); }
    },
    getComputedStyle: () => ({ getPropertyValue: name => ({ '--line': '#dcded6', '--line-strong': '#9ba89b', '--panel': '#ffffff', '--ink': '#20252a', '--ink-soft': '#59616a', '--voxel-a': '#849cb0', '--slice': '#ad400b' }[name] || '') }),
    setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; }, clearTimeout: id => timers.delete(id),
    setInterval: callback => { const id = ++nextTimer; timers.set(id, { callback, delay: 0, interval: true }); return id; }, clearInterval: id => timers.delete(id),
    addEventListener: (type, handler) => windowEvents.set(type, handler),
    location: options.location === undefined ? { href: 'https://aariv.me/voxelsynth/', hash: '' } : options.location,
    innerWidth: options.innerWidth === undefined ? 1024 : options.innerWidth,
    devicePixelRatio: options.dpr || 1,
    ResizeObserver: class { constructor(callback) { this.callback = callback; } observe(node) { if (node.tagName !== 'CANVAS') throw new Error('unexpected observed node'); } }
  };
  sandbox.window = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox);
  const scripts = options.scripts || ['voxel.js', 'mfg-lab.js', 'app.js'];
  for (const filename of scripts) vm.runInContext(fs.readFileSync(__dirname + '/' + filename, 'utf8'), sandbox, { filename, timeout: 10000 });
  return {
    window: sandbox, document, context, ids, nodes, downloads, copies, errors, drawCalls, storage, timers, urls,
    studio: sandbox.VoxelSynthStudio,
    get: id => { const node = ids.get(id); if (!node) throw new Error('missing node ' + id); return node; },
    group: (attribute, value) => { const node = nodes.find(node => node.attrs[attribute] === value); if (!node) throw new Error('missing selector ' + attribute + '=' + value); return node; },
    key: (key, extra = {}) => documentEvents.get('keydown')({ key, target: document.activeElement, preventDefault() { this.defaultPrevented = true; }, ...extra }),
    resize: (width, height, dpr) => { bounds.width = width; bounds.height = height; sandbox.devicePixelRatio = dpr; windowEvents.get('resize')(); },
    runTimers: () => { const pending = [...timers.values()].filter(timer => !timer.interval); timers.clear(); pending.forEach(timer => timer.callback()); }
  };
}
module.exports = { createWorkspace };
