(function () {
  "use strict";
  var STORAGE_KEY = "chageun-obsidian-v1";
  var COURSE = window.COURSE;

  // ponytail: localStorage only; swap to Firestore when Firebase project exists
  function save(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      storageNotice('');
      return true;
    } catch (e) {
      storageNotice('기록을 브라우저에 저장하지 못했습니다. 내 기록에서 JSON 백업을 받아 보관하세요.');
      return false;
    }
  }

  function storageNotice(message) {
    var notice = document.getElementById('storage-notice');
    if (notice) notice.textContent = message;
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { last: null, lessons: {} };
      return parseBackup(raw);
    } catch (e) {
      return { last: null, lessons: {} };
    }
  }

  var state = load();

  function getLessonState(id) {
    return state.lessons[id] || { checks: {}, memo: "", done: false };
  }

  function setLessonState(id, patch) {
    var cur = getLessonState(id);
    state.lessons[id] = Object.assign({}, cur, patch);
    save(state);
  }

  function lessonStatus(id) {
    var ls = state.lessons[id];
    if (!ls) return "미시작";
    if (ls.done) return "완료";
    var hasCheck = ls.checks && Object.keys(ls.checks).some(function (k) { return !!ls.checks[k]; });
    var hasMemo = ls.memo && ls.memo.trim().length > 0;
    var hasDay = ls.days && ls.days.length > 0;
    return hasCheck || hasMemo || hasDay ? "진행 중" : "미시작";
  }

  // 오늘 날짜(이 기기의 현지 시각)를 YYYY-MM-DD 로.
  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }

  // 같은 날짜는 한 번만 들어간다. 이미 있으면 그대로 돌려준다.
  function addDay(days, day) {
    return days.indexOf(day) === -1 ? days.concat(day).sort() : days;
  }

  function completedCount(optional) {
    return COURSE.lessons.filter(function (l) {
      return !!l.optional === !!optional && state.lessons[l.id] && state.lessons[l.id].done;
    }).length;
  }

  function findLesson(id) {
    return COURSE.lessons.find(function (l) { return l.id === id; });
  }
  function lessonIndex(id) {
    return COURSE.lessons.findIndex(function (l) { return l.id === id; });
  }

  // --- DOM helpers ---
  function el(tag, props, children) {
    var e = document.createElement(tag);
    if (props) {
      for (var k in props) {
        if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
        var v = props[k];
        if (k === "class") e.className = v;
        else if (k === "text") e.textContent = v;
        else if (k.indexOf("on") === 0 && typeof v === "function") e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v);
      }
    }
    (children || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // --- 홈 ---
  function renderHome(root) {
    root.appendChild(el("h1", { text: COURSE.title }));
    root.appendChild(el("p", { class: "note", text: "진도와 메모는 이 브라우저에 저장됩니다. 다른 기기로 옮길 때는 내 기록의 JSON 백업·복원을 사용하세요." }));

    var hasRecord = !!(state.last && findLesson(state.last));
    var startId = hasRecord ? state.last : COURSE.lessons[0].id;
    root.appendChild(el("a", {
      class: "cta-button",
      href: "#/lesson/" + startId,
      text: hasRecord ? "이어서 하기" : "첫 수업 시작하기"
    }));

    if (hasRecord) {
      var lesson = findLesson(state.last);
      root.appendChild(el("p", { text: "마지막으로 연 수업: " + lesson.no + ". " + lesson.title }));
    }

    var done = completedCount();
    var total = COURSE.lessons.filter(function (l) { return !l.optional; }).length;
    var wrap = el("div", { class: "progress-wrap" });
    wrap.appendChild(el("p", { text: "기본 과정 진도: " + done + "/" + total }));
    wrap.appendChild(el("progress", { max: total, value: done }));
    root.appendChild(wrap);
    var optionalTotal = COURSE.lessons.filter(function (l) { return l.optional; }).length;
    if (optionalTotal) root.appendChild(el('p', { class: 'note', text: '선택 과정: ' + completedCount(true) + '/' + optionalTotal + '개 완료 · 기본 과정 진도에는 포함하지 않습니다.' }));

    // 여러 날 걸리는 기록은 다른 수업과 병행하므로 홈에서 따로 보여 준다.
    COURSE.lessons.forEach(function (l) {
      var days = (state.lessons[l.id] && state.lessons[l.id].days) || [];
      if (!l.daily || !days.length || days.length >= l.daily) return;
      root.appendChild(el("p", {}, [
        el("a", { class: "link", href: "#/lesson/" + l.id, text: "데일리 노트 기록 " + days.length + "/" + l.daily + "일" }),
        document.createTextNode(days.indexOf(today()) === -1 ? " — 오늘은 아직 기록하지 않았어요." : " — 오늘 기록함.")
      ]));
    });

    root.appendChild(el("a", { class: "link", href: "#/map", text: "학습 지도 보기" }));
  }

  // --- 학습 지도 ---
  function renderMap(root) {
    root.appendChild(el("h1", { text: "학습 지도" }));
    COURSE.stages.forEach(function (stage) {
      var section = el("section", { class: "stage" });
      section.appendChild(el("h2", { text: stage.optional ? stage.title : stage.id + "단계. " + stage.title }));
      section.appendChild(el("p", { class: "stage-done", text: "목표: " + stage.done }));
      var list = el("ul", { class: "lesson-list" });
      COURSE.lessons
        .filter(function (l) { return l.stage === stage.id; })
        .sort(function (a, b) { return a.no - b.no; })
        .forEach(function (lesson) {
          var li = el("li");
          if (!lesson.ready) {
            li.appendChild(el("span", { text: lesson.no + ". " + lesson.title }));
            li.appendChild(el("span", { class: "status", text: "준비 중" }));
          } else {
            li.appendChild(el("a", { href: "#/lesson/" + lesson.id, text: lesson.no + ". " + lesson.title }));
            li.appendChild(el("span", { class: "status", text: lessonStatus(lesson.id) }));
          }
          list.appendChild(li);
        });
      section.appendChild(list);
      root.appendChild(section);
    });
    root.appendChild(el("a", { class: "link", href: "#/", text: "홈으로" }));
  }

  // --- 수업 화면: 섹션 빌더 ---
  function sectionGoal(lesson) {
    var s = el("section");
    s.appendChild(el("h2", { text: "오늘 할 수 있게 되는 것" }));
    s.appendChild(el("p", { text: lesson.goal }));
    return s;
  }

  function sectionConcept(lesson) {
    var s = el("section");
    s.appendChild(el("h2", { text: "쉬운 개념 설명" }));
    (lesson.concept || []).forEach(function (p) { s.appendChild(el("p", { text: p })); });
    if (lesson.terms && lesson.terms.length) {
      var dl = el("dl", { class: "terms" });
      lesson.terms.forEach(function (t) {
        dl.appendChild(el("dt", { text: t.term }));
        dl.appendChild(el("dd", { text: t.desc }));
      });
      s.appendChild(dl);
      s.appendChild(el('a', { class: 'link', href: '#/glossary', text: '용어집에서 모두 보기' }));
    }
    return s;
  }

  function sectionVideo(lesson) {
    var v = lesson.video;
    var s = el("section");
    s.appendChild(el("h2", { text: "참고 영상" }));
    s.appendChild(el("iframe", {
      class: "video-frame",
      src: "https://www.youtube-nocookie.com/embed/" + v.youtubeId,
      title: v.title,
      loading: "lazy",
      allowfullscreen: "true"
    }));
    s.appendChild(el("a", {
      class: "link",
      href: "https://www.youtube.com/watch?v=" + v.youtubeId,
      target: "_blank",
      rel: "noopener",
      text: "유튜브에서 새 창으로 보기"
    }));
    if (v.note) s.appendChild(el("p", { class: "note", text: v.note }));
    return s;
  }

  function sectionSteps(lesson) {
    var s = el("section");
    s.appendChild(el("h2", { text: "단계별 따라 하기" }));
    s.appendChild(el("p", { class: "note", text: "여기부터는 옵시디언에서 직접 합니다." }));
    var ol = el("ol", { class: "steps" });
    lesson.steps.forEach(function (step) {
      var li = el("li");
      li.appendChild(el("strong", { text: step.title }));
      li.appendChild(el("p", { text: step.detail }));
      ol.appendChild(li);
    });
    s.appendChild(ol);
    return s;
  }

  function sectionExample(lesson) {
    var ex = lesson.example;
    var s = el("section");
    s.appendChild(el("h2", { text: "복사해서 쓰는 예시" }));
    if (ex.title) s.appendChild(el("p", { text: ex.title }));
    var pre = el("pre", { class: "example-body" });
    pre.textContent = ex.body;
    s.appendChild(pre);

    var msg = el("span", { class: "copy-msg", role: "status" });
    var btnRow = el("div", { class: "btn-row" });
    btnRow.appendChild(el("button", {
      type: "button",
      text: "복사",
      onclick: function () {
        if (!navigator.clipboard) {
          msg.textContent = "이 브라우저에서는 복사 기능을 쓸 수 없습니다. 직접 선택해서 복사해 주세요.";
          return;
        }
        navigator.clipboard.writeText(ex.body).then(
          function () { msg.textContent = "복사했습니다."; },
          function () { msg.textContent = "복사에 실패했습니다. 직접 선택해서 복사해 주세요."; }
        );
      }
    }));
    btnRow.appendChild(el("button", {
      type: "button",
      text: "Markdown 파일로 받기",
      onclick: function () {
        download(ex.filename || 'example.md', ex.body, 'text/markdown');
      }
    }));
    s.appendChild(btnRow);
    s.appendChild(msg);
    return s;
  }

  function sectionChecklist(lesson, ls) {
    var s = el("section");
    s.appendChild(el("h2", { text: "실습 체크리스트" }));
    var ul = el("ul", { class: "checklist" });
    lesson.checklist.forEach(function (item) {
      var li = el("li");
      var label = el("label");
      var checkbox = el("input", { type: "checkbox" });
      checkbox.checked = !!ls.checks[item.id];
      checkbox.addEventListener("change", function () {
        var cur = getLessonState(lesson.id);
        var checks = Object.assign({}, cur.checks);
        checks[item.id] = checkbox.checked;
        setLessonState(lesson.id, { checks: checks });
        updateLeftNote(lesson);
      });
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(" " + item.text));
      li.appendChild(label);
      ul.appendChild(li);
    });
    s.appendChild(ul);
    return s;
  }

  // 여러 날에 걸쳐 기록하는 수업(lesson.daily = 목표 일수)용. 날짜 목록은 days 에 저장.
  function sectionDaily(lesson) {
    var s = el("section");
    s.appendChild(el("h2", { text: lesson.daily + "일 기록" }));
    var status = el("p", { role: "status" });
    var list = el("p", { class: "note" });
    var btn = el("button", { type: "button" });
    function render() {
      var days = getLessonState(lesson.id).days || [];
      var didToday = days.indexOf(today()) !== -1;
      status.textContent = days.length + "/" + lesson.daily + "일 기록함" + (days.length >= lesson.daily ? " — 목표를 채웠습니다." : "");
      list.textContent = days.length ? "기록한 날: " + days.join(", ") : "옵시디언에서 데일리 노트를 쓴 날에 눌러 주세요. 같은 날짜는 한 번만 기록됩니다.";
      btn.textContent = didToday ? "오늘 기록 취소" : "오늘 기록함";
    }
    btn.addEventListener("click", function () {
      var days = getLessonState(lesson.id).days || [];
      var t = today();
      var next = days.indexOf(t) === -1 ? addDay(days, t) : days.filter(function (d) { return d !== t; });
      setLessonState(lesson.id, { days: next });
      render();
    });
    render();
    s.appendChild(status);
    s.appendChild(btn);
    s.appendChild(list);
    return s;
  }

  // 체크할 때마다 완료 버튼 위의 '남은 항목' 안내를 다시 계산한다.
  function updateLeftNote(lesson) {
    var note = document.getElementById("left-note");
    if (!note || !lesson.checklist) return;
    var checks = getLessonState(lesson.id).checks;
    var left = lesson.checklist.filter(function (i) { return !checks[i.id]; }).length;
    note.textContent = left > 0 ? "아직 체크하지 않은 항목이 " + left + "개 있어요. 완료는 그래도 할 수 있습니다." : "";
  }

  function sectionHelp(lesson) {
    var s = el("section");
    s.appendChild(el("h2", { text: "막혔을 때 도움말" }));
    lesson.help.forEach(function (h) {
      var details = el("details");
      details.appendChild(el("summary", { text: h.q }));
      details.appendChild(el("p", { text: h.a }));
      s.appendChild(details);
    });
    return s;
  }

  function sectionQuiz(lesson) {
    var s = el("section");
    s.appendChild(el("h2", { text: "이해 확인" }));
    lesson.quiz.forEach(function (q) {
      var p = el("p", { text: q.q });
      s.appendChild(p);
      var details = el("details");
      details.appendChild(el("summary", { text: "답 보기" }));
      details.appendChild(el("p", { text: q.a }));
      s.appendChild(details);
    });
    return s;
  }

  function sectionMemoAndDone(lesson, ls) {
    var s = el("section");
    s.appendChild(el("h2", { text: "한 줄 기록과 완료" }));

    var textareaId = "memo-" + lesson.id;
    s.appendChild(el("label", { for: textareaId, text: "오늘 배운 점을 한 줄로 남겨 보세요" }));
    var textarea = el("textarea", { id: textareaId, rows: "3" });
    textarea.value = ls.memo || "";
    textarea.addEventListener("input", function () {
      setLessonState(lesson.id, { memo: textarea.value });
    });
    s.appendChild(textarea);

    s.appendChild(el("p", { class: "note", id: "left-note", role: "status" }));

    var btnRow = el("div", { class: "btn-row nav-row" });
    var idx = lessonIndex(lesson.id);
    var prev = idx > 0 ? COURSE.lessons[idx - 1] : null;
    if (prev && prev.ready && !!prev.optional === !!lesson.optional) {
      btnRow.appendChild(el("a", { class: "btn-link", href: "#/lesson/" + prev.id, text: "이전 수업" }));
    }

    var isDone = !!ls.done;
    btnRow.appendChild(el("button", {
      type: "button",
      text: isDone ? "완료 취소" : "완료하고 다음으로",
      onclick: function () {
        if (isDone) {
          setLessonState(lesson.id, { done: false });
          router();
          return;
        }
        setLessonState(lesson.id, { done: true });
        var next = COURSE.lessons[idx + 1];
        location.hash = next && next.ready && !!next.optional === !!lesson.optional ? "#/lesson/" + next.id : "#/map";
      }
    }));
    s.appendChild(btnRow);
    return s;
  }

  function sectionSources(lesson) {
    var s = el("section");
    s.appendChild(el("h2", { text: "참고한 자료" }));
    var ul = el("ul");
    lesson.sources.forEach(function (src) {
      var li = el("li");
      li.appendChild(el("a", { href: src.url, target: "_blank", rel: "noopener", text: src.label }));
      ul.appendChild(li);
    });
    s.appendChild(ul);
    return s;
  }

  // --- 수업 화면 ---
  function renderLesson(root, id) {
    var lesson = findLesson(id);
    if (!lesson || !lesson.ready) {
      root.appendChild(el("p", { text: "찾을 수 없거나 아직 준비되지 않은 수업입니다." }));
      root.appendChild(el("a", { class: "link", href: "#/map", text: "학습 지도로 이동" }));
      return;
    }

    state.last = id;
    save(state);
    var ls = getLessonState(id);

    var layout = el("div", { class: "lesson-layout" });

    var toc = el("nav", { class: "lesson-toc", "aria-label": "전체 수업 목차" });
    COURSE.stages.forEach(function (stage) {
      toc.appendChild(el("h3", { text: stage.title }));
      var ul = el("ul");
      COURSE.lessons.filter(function (l) { return l.stage === stage.id; }).forEach(function (l) {
        var li = el("li");
        if (l.id === id) {
          li.appendChild(el("strong", { text: l.no + ". " + l.title }));
        } else if (l.ready) {
          li.appendChild(el("a", { href: "#/lesson/" + l.id, text: l.no + ". " + l.title }));
        } else {
          li.appendChild(el("span", { class: "muted", text: l.no + ". " + l.title + " (준비 중)" }));
        }
        ul.appendChild(li);
      });
      toc.appendChild(ul);
    });

    var content = el("article", { class: "lesson-content" });
    content.appendChild(el("h1", { text: lesson.no + ". " + lesson.title }));
    if (lesson.optional) content.appendChild(el('p', { class: 'note', text: '선택 수업 · 필요할 때 골라 학습하세요. 완료하지 않아도 기본 과정은 100%가 됩니다.' }));
    if (lesson.goal) content.appendChild(sectionGoal(lesson));
    if (lesson.concept || lesson.terms) content.appendChild(sectionConcept(lesson));
    if (lesson.video) content.appendChild(sectionVideo(lesson));
    if (lesson.steps) content.appendChild(sectionSteps(lesson));
    if (lesson.example) content.appendChild(sectionExample(lesson));
    if (lesson.help) content.appendChild(sectionHelp(lesson));
    if (lesson.quiz) content.appendChild(sectionQuiz(lesson));
    content.appendChild(sectionMemoAndDone(lesson, ls));
    if (lesson.sources) content.appendChild(sectionSources(lesson));

    var aside = el("aside", { class: "lesson-checklist" });
    if (lesson.checklist) aside.appendChild(sectionChecklist(lesson, ls));
    if (lesson.daily) aside.appendChild(sectionDaily(lesson));

    layout.appendChild(toc);
    layout.appendChild(content);
    layout.appendChild(aside);
    root.appendChild(layout);
    updateLeftNote(lesson);
  }

  var RESOURCES = [
  // 영상
  { type: "영상", title: "천재들이 쓰는 노트앱? 옵시디언 활용법 200%!", by: "노마드 코더", level: "입문(개념)", url: "https://www.youtube.com/watch?v=h6rxKbbgI28" },
  { type: "영상", title: "15분만에 훑어보는 옵시디언 사용법", by: "생산성 빌리언 시안", level: "입문", url: "https://www.youtube.com/watch?v=ZuEu8SDqHOE", checked: true },
  { type: "영상", title: "옵시디언, 단순한 메모앱이 아닙니다 | 설치·개념·사용법 총정리", by: "Aiden의 친절한 AI", level: "입문", url: "https://www.youtube.com/watch?v=jSFvVxmZQPQ" },
  { type: "영상", title: "옵시디언 쌩 기초는 탄탄하게, 이 한 영상으로 완벽하게", by: "브레인 트리니티", level: "입문~초급", url: "https://www.youtube.com/watch?v=KA1xjWQsex8" },
  { type: "영상", title: "카파시의 LLM Wiki로 나만의 AI 세컨드 브레인 만들기", by: "브레인 트리니티", level: "고급(AI)", url: "https://www.youtube.com/watch?v=cNlvrU-KcRg" },
  { type: "영상", title: "노션을 대체할 기록앱? 옵시디언 편", by: "도르미 Dormi", level: "입문(노션 비교)", url: "https://www.youtube.com/watch?v=ujiIEDK067A" },
  { type: "영상", title: "옵시디언 필수 초기 설정 한 방에 끝내기, 플러그인 설명", by: "북트레싱", level: "초급", url: "https://www.youtube.com/watch?v=RKKVIyZUuVw", checked: true },
  { type: "영상", title: "옵시디언으로 내 지식을 쌓고 연결하고 꺼내쓰자 (구요한 대표)", by: "티타임즈TV", level: "개념/동기부여", url: "https://www.youtube.com/watch?v=k2FQEZx8g4E" },
  { type: "영상", title: "옵시디언 데일리 노트로 시간 관리·일정 관리·플래너", by: "북트레싱", level: "초급", url: "https://www.youtube.com/watch?v=O5MR2eylAkI", checked: true },
  { type: "영상", title: "옵시디언 마크다운 마스터하기, 초보자 완벽 가이드", by: "북트레싱", level: "입문", url: "https://www.youtube.com/watch?v=rzor1oQyY9U", checked: true },
  { type: "영상", title: "Templater 플러그인 사용법", by: "북트레싱", level: "중급", url: "https://www.youtube.com/watch?v=17tThWhNNGw" },
  { type: "영상", title: "데이터뷰(Dataview) 쉬운 설명", by: "북트레싱", level: "중급", url: "https://www.youtube.com/watch?v=Iv7wCJArqPI" },
  { type: "영상", title: "Tasks 플러그인 할 일 관리", by: "북트레싱", level: "중급", url: "https://www.youtube.com/watch?v=Qok3EljgmbA" },
  { type: "영상", title: "추천 플러그인 7가지", by: "북트레싱", level: "중급", url: "https://www.youtube.com/watch?v=C6CWGeutZj0" },
  { type: "영상", title: "15분만에 미니멀 세팅 (제텔카스텐+PARA)", by: "생산적생산자", level: "중급", url: "https://www.youtube.com/watch?v=_4MEE5lHVV0" },
  { type: "영상", title: "Give Me 15 Minutes. I'll Teach You 80% of Obsidian", by: "Nick Milo", level: "입문(영어)", url: "https://www.youtube.com/watch?v=z4AbijUCoKU" },

  // 블로그
  { type: "블로그", title: "옵시디언 사용법 완벽 정리, 로컬 저장 노트앱 초보자 가이드", level: "입문", url: "https://blog.naver.com/m84vlog/224253765952" },
  { type: "블로그", title: "옵시디언 동기화(Sync) 완벽 정리: PC·모바일, 무료·유료 비교", level: "초급", url: "https://blog.naver.com/yim8107/224157419647" },
  { type: "블로그", title: "옵시디언 시작하기: 2026년 최신 제텔카스텐 구축 가이드", level: "중급", url: "https://blog.naver.com/yim8107/224157414216" },
  { type: "블로그", title: "[연재 1편] 옵시디언이 바꾸는 지식관리? 놓치고 있는 환상과 한계", level: "개념", url: "https://blog.naver.com/greatbeeofficial/224403614838" },
  { type: "블로그", title: "옵시디언과 클로드코드", level: "고급(AI)", url: "https://blog.naver.com/medosam/224338519582" },
  { type: "블로그", title: "생각 정리 방법 공유 (옵시디언, 노션, 6공다이어리)", level: "활용 사례", url: "https://blog.naver.com/b8sarah/224154314843" },
  { type: "블로그", title: "옵시디언 사용법, 책 추천: 세컨드 브레인은 옵시디언", level: "입문~고급(책)", url: "https://blog.naver.com/bpkarijju/224274875871" },
  { type: "블로그", title: "옵시디언이란? AI 초보자를 위한 기본 사용법 총정리", level: "입문", url: "https://blog.naver.com/iloveai777/224416336354" },
  { type: "블로그", title: "옵시디언 폴더는 어떻게 정리하지", level: "초급", url: "https://blog.naver.com/shooding1602/224063692391" },
  { type: "블로그", title: "[옵시디언] 폴더 세팅·단축키·플러그인·Git 백업·초기설정", level: "초급", url: "https://blog.naver.com/schicksal27/224377722237" },
  { type: "블로그", title: "초보자 정주행 순서 (위 글과 같은 블로그의 연재)", level: "초급", url: "https://blog.naver.com/schicksal27/224381601198" },
  { type: "블로그", title: "스파르타클럽 · 설치와 사용법", by: "브런치", level: "입문", url: "https://brunch.co.kr/@sparta/65" },
  { type: "블로그", title: "설치부터 첫 노트까지", by: "티스토리", level: "입문", url: "https://doing27.tistory.com/168" },
  { type: "블로그", title: "Remotely Save 무료 동기화", level: "초급", url: "https://blog.naver.com/urban_dreamer/224393029031" },

  // 인스타그램
  { type: "인스타그램", title: "옵시디언으로 쓸수록 똑똑해지는 AI 비서 만들기", by: "@hongik.man", level: "고급", url: "https://www.instagram.com/p/Dasdr6GvqQz/" },
  { type: "인스타그램", title: "갓벽 생산성 옵시디언, 노트 900개+ 후기", by: "@judos_sewol", level: "입문(동기부여)", url: "https://www.instagram.com/p/DbaVjpeAKXX/" },
  { type: "인스타그램", title: "요즘 AI 고수들은 전부 쓰는 '옵시디언' 정리", by: "@moodmode.ai", level: "입문~고급", url: "https://www.instagram.com/p/DbfxGbcEZrJ/" },
  { type: "인스타그램", title: "\"대체 LLM 위키가 뭐냐고요?\"", by: "@chloe_et_al", level: "고급", url: "https://www.instagram.com/p/DaUw-WmhGDH/" },
  { type: "인스타그램", title: "옵시디언으로 제2의 뇌 만들기", by: "@ai.yeongseon", level: "중급~고급", url: "https://www.instagram.com/p/DZ4gJ8oNzzG/" },
  { type: "인스타그램", title: "메모를 안 하는 두 번째 뇌, LLM Wiki", by: "@hpd.ai", level: "고급", url: "https://www.instagram.com/p/DZXf0fZCvYp/" },
  { type: "인스타그램", title: "옵시디언 + 클로드 코드 세컨드 브레인", by: "@hongik.man", level: "고급", url: "https://www.instagram.com/p/Da3IEDJD_XB/" },
  { type: "인스타그램", title: "옵시디언이랑 클로드코드 콤보 써보고 충격", by: "@sebia.ai", level: "고급", url: "https://www.instagram.com/p/DY4GsusxWm9/" },
  { type: "인스타그램", title: "\"옵시디언? 개발자만 쓰는 거 아냐?\" 편견 깨기", by: "@recordmate_taya", level: "입문", url: "https://www.instagram.com/p/DUDfnqgE6XN/" },
  { type: "인스타그램", title: "노트 900개+의 추천 플러그인: Admonition(콜아웃)", by: "@judos_obsidian", level: "중급", url: "https://www.instagram.com/p/DbcQzQMPRKt/" },
  { type: "인스타그램", title: "옵시디언으로 논문 정리하기", by: "@phd.ai.log", level: "활용 사례", url: "https://www.instagram.com/p/DaoelXWAeIQ/" },
  { type: "인스타그램", title: "투자에 옵시디언 활용", by: "@yunu_log", level: "활용 사례", url: "https://www.instagram.com/p/DbA_RYrSbRA/" }
];

  function download(filename, text, type) {
    var url = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
    var a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function parseBackup(text) {
    if (text.length > 5 * 1024 * 1024) throw new Error('백업 파일은 5MB 이하여야 합니다.');
    var raw = JSON.parse(text);
    var object = function (v) { return v && typeof v === 'object' && !Array.isArray(v); };
    if (!object(raw)) throw new Error('학습 기록 백업 파일이 아닙니다.');
    if ('version' in raw || 'app' in raw) {
      if (raw.app !== 'chageun-obsidian' || raw.version !== 1) throw new Error('지원하지 않는 백업 형식입니다.');
      raw = raw.state;
    }
    if (!object(raw) || !object(raw.lessons)) throw new Error('수업 기록이 없는 파일입니다.');
    var result = { last: null, lessons: {} };
    if (raw.last != null) {
      if (!findLesson(raw.last)) throw new Error('마지막 수업 정보가 올바르지 않습니다.');
      result.last = raw.last;
    }
    COURSE.lessons.forEach(function (lesson) {
      if (!Object.prototype.hasOwnProperty.call(raw.lessons, lesson.id)) return;
      var record = raw.lessons[lesson.id];
      if (!object(record) || (record.checks !== undefined && !object(record.checks)) ||
          (record.memo !== undefined && typeof record.memo !== 'string') ||
          (record.done !== undefined && typeof record.done !== 'boolean') ||
          (record.days !== undefined && !Array.isArray(record.days))) {
        throw new Error(lesson.no + '번 수업 기록의 형식이 올바르지 않습니다.');
      }
      var clean = { checks: {}, memo: record.memo || '', done: record.done === true };
      (lesson.checklist || []).forEach(function (item) {
        var value = record.checks && record.checks[item.id];
        if (value !== undefined && typeof value !== 'boolean') throw new Error('실습 체크 형식이 올바르지 않습니다.');
        if (value !== undefined) clean.checks[item.id] = value;
      });
      if (record.days !== undefined) {
        if (!record.days.every(function (d) {
          if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
          var date = new Date(d + 'T00:00:00Z');
          return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === d;
        })) throw new Error('기록 날짜가 올바르지 않습니다.');
        if (lesson.daily) clean.days = Array.from(new Set(record.days)).sort();
      }
      result.lessons[lesson.id] = clean;
    });
    if (Object.keys(raw.lessons).length && !Object.keys(result.lessons).length) {
      throw new Error('이 과정에 맞는 수업 기록이 없습니다.');
    }
    return result;
  }

  function renderSettings(root) {
    root.appendChild(el('h1', { text: '내 세팅 현황' }));
    root.appendChild(el('p', { class: 'note', text: '수업에서 직접 체크한 설정입니다. 옵시디언의 실제 설정을 자동으로 확인하지는 않습니다. 변경하려면 해당 수업의 체크리스트를 수정하세요.' }));
    var total = 0, applied = 0;
    var summary = el('p', { role: 'status' });
    root.appendChild(summary);
    COURSE.stages.forEach(function (stage) {
      var list = el('ul', { class: 'lesson-list' });
      COURSE.lessons.filter(function (l) { return l.stage === stage.id; }).forEach(function (lesson) {
        (lesson.checklist || []).filter(function (item) { return item.setting; }).forEach(function (item) {
          var checked = !!getLessonState(lesson.id).checks[item.id];
          total++;
          if (checked) applied++;
          list.appendChild(el('li', {}, [
            el('span', {}, [el('strong', { text: item.setting }), el('p', { text: item.text }),
              el('a', { href: '#/lesson/' + lesson.id, text: lesson.no + '번 수업에서 확인·수정' })]),
            el('span', { class: 'status', text: checked ? '적용함' : '아직 체크하지 않음' })
          ]));
        });
      });
      if (list.children.length) {
        root.appendChild(el('h2', { text: stage.title }));
        root.appendChild(list);
      }
    });
    summary.textContent = '적용한 설정 ' + applied + '/' + total + '개 · 남은 설정 ' + (total - applied) + '개';
  }

  function exportNotes() {
    var lines = ['# 내 옵시디언 학습 기록', '', '내보낸 날짜: ' + today(), ''];
    COURSE.lessons.forEach(function (lesson) {
      var ls = getLessonState(lesson.id);
      lines.push('## ' + (lesson.optional ? '선택 · ' : '') + lesson.no + '. ' + lesson.title, '', '상태: ' + lessonStatus(lesson.id), '');
      (lesson.checklist || []).forEach(function (item) { lines.push('- [' + (ls.checks[item.id] ? 'x' : ' ') + '] ' + item.text); });
      if (ls.days && ls.days.length) lines.push('', '데일리 노트 기록: ' + ls.days.join(', '));
      lines.push('', '### 학습 메모', '', ls.memo || '(메모 없음)', '');
    });
    return lines.join('\n');
  }

  function renderNotes(root) {
    root.appendChild(el('h1', { text: '내 학습 기록' }));
    root.appendChild(el('p', { class: 'note', text: '체크와 메모는 현재 브라우저에 저장됩니다. 다른 기기로 옮길 때는 JSON 백업을 받고 복원하세요. Markdown 파일은 읽기·보관용이며 복원할 수 없습니다.' }));
    var row = el('div', { class: 'btn-row' });
    row.appendChild(el('button', { type: 'button', text: '학습 기록 Markdown 받기', onclick: function () {
      download('옵시디언-학습기록-' + today() + '.md', exportNotes(), 'text/markdown');
    } }));
    row.appendChild(el('button', { type: 'button', text: '전체 기록 JSON 백업', onclick: function () {
      download('옵시디언-학습백업-' + today() + '.json', JSON.stringify({ app: 'chageun-obsidian', version: 1, exportedAt: new Date().toISOString(), state: state }, null, 2), 'application/json');
    } }));
    root.appendChild(row);
    var restore = el('section', { class: 'restore-panel' });
    restore.appendChild(el('h2', { text: '백업 파일 복원' }));
    restore.appendChild(el('p', { text: '복원하면 현재 기록 전체가 백업 내용으로 바뀝니다. 먼저 현재 기록을 JSON으로 백업해 두세요. 파일을 고르면 내용을 확인한 뒤 복원할 수 있습니다.' }));
    restore.appendChild(el('label', { for: 'backup-file', text: 'JSON 백업 파일 선택 (5MB 이하)' }));
    var fileInput = el('input', { id: 'backup-file', type: 'file', accept: '.json,application/json' });
    var status = el('p', { role: 'status', 'aria-live': 'polite' });
    var preview = el('div');
    var pending = null, selection = 0;
    fileInput.addEventListener('change', async function () {
      var current = ++selection;
      pending = null;
      clear(preview);
      var file = fileInput.files[0];
      if (!file) { status.textContent = ''; return; }
      status.textContent = '백업 파일을 확인하고 있습니다.';
      try {
        if (file.size > 5 * 1024 * 1024) throw new Error('백업 파일은 5MB 이하여야 합니다.');
        var parsed = parseBackup(await file.text());
        if (current !== selection) return;
        pending = parsed;
        var done = Object.values(parsed.lessons).filter(function (v) { return v.done; }).length;
        status.textContent = '백업에 수업 기록 ' + Object.keys(parsed.lessons).length + '개, 완료 ' + done + '개가 있습니다. 아직 현재 기록을 바꾸지 않았습니다.';
        var buttons = el('div', { class: 'btn-row' });
        buttons.appendChild(el('button', { type: 'button', text: '이 백업으로 현재 기록 교체', onclick: function () {
          if (!pending) return;
          if (!save(pending)) { status.textContent = '저장하지 못해 복원하지 않았습니다. 브라우저 저장 공간을 확인해 주세요.'; return; }
          state = pending;
          pending = null;
          renderNotesAfterRestore();
        } }));
        buttons.appendChild(el('button', { type: 'button', text: '복원 취소', onclick: function () {
          pending = null; fileInput.value = ''; clear(preview); status.textContent = '복원을 취소했습니다. 현재 기록을 유지합니다.';
        } }));
        preview.appendChild(buttons);
      } catch (e) {
        if (current !== selection) return;
        status.textContent = '복원하지 않았습니다. ' + (e instanceof SyntaxError ? '올바른 JSON 파일이 아닙니다.' : e.message);
      }
    });
    function renderNotesAfterRestore() {
      router();
      document.getElementById('restore-result').textContent = '백업을 복원했습니다. 아래 수업 기록과 진도를 확인하세요.';
    }
    restore.appendChild(fileInput);
    restore.appendChild(status);
    restore.appendChild(preview);
    root.appendChild(restore);
    root.appendChild(el('p', { id: 'restore-result', role: 'status' }));
    COURSE.lessons.forEach(function (lesson) {
      var ls = getLessonState(lesson.id);
      var section = el('section', { class: 'record-card' });
      section.appendChild(el('h2', {}, [el('a', { href: '#/lesson/' + lesson.id, text: (lesson.optional ? '선택 · ' : '') + lesson.no + '. ' + lesson.title })]));
      section.appendChild(el('p', { text: '상태: ' + lessonStatus(lesson.id) }));
      section.appendChild(el('label', { for: 'record-' + lesson.id, text: '배운 점·어려웠던 점' }));
      var memo = el('textarea', { id: 'record-' + lesson.id, rows: '3' });
      memo.value = ls.memo;
      memo.addEventListener('input', function () {
        setLessonState(lesson.id, { memo: memo.value });
        section.querySelector('p').textContent = '상태: ' + lessonStatus(lesson.id);
      });
      section.appendChild(memo);
      if (ls.days && ls.days.length) section.appendChild(el('p', { class: 'note', text: '기록한 날: ' + ls.days.join(', ') }));
      root.appendChild(section);
    });
  }

  function renderGlossary(root) {
    root.appendChild(el('h1', { text: '용어집' }));
    root.appendChild(el('p', { class: 'note', text: '수업에 나온 용어를 가나다순으로 모았습니다. 수업 링크에서 실제 사용 방법을 확인하세요.' }));
    var seen = new Set(), terms = [];
    COURSE.lessons.forEach(function (lesson) {
      (lesson.terms || []).forEach(function (term) {
        if (seen.has(term.term)) return;
        seen.add(term.term);
        terms.push({ term: term.term, desc: term.desc, lesson: lesson });
      });
    });
    terms.sort(function (a, b) { return a.term.localeCompare(b.term, 'ko'); });
    var dl = el('dl', { class: 'terms' });
    terms.forEach(function (t) {
      dl.appendChild(el('dt', { text: t.term }));
      dl.appendChild(el('dd', {}, [document.createTextNode(t.desc + ' '), el('a', { href: '#/lesson/' + t.lesson.id, text: '(' + t.lesson.no + '번 수업)' })]));
    });
    root.appendChild(dl);
  }

  function renderResources(root) {
    root.appendChild(el('h1', { text: '자료실' }));
    root.appendChild(el('p', { class: 'note', text: '궁금한 주제만 골라 보세요. 목록은 노션 원본을 옮겼습니다. 임베드 확인은 영상의 존재·임베드 허용만 이전 제작 단계에서 확인했다는 뜻이며, 내용은 시청하지 않았습니다. 미확인 자료는 접근 가능 여부와 내용을 확인하지 않았습니다.' }));
    var row = el('div', { class: 'btn-row', role: 'group', 'aria-label': '자료 유형' });
    var status = el('p', { role: 'status' });
    var list = el('ul', { class: 'lesson-list resource-list' });
    function show(type) {
      Array.from(row.children).forEach(function (button) { button.setAttribute('aria-pressed', String(button.textContent === type)); });
      clear(list);
      var shown = RESOURCES.filter(function (r) { return type === '전체' || r.type === type; });
      status.textContent = type + ' ' + shown.length + '개';
      shown.forEach(function (r) {
        list.appendChild(el('li', {}, [el('span', {}, [el('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer', text: r.title }),
          el('p', { class: 'note', text: r.type + (r.by ? ' · ' + r.by : '') + ' · ' + r.level })]),
          el('span', { class: 'status', text: r.checked ? '임베드 확인' : '미확인' })]));
      });
    }
    ['전체', '영상', '블로그', '인스타그램'].forEach(function (type) {
      row.appendChild(el('button', { type: 'button', text: type, 'aria-pressed': 'false', onclick: function () { show(type); } }));
    });
    root.appendChild(row);
    root.appendChild(status);
    root.appendChild(list);
    show('전체');
  }


  // --- 라우터 ---
  function router() {
    var root = document.getElementById("app");
    clear(root);
    var hash = location.hash || "#/";
    document.querySelectorAll('.site-header nav a').forEach(function (link) {
      if (link.getAttribute('href') === hash) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    var m = hash.match(/^#\/lesson\/(.+)$/);
    if (m) { renderLesson(root, decodeURIComponent(m[1])); return; }
    if (hash === "#/map") { renderMap(root); return; }
    if (hash === '#/settings') { renderSettings(root); return; }
    if (hash === '#/notes') { renderNotes(root); return; }
    if (hash === '#/resources') { renderResources(root); return; }
    if (hash === '#/glossary') { renderGlossary(root); return; }
    renderHome(root);
  }

  window.addEventListener("hashchange", router);
  window.addEventListener("DOMContentLoaded", router);
})();
