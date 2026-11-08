/* Headless DOM smoke test for the VoxelSynth workspace. Zero dependencies. */
(function () {
  'use strict';
  var fs = require('node:fs');
  var vm = require('node:vm');
  var b64 = function (s) { return Buffer.from(s, 'binary').toString('base64'); };
  var unb64 = function (s) { return Buffer.from(s, 'base64').toString('binary'); };

  var html = fs.readFileSync(__dirname + '/index.html', 'utf8');
  var ids = [];
  var idRe = /id="([^"]+)"/g;
  var match;
  while ((match = idRe.exec(html)) !== null) ids.push(match[1]);

  var listeners = {};
  var store = {};
  function element(id) {
    return {
      id: id,
      value: store[id] === undefined ? '' : store[id],
      textContent: '',
      innerHTML: '',
      hidden: false,
      className: '',
      style: {},
      dataset: {},
      max: '',
      attributes: {},
      classList: { toggle: function () {}, add: function () {}, remove: function () {} },
      setAttribute: function (k, v) { this.attributes[k] = v; },
      getAttribute: function (k) { return this.attributes[k]; },
      addEventListener: function (type, fn) {
        var self = this;
        listeners[id + ':' + type] = function () { return fn.apply(self, arguments); };
      },
      appendChild: function () {},
      remove: function () {},
      click: function () { if (listeners[id + ':click']) listeners[id + ':click'](); },
      select: function () {},
      getBoundingClientRect: function () { return { left: 0, top: 0, width: 900, height: 620 }; },
      setPointerCapture: function () {},
      getContext: function () { return makeContext(); }
    };
  }

  function makeContext() {
    var noop = function () {};
    return new Proxy({
      clearRect: noop, beginPath: noop, moveTo: noop, lineTo: noop, closePath: noop,
      fill: noop, stroke: noop, fillText: noop, save: noop, restore: noop,
      fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, font: ''
    }, { get: function (t, k) { return k in t ? t[k] : noop; }, set: function (t, k, v) { t[k] = v; return true; } });
  }

  var elements = {};
  ids.forEach(function (id) { elements[id] = element(id); });

  var defaults = {
    'grid-nx': '24', 'grid-ny': '18', 'grid-nz': '12', 'grid-pitch': '2',
    'prim-x': '6', 'prim-y': '6', 'prim-z': '4', 'prim-w': '10', 'prim-d': '10',
    'prim-r': '8', 'prim-h': '8', 'shell-wall': '3', 'infill': '100',
    'yaw': '35', 'pitch': '28', 'slice': '0', 'material': 'PLA',
    'export-name': 'voxelsynth_model', 'preset-select': 'deskOrganizer'
  };
  Object.keys(defaults).forEach(function (id) {
    if (elements[id]) elements[id].value = defaults[id];
  });

  var docListeners = {};
  var sandbox = {
    console: console,
    btoa: b64,
    atob: unb64,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    URL: { createObjectURL: function () { return 'blob:test'; }, revokeObjectURL: function () {} },
    Blob: function () {},
    navigator: { clipboard: { writeText: function () { return { then: function (fn) { fn(); } }; } } },
    localStorage: {
      getItem: function (k) { return store[k] || null; },
      setItem: function (k, v) { store[k] = v; }
    },
    getComputedStyle: function () {
      return { getPropertyValue: function (name) { return name === '--line' ? '#d9e0ea' : '#4b8ff5'; } };
    },
    document: {
      documentElement: { setAttribute: function () {} },
      getElementById: function (id) { return elements[id] || null; },
      querySelectorAll: function (sel) {
        var attr = sel.replace(/[\[\]]/g, '');
        if (attr === 'data-op') {
          return ['add', 'subtract'].map(function (v) { var e = element('op-' + v); e.dataset.op = v; return e; });
        }
        if (attr === 'data-prim') {
          return ['box', 'cylinder', 'sphere'].map(function (v) {
            var e = element('prim-btn-' + v); e.dataset.prim = v;
            listeners[e.id + ':click'] = function () {};
            return e;
          });
        }
        if (attr === 'data-export' || attr === 'data-copy') {
          var kinds = attr === 'data-export'
            ? ['ascii-stl', 'binary-stl', 'obj', 'scad']
            : ['ascii-stl', 'obj', 'scad', 'json'];
          return kinds.map(function (v) {
            var e = element(attr + ':' + v);
            e.dataset[attr === 'data-export' ? 'export' : 'copy'] = v;
            return e;
          });
        }
        return [];
      },
      addEventListener: function (type, fn) { docListeners[type] = fn; },
      createElement: function () { return element('created'); },
      body: { appendChild: function () {} }
    }
  };
  sandbox.addEventListener = function (type, fn) { docListeners[type] = fn; };
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(__dirname + '/voxel.js', 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(__dirname + '/app.js', 'utf8'), sandbox);

  var diag = elements['diag-body'].innerHTML;
  if (!/Watertight/.test(diag)) throw new Error('diagnostics table was not populated');
  if (!/Yes/.test(diag)) throw new Error('initial preset is not watertight');
  if (!/VoxelSynth/.test(fs.readFileSync(__dirname + '/index.html', 'utf8'))) {
    throw new Error('title missing');
  }

  ['load-preset', 'reset-grid', 'apply-grid', 'apply-primitive', 'mirror-x',
   'mirror-y', 'apply-shell', 'theme-toggle', 'help-toggle', 'view-top',
   'view-front', 'view-iso', 'toggle-wire', 'toggle-slice', 'cycle-slice-mode'].forEach(function (id) {
    if (!listeners[id + ':click']) throw new Error('missing click handler for ' + id);
  });
  ['yaw', 'pitch', 'slice'].forEach(function (id) {
    if (!listeners[id + ':input']) throw new Error('missing input handler for ' + id);
  });

  elements['preset-select'].value = 'rpiPicoMount';
  listeners['preset-select:change'].call(elements['preset-select']);
  if (!/Z layer 1 \/ 12/.test(elements['slice-chip'].textContent)) {
    throw new Error('slice chip did not update');
  }

  listeners['mirror-x:click']();
  listeners['apply-shell:click']();
  listeners['theme-toggle:click']();
  listeners['toggle-wire:click']();
  listeners['cycle-slice-mode:click']();
  listeners['cycle-slice-mode:click']();
  listeners['view-top:click']();
  listeners['view-iso:click']();
  listeners['help-toggle:click']();
  listeners['apply-primitive:click']();
  listeners['infill:input']();
  listeners['material:change']();

  if (!docListeners.keydown) throw new Error('keyboard handler missing');
  ['1', '2', '3', '4', 'b', 'c', 's', 'a', 'd', 'm', 'h', 't', 'r', '?',
   'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].forEach(function (key) {
    docListeners.keydown({ key: key, target: { tagName: 'BODY' }, preventDefault: function () {} });
  });

  elements['export-name'].value = 'smoke_model';
  var exports = { 'data-export': ['ascii-stl', 'binary-stl', 'obj', 'scad'],
                  'data-copy': ['ascii-stl', 'obj', 'scad', 'json'] };
  Object.keys(exports).forEach(function (attr) {
    exports[attr].forEach(function (kind) {
      var key = attr + ':' + kind + ':click';
      if (!listeners[key]) throw new Error('no handler registered for ' + key);
      listeners[key]();
    });
  });
  if (!/copied to clipboard/.test(elements.toast.textContent) && !/downloaded/.test(elements.toast.textContent)) {
    throw new Error('export actions did not report status');
  }

  console.log('UI smoke test passed. Diagnostics populated, all controls bound, keyboard and presets exercised.');
})();
