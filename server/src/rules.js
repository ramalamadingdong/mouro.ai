// An evaluator for Firebase Realtime Database security rules.
//
// The games ship hardened `database.rules.json` files that encode who may write
// which room, that turnUid matches the writer, that version only increases, and
// so on. Rather than re-express all of that, the server evaluates those same
// files. Supported: .read / .write (cascading grants), .validate, $wildcards,
// auth, now, root, data, newData, and the snapshot methods the games use
// (val, exists, child, parent, hasChild, hasChildren, isString, isNumber,
// isBoolean) plus String#matches / #contains / #beginsWith.
//
// Rule expressions are trusted input — they come from this repository, never
// from a client — so compiling them with `new Function` is acceptable.

import { getAt, splitPath } from './tree.js';

for (const [name, fn] of Object.entries({
  matches(re) {
    return re.test(String(this));
  },
  contains(s) {
    return String(this).includes(s);
  },
  beginsWith(s) {
    return String(this).startsWith(s);
  },
  replace_(a, b) {
    return String(this).split(a).join(b);
  },
})) {
  if (!Object.prototype.hasOwnProperty.call(String.prototype, name)) {
    Object.defineProperty(String.prototype, name, { value: fn, enumerable: false });
  }
}

class RuleSnapshot {
  constructor(root, segs) {
    this._root = root;
    this._segs = segs;
  }
  _v() {
    return getAt(this._root, this._segs);
  }
  val() {
    const v = this._v();
    return v === undefined ? null : v;
  }
  exists() {
    return this._v() !== null;
  }
  child(path) {
    return new RuleSnapshot(this._root, [...this._segs, ...splitPath(path)]);
  }
  parent() {
    return new RuleSnapshot(this._root, this._segs.slice(0, -1));
  }
  hasChild(path) {
    return this.child(path).exists();
  }
  hasChildren(names) {
    const v = this._v();
    if (v === null || typeof v !== 'object') return false;
    if (!names) return Object.keys(v).length > 0;
    return names.every((n) => this.child(n).exists());
  }
  isString() {
    return typeof this._v() === 'string';
  }
  isNumber() {
    return typeof this._v() === 'number';
  }
  isBoolean() {
    return typeof this._v() === 'boolean';
  }
  getPriority() {
    return null;
  }
}

const compiled = new Map();
function compile(expr, varNames) {
  const key = varNames.join(',') + '|' + expr;
  let fn = compiled.get(key);
  if (!fn) {
    // eslint-disable-next-line no-new-func
    fn = new Function('auth', 'now', 'root', 'data', 'newData', ...varNames, `return (${expr});`);
    compiled.set(key, fn);
  }
  return fn;
}

export class Rules {
  /** @param {object} json the parsed rules file (with or without the top-level "rules" key) */
  constructor(json) {
    this.tree = json && json.rules ? json.rules : json;
  }

  _eval(expr, ctx, vars) {
    if (typeof expr === 'boolean') return expr;
    if (typeof expr !== 'string') return false;
    const names = Object.keys(vars);
    try {
      const fn = compile(expr, names);
      return fn(ctx.auth, ctx.now, ctx.rootSnap, ctx.dataSnap, ctx.newDataSnap, ...names.map((n) => vars[n])) === true;
    } catch {
      // An expression that throws (e.g. .length on null) evaluates to false,
      // as it does in Firebase.
      return false;
    }
  }

  /** Rule node for a key under `node`, plus the wildcard binding if any. */
  static _childRule(node, key) {
    if (!node || typeof node !== 'object') return null;
    if (Object.prototype.hasOwnProperty.call(node, key) && !key.startsWith('$') && !key.startsWith('.')) {
      return { node: node[key], bind: null };
    }
    const wild = Object.keys(node).find((k) => k.startsWith('$'));
    if (wild) return { node: node[wild], bind: wild };
    return null;
  }

  _cascade(kind, segs, auth, now, oldRoot, newRoot) {
    let node = this.tree;
    const vars = {};
    for (let depth = 0; depth <= segs.length; depth++) {
      if (node && typeof node === 'object' && kind in node) {
        const here = segs.slice(0, depth);
        const ctx = {
          auth,
          now,
          rootSnap: new RuleSnapshot(oldRoot, []),
          dataSnap: new RuleSnapshot(oldRoot, here),
          newDataSnap: new RuleSnapshot(newRoot, here),
        };
        if (this._eval(node[kind], ctx, { ...vars })) return true;
      }
      if (depth === segs.length) break;
      const next = Rules._childRule(node, segs[depth]);
      if (!next) return false;
      if (next.bind) vars[next.bind] = segs[depth];
      node = next.node;
    }
    return false;
  }

  canRead(path, auth, root, now = Date.now()) {
    return this._cascade('.read', splitPath(path), auth, now, root, root);
  }

  /**
   * True when `auth` may change the data at `path` so that the whole database
   * becomes `newRoot`. Checks the .write cascade, then every .validate rule at
   * and below `path` wherever the new data is non-null.
   */
  canWrite(path, auth, oldRoot, newRoot, now = Date.now()) {
    const segs = splitPath(path);
    if (!this._cascade('.write', segs, auth, now, oldRoot, newRoot)) return false;

    // Walk the rule tree down to `path`, collecting wildcard bindings.
    let node = this.tree;
    const vars = {};
    for (const s of segs) {
      const next = Rules._childRule(node, s);
      if (!next) return true; // no rules below here → nothing to validate
      if (next.bind) vars[next.bind] = s;
      node = next.node;
    }
    return this._validate(node, segs, vars, auth, now, oldRoot, newRoot);
  }

  _validate(node, segs, vars, auth, now, oldRoot, newRoot) {
    if (!node || typeof node !== 'object') return true;
    const newHere = getAt(newRoot, segs);
    if (newHere === null) return true; // deletes are never validated
    if ('.validate' in node) {
      const ctx = {
        auth,
        now,
        rootSnap: new RuleSnapshot(oldRoot, []),
        dataSnap: new RuleSnapshot(oldRoot, segs),
        newDataSnap: new RuleSnapshot(newRoot, segs),
      };
      if (!this._eval(node['.validate'], ctx, vars)) return false;
    }
    if (typeof newHere !== 'object') return true;
    for (const key of Object.keys(newHere)) {
      const next = Rules._childRule(node, key);
      if (!next) continue;
      const childVars = next.bind ? { ...vars, [next.bind]: key } : vars;
      if (!this._validate(next.node, [...segs, key], childVars, auth, now, oldRoot, newRoot)) return false;
    }
    return true;
  }
}
