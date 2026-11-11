(function (root) {
  'use strict';
  var clone = function (v) { return JSON.parse(JSON.stringify(v)); };
  var equal = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
  function fields(state) {
    var values = {};
    Object.keys(state.lessons).forEach(function (id) {
      var l = state.lessons[id];
      values[id + '|memo'] = l.memo || '';
      values[id + '|done'] = !!l.done;
      Object.keys(l.checks || {}).forEach(function (key) { values[id + '|check|' + key] = !!l.checks[key]; });
      (l.days || []).forEach(function (day) { values[id + '|day|' + day] = true; });
    });
    return values;
  }
  function value(state, key) {
    var p = key.split('|'), l = state.lessons[p[0]] || {};
    if (p[1] === 'memo') return l.memo || '';
    if (p[1] === 'done') return !!l.done;
    if (p[1] === 'check') return !!(l.checks && l.checks[p[2]]);
    return !!(l.days && l.days.indexOf(p[2]) !== -1);
  }
  function put(state, key, next) {
    if (typeof key !== 'string' || !/^[lo]\d{2}\|(memo|done|check\|[A-Za-z0-9_-]+|day\|\d{4}-\d{2}-\d{2})$/.test(key)) throw new Error('Invalid sync field');
    var p = key.split('|');
    var l = state.lessons[p[0]] || (state.lessons[p[0]] = { checks: {}, memo: '', done: false });
    if (p[1] === 'memo' || p[1] === 'done') l[p[1]] = next;
    else if (p[1] === 'check') { l.checks = l.checks || {}; l.checks[p[2]] = next; }
    else {
      l.days = (l.days || []).filter(function (day) { return day !== p[2]; });
      if (next) l.days.push(p[2]);
      l.days.sort();
    }
  }
  function diff(before, after) {
    var a = fields(before), b = fields(after);
    return Array.from(new Set(Object.keys(a).concat(Object.keys(b)))).map(function (key) {
      return { key: key, before: value(before, key), after: value(after, key) };
    }).filter(function (op) { return !equal(op.before, op.after); });
  }
  function queue(pending, changes) {
    var result = clone(pending);
    changes.forEach(function (op) {
      var found = result.find(function (v) { return v.key === op.key; });
      if (found) found.after = op.after;
      else result.push(clone(op));
    });
    return result.filter(function (op) { return !equal(op.before, op.after); });
  }
  function overlay(remote, pending) {
    var result = clone(remote);
    pending.forEach(function (op) { put(result, op.key, op.after); });
    return result;
  }
  function reconcile(remote, pending) {
    var result = clone(remote), accepted = [], conflicts = [];
    pending.forEach(function (op) {
      var current = value(remote, op.key);
      if (equal(current, op.before) || equal(current, op.after)) {
        put(result, op.key, op.after);
        accepted.push(op);
      } else conflicts.push({ key: op.key, before: op.before, after: op.after, remote: current });
    });
    return { state: result, accepted: accepted, conflicts: conflicts };
  }
  root.StudySyncState = { diff: diff, queue: queue, overlay: overlay, reconcile: reconcile, value: value, equal: equal };
})(typeof window !== 'undefined' ? window : globalThis);
