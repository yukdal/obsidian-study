(function () {
  'use strict';
  var core = window.StudySyncState, hooks, sdk, auth, db, user = null, unsubscribe, timer;
  var pending = [], conflicts = [], remote = { last: null, lessons: {} };
  var generation = 0, ready = false, running = null, status = '', panel, queueError = false;
  var queueKey = function (uid) { return 'chageun-sync-queue-v1:' + uid; };
  var empty = function () { return { last: null, lessons: {} }; };
  var hasConfig = function () {
    var c = window.FIREBASE_CONFIG;
    return c && ['apiKey', 'authDomain', 'projectId', 'appId'].every(function (k) { return typeof c[k] === 'string' && c[k].length; });
  };
  function node(tag, text, parent) {
    var e = document.createElement(tag);
    if (text) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function button(text, action, parent) {
    var b = node('button', text, parent); b.type = 'button'; b.addEventListener('click', action); return b;
  }
  function remember() {
    if (!user) return true;
    try { localStorage.setItem(queueKey(user.uid), JSON.stringify(pending)); queueError = false; return true; }
    catch (e) { queueError = true; return false; }
  }
  function display() {
    if (!panel) return;
    panel.replaceChildren();
    var details = node('details', '', panel);
    details.open = !!conflicts.length;
    var label = user ? (user.displayName || user.email || '로그인됨') + ' · ' +
      (conflicts.length ? '충돌 확인 필요' : pending.length ? '전송 대기 ' + pending.length + '건' : ready ? '동기화 완료' : '연결 확인 중') : hasConfig() ? '로그인 전' : '연결 설정 전';
    node('summary', '기기 간 동기화 · ' + label, details);
    var message = node('p', status + (queueError ? ' 전송 대기 기록을 저장하지 못했습니다. JSON 백업을 받아 주세요.' : ''), details); message.setAttribute('role', 'status');
    var row = node('div', '', details); row.className = 'btn-row';
    if (!hasConfig()) return;
    if (user) {
      button('지금 동기화', function () { if (!ready) onAuth(user); else flush(); }, row);
      button('로그아웃', async function () {
        try { await sdk.signOut(auth); } catch (e) { status = '로그아웃하지 못했습니다. 다시 시도해 주세요.'; display(); }
      }, row);
      button('로그인 전 기록 가져오기', importGuest, row);
    } else if (sdk) button('구글로 로그인', login, row);
    conflicts.forEach(function (conflict) {
      var box = node('section', '', details);
      var parts = conflict.key.split('|'), lesson = window.COURSE.lessons.find(function (l) { return l.id === parts[0]; });
      node('h3', (lesson ? lesson.title : parts[0]) + ' · ' + (parts[1] === 'memo' ? '메모' : '실습 기록') + ' 충돌', box);
      node('p', '이 기기: ' + String(conflict.after), box);
      node('p', '다른 기기: ' + String(conflict.remote), box);
      var choices = node('div', '', box); choices.className = 'btn-row';
      button('이 기기 내용 사용', function () { resolve(conflict, true); }, choices);
      button('다른 기기 내용 사용', function () { resolve(conflict, false); }, choices);
    });
  }
  function show() {
    var next = core.overlay(remote, pending);
    hooks.apply(next);
  }
  function resolve(conflict, local) {
    var op = pending.find(function (o) { return o.key === conflict.key; });
    if (op && !local) pending = pending.filter(function (o) { return o !== op; });
    else if (op) op.before = core.value(remote, op.key);
    conflicts = conflicts.filter(function (c) { return c.key !== conflict.key; });
    remember(); show(); schedule();
  }
  function schedule() {
    clearTimeout(timer);
    if (!user) return;
    status = conflicts.length ? '같은 기록이 다르게 수정됐습니다. 아래 두 내용을 확인해 주세요.' :
      pending.length ? '변경 내용을 전송 대기 중입니다.' : ready ? '동기화 완료' : '계정 기록을 확인하고 있습니다.';
    display();
    if (pending.length && !conflicts.length) timer = setTimeout(flush, 1200);
  }
  function changed(before, after) {
    if (!user) return;
    pending = core.queue(pending, core.diff(before, after));
    conflicts = [];
    remember(); schedule();
  }
  function importGuest() {
    if (!user || !ready) { status = '계정 기록을 먼저 불러온 뒤 다시 선택해 주세요.'; display(); return; }
    try {
      var raw = localStorage.getItem('chageun-obsidian-v1');
      if (!raw) { status = '가져올 로그인 전 기록이 없습니다.'; display(); return; }
      var guest = hooks.parse(raw);
      var changes = core.diff(empty(), guest).filter(function (op) { return !!op.after; });
      pending = core.queue(pending, changes);
      remember(); show(); schedule();
      // Existing cloud memos are compared against the empty guest base before writing.
    } catch (e) { status = '로그인 전 기록을 읽지 못했습니다. 원래 JSON 백업을 확인해 주세요.'; display(); }
  }
  async function flush() {
    if (running) return running;
    if (!user || !ready || !pending.length) return;
    if (!navigator.onLine) { status = '인터넷 연결을 기다리고 있습니다. 이 기기에 기록을 보관합니다.'; display(); return; }
    var epoch = generation, uid = user.uid, batch = JSON.parse(JSON.stringify(pending));
    status = '동기화 중입니다.'; display();
    running = (async function () {
      try {
        var doc = sdk.doc(db, 'users', uid, 'apps', 'obsidian-study');
        var result = await sdk.runTransaction(db, async function (transaction) {
          if (epoch !== generation) throw new Error('account-changed');
          var snap = await transaction.get(doc);
          var cloud = decode(snap);
          var plan = core.reconcile(cloud, batch);
          plan.state.last = null;
          var serialized = JSON.stringify(plan.state);
          if (serialized.length > 500000 || new Blob([serialized]).size > 700000) throw new Error('record-too-large');
          if (epoch !== generation) throw new Error('account-changed');
          if (plan.accepted.length) transaction.set(doc, { version: 1, state: serialized, updatedAt: sdk.serverTimestamp() });
          return plan;
        });
        if (epoch !== generation) return;
        result.accepted.forEach(function (sent) {
          var current = pending.find(function (op) { return op.key === sent.key; });
          if (!current) return;
          if (core.equal(current.after, sent.after)) pending = pending.filter(function (op) { return op !== current; });
          else current.before = sent.after;
        });
        remote = result.state;
        conflicts = result.conflicts.filter(function (c) { return pending.some(function (p) { return p.key === c.key; }); });
        remember(); show(); schedule();
      } catch (e) {
        if (epoch !== generation) return;
        status = e.message === 'record-too-large' ? '기록이 커서 전송하지 못했습니다. JSON 백업을 보관해 주세요.' :
          '동기화하지 못했습니다. 이 기기 기록은 유지됩니다. 연결을 확인하고 지금 동기화를 눌러 주세요.';
        display();
      } finally { if (epoch === generation) running = null; }
    })();
    return running;
  }
  function decode(snap) {
    if (!snap.exists()) return empty();
    var data = snap.data();
    if (data.version !== 1 || typeof data.state !== 'string') throw new Error('invalid-cloud-state');
    return hooks.parse(data.state);
  }
  async function login() {
    try { await sdk.signInWithPopup(auth, new sdk.GoogleAuthProvider()); }
    catch (e) {
      status = e.code === 'auth/popup-blocked' ? '팝업이 차단됐습니다. 브라우저에서 팝업을 허용한 뒤 다시 로그인해 주세요.' : '로그인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
      display();
    }
  }
  function onAuth(nextUser) {
    generation++; clearTimeout(timer); if (unsubscribe) unsubscribe();
    user = nextUser; ready = false; running = null; pending = []; conflicts = []; remote = empty();
    hooks.switchAccount(user ? user.uid : null);
    if (!user) { status = '이 브라우저에 저장합니다. 같은 구글 계정으로 로그인하면 기기 간 동기화됩니다.'; display(); return; }
    try {
      var cached = JSON.parse(localStorage.getItem(queueKey(user.uid)) || '[]');
      if (!Array.isArray(cached)) throw new Error('bad-queue');
      cached.forEach(function (op) {
        if (!op || typeof op.key !== 'string') throw new Error('bad-queue');
        var p = op.key.split('|'), l = window.COURSE.lessons.find(function (lesson) { return lesson.id === p[0]; });
        if (!l || !['memo','done','check','day'].includes(p[1])) throw new Error('bad-queue');
        if (p[1] === 'check' && !(l.checklist || []).some(function (c) { return c.id === p[2]; })) throw new Error('bad-queue');
        if (p[1] === 'day' && !l.daily) throw new Error('bad-queue');
        var type = p[1] === 'memo' ? 'string' : 'boolean';
        if (typeof op.before !== type || typeof op.after !== type) throw new Error('bad-queue');
        hooks.parse(JSON.stringify(core.overlay(empty(), [op])));
      });
      pending = core.queue([], cached);
    } catch (e) {
      status = '전송 대기 기록을 읽지 못했습니다. 계정 기록의 JSON 백업을 먼저 보관해 주세요.'; display(); return;
    }
    var epoch = generation;
    status = '계정 기록을 불러오고 있습니다. 로그인 전 기록은 따로 보관됩니다.'; display();
    unsubscribe = sdk.onSnapshot(sdk.doc(db, 'users', user.uid, 'apps', 'obsidian-study'), { includeMetadataChanges: true }, function (snap) {
      if (epoch !== generation || snap.metadata.hasPendingWrites) return;
      try {
        if (snap.metadata.fromCache) { status = '연결을 확인하고 있습니다. 새 기록은 이 기기에 보관합니다.'; display(); return; }
        remote = decode(snap);
        ready = true; show(); schedule();
      } catch (e) { ready = false; status = '클라우드 기록 형식을 확인하지 못했습니다. 덮어쓰지 않았습니다.'; display(); }
    }, function () { ready = false; status = '계정 기록을 읽지 못했습니다. 연결과 접근 설정을 확인해 주세요.'; display(); });
  }
  async function start(options) {
    hooks = options; panel = document.getElementById('sync-panel');
    status = '자동 동기화 연결 설정이 아직 완료되지 않았습니다. 지금은 이 브라우저에 저장합니다.';
    if (!hasConfig()) { display(); return; }
    if (location.protocol === 'file:') { status = '기기 간 동기화는 배포된 웹 주소에서 사용할 수 있습니다.'; display(); return; }
    status = '로그인 기능을 준비하고 있습니다.'; display();
    try {
      var base = 'https://www.gstatic.com/firebasejs/13.2.0/';
      var modules = await Promise.all(['app','auth','firestore'].map(function (name) { return import(base + 'firebase-' + name + '.js'); }));
      sdk = Object.assign({}, modules[0], modules[1], modules[2]);
      var app = sdk.initializeApp(window.FIREBASE_CONFIG);
      auth = sdk.getAuth(app); db = sdk.getFirestore(app);
      sdk.onAuthStateChanged(auth, onAuth);
      window.addEventListener('online', function () { if (ready) flush(); });
      window.addEventListener('beforeunload', function (event) { if (pending.length) { remember(); event.preventDefault(); event.returnValue = ''; } });
    } catch (e) { status = '로그인 기능을 불러오지 못했습니다. 이 브라우저 저장은 계속 사용할 수 있습니다.'; display(); }
  }
  window.StudySync = { start: start, changed: changed };
})();
