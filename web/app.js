/* global marked */

const $ = (id) => document.getElementById(id);

function loadSetting(key, fallback = "") {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveSetting(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function apiBase() {
  const base = ($("apiBase").value || "").trim();
  if (!base) return "";
  // Common mistake: set base to http://host/web/ . API base should be http://host
  return base.replace(/\/?web\/?$/, "").replace(/\/$/, "");
}

function headers() {
  const h = { "Content-Type": "application/json" };
  const apiKey = ($("apiKey").value || "").trim();
  if (apiKey) h["X-API-Key"] = apiKey;
  return h;
}

async function apiGet(path) {
  const url = apiBase() + path;
  const r = await fetch(url, { headers: headers() });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`GET ${path} ${r.status}: ${txt}`);
  }
  return r.json();
}

async function apiPost(path, body) {
  const url = apiBase() + path;
  const r = await fetch(url, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`POST ${path} ${r.status}: ${txt}`);
  return JSON.parse(txt);
}

let allCourses = [];
let selected = null; // {repo_name, course_code, course_name, repo_type}

let pollTimer = null;

// Markdown rendering (GitHub-ish)
try {
  marked.setOptions({
    gfm: true,
    breaks: true,
    headerIds: true,
    mangle: false,
    highlight: (code, lang) => {
      try {
        if (window.hljs) {
          if (lang && window.hljs.getLanguage(lang)) {
            return window.hljs.highlight(code, { language: lang }).value;
          }
          return window.hljs.highlightAuto(code).value;
        }
      } catch {
        // ignore
      }
      return code;
    },
  });
} catch {
  // ignore
}

function filterCourses() {
  const q = ($("search").value || "").trim().toLowerCase();
  if (!q) return allCourses;
  return allCourses.filter((it) => {
    return (
      (it.repo_name || "").toLowerCase().includes(q) ||
      (it.course_code || "").toLowerCase().includes(q) ||
      (it.course_name || "").toLowerCase().includes(q)
    );
  });
}

function setTab(tab) {
  const isPreview = tab === "preview";
  $("panelPreview").classList.toggle("hidden", !isPreview);
  $("panelEdit").classList.toggle("hidden", isPreview);
  $("tabPreview").classList.toggle("bg-slate-900", isPreview);
  $("tabPreview").classList.toggle("text-white", isPreview);
  $("tabEdit").classList.toggle("bg-slate-900", !isPreview);
  $("tabEdit").classList.toggle("text-white", !isPreview);
}

function author() {
  return {
    name: ($("authorName").value || "").trim(),
    link: ($("authorLink").value || "").trim(),
    date: ($("authorDate").value || "").trim(),
  };
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setToast({ type, title, message, linkUrl, linkText } = {}) {
  const box = $("toast");
  if (!box) return;

  const palette =
    type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" :
    type === "warn" ? "border-amber-200 bg-amber-50 text-amber-900" :
    type === "error" ? "border-red-200 bg-red-50 text-red-900" :
    "border-slate-200 bg-white text-slate-900";

  box.className = `fixed bottom-4 right-4 z-50 max-w-[520px] border rounded shadow p-3 ${palette}`;
  box.innerHTML = `
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="font-semibold text-sm">${escapeHtml(title || "")}</div>
        ${message ? `<div class="text-sm mt-1 break-words">${escapeHtml(message)}</div>` : ""}
        ${linkUrl ? `<a class="text-sm underline mt-2 inline-block" target="_blank" rel="noreferrer" href="${escapeHtml(linkUrl)}">${escapeHtml(linkText || linkUrl)}</a>` : ""}
      </div>
      <button id="toastClose" class="px-2 py-1 text-xs border rounded bg-white/60">关闭</button>
    </div>
  `;
  box.classList.remove("hidden");
  $("toastClose")?.addEventListener("click", () => box.classList.add("hidden"));
  // auto hide after 8s for non-error
  if (type !== "error") {
    setTimeout(() => box.classList.add("hidden"), 8000);
  }
}

function setSubmitStatus(html, { kind = "info" } = {}) {
  const el = $("submitStatus");
  if (!el) return;
  const palette =
    kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" :
    kind === "warn" ? "border-amber-200 bg-amber-50 text-amber-900" :
    kind === "error" ? "border-red-200 bg-red-50 text-red-900" :
    "border-slate-200 bg-slate-50 text-slate-900";
  el.className = `mt-3 border rounded p-3 ${palette}`;
  el.innerHTML = html;
  el.classList.remove("hidden");
}

function setBusy(isBusy, label = "") {
  const submitBtn = $("submit");
  const dryBtn = $("dryRun");
  if (submitBtn) submitBtn.disabled = isBusy;
  if (dryBtn) dryBtn.disabled = isBusy;
  if (submitBtn) submitBtn.textContent = isBusy ? (label || "提交中…") : "提交（PR/排队）";
}

function renderRepoList(items) {
  $("count").textContent = String(items.length);
  const list = $("repoList");
  list.innerHTML = "";

  if (!items.length) {
    list.innerHTML = '<div class="p-3 text-sm text-slate-600">没有匹配结果。可以点右上角“申请新建”。</div>';
    return;
  }

  for (const it of items) {
    const row = document.createElement("button");
    row.className =
      "w-full text-left px-3 py-2 hover:bg-slate-50 flex items-start justify-between gap-2";

    const left = document.createElement("div");
    left.innerHTML = `
      <div class="font-semibold mono">${escapeHtml(it.repo_name)}</div>
      <div class="text-xs text-slate-600">${escapeHtml(it.course_name || it.course_code || "")}</div>
    `;

    const right = document.createElement("div");
    right.className = "text-xs text-slate-500";
    right.textContent = it.repo_type || "";

    row.appendChild(left);
    row.appendChild(right);

    row.addEventListener("click", () => selectCourse(it));
    list.appendChild(row);
  }
}

async function refreshIndex({ force = false } = {}) {
  $("repoList").innerHTML =
    '<div class="p-3 text-sm text-slate-600">加载中…</div>';
  const items = await apiGet(`/v1/courses/index?refresh=${force ? "true" : "false"}`);
  allCourses = items;
  renderRepoList(filterCourses());
}

async function selectCourse(it) {
  selected = it;
  $("selectedTitle").textContent = `${it.repo_name} - ${it.course_name || it.course_code || ""}`;
  $("selectedMeta").textContent = `course_code=${it.course_code} repo_type=${it.repo_type}`;
  updateSectionOptions();
  await loadReadme();
  setTab("preview");
}

async function loadReadme() {
  if (!selected) return;
  $("readme").innerHTML = '<div class="text-sm text-slate-600">加载 README…</div>';
  const data = await apiGet(`/v1/courses/readme?repo_name=${encodeURIComponent(selected.repo_name)}`);
  $("readmeSource").textContent = data.source || "";
  const html = marked.parse(data.readme_md || "");
  $("readme").innerHTML = html;
  try {
    if (window.hljs) window.hljs.highlightAll();
  } catch {
    // ignore
  }
}

function buildForm() {
  const sec = $("section").value;
  const form = $("form");
  form.innerHTML = "";

  if (sec === "description") {
    if (!selected || !selected.__isNew) {
      form.innerHTML = `
        <div class="text-sm text-slate-700">description 建议仅在“申请新建仓库”流程中填写。</div>
        <div class="text-xs text-slate-500 mt-1">为避免覆盖已有仓库的说明，此处已禁用。</div>
      `;
      return;
    }
    form.innerHTML = `
      <label class="text-xs text-slate-600">description 内容</label>
      <textarea id="content" class="w-full px-3 py-2 border rounded mt-1 h-40" placeholder="填写说明…"></textarea>
    `;
    return;
  }

  if (sec === "lecturer_review") {
    form.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label class="text-xs text-slate-600">老师姓名</label>
          <input id="lecturerName" class="w-full px-3 py-2 border rounded mt-1" placeholder="例如 张三" />
        </div>
      </div>
      <label class="text-xs text-slate-600 mt-3 block">评价内容</label>
      <textarea id="content" class="w-full px-3 py-2 border rounded mt-1 h-32" placeholder="填写评价…"></textarea>
    `;
    return;
  }

  if (sec === "textbooks") {
    form.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div><label class="text-xs text-slate-600">title</label><input id="tbTitle" class="w-full px-3 py-2 border rounded mt-1" /></div>
        <div><label class="text-xs text-slate-600">book_author</label><input id="tbAuthor" class="w-full px-3 py-2 border rounded mt-1" /></div>
        <div><label class="text-xs text-slate-600">publisher</label><input id="tbPublisher" class="w-full px-3 py-2 border rounded mt-1" /></div>
        <div><label class="text-xs text-slate-600">edition</label><input id="tbEdition" class="w-full px-3 py-2 border rounded mt-1" /></div>
        <div><label class="text-xs text-slate-600">type</label><input id="tbType" class="w-full px-3 py-2 border rounded mt-1" placeholder="textbook/reference" /></div>
      </div>
    `;
    return;
  }

  if (sec === "online_resources") {
    form.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div><label class="text-xs text-slate-600">title</label><input id="orTitle" class="w-full px-3 py-2 border rounded mt-1" /></div>
        <div><label class="text-xs text-slate-600">url</label><input id="orUrl" class="w-full px-3 py-2 border rounded mt-1" placeholder="https://..." /></div>
      </div>
      <label class="text-xs text-slate-600 mt-3 block">description</label>
      <textarea id="content" class="w-full px-3 py-2 border rounded mt-1 h-24" placeholder="资源说明…"></textarea>
    `;
    return;
  }

  if (sec === "misc") {
    form.innerHTML = `
      <div>
        <label class="text-xs text-slate-600">topic</label>
        <input id="miscTopic" class="w-full px-3 py-2 border rounded mt-1" />
      </div>
      <label class="text-xs text-slate-600 mt-3 block">content</label>
      <textarea id="content" class="w-full px-3 py-2 border rounded mt-1 h-24"></textarea>
    `;
    return;
  }

  form.innerHTML = `
    <label class="text-xs text-slate-600">content</label>
    <textarea id="content" class="w-full px-3 py-2 border rounded mt-1 h-32" placeholder="填写内容…"></textarea>
  `;
}

function updateSectionOptions() {
  const sel = $("section");
  if (!sel) return;

  const allowDescription = Boolean(selected && selected.__isNew);
  const cur = sel.value || "lecturer_review";

  const opts = [
    ...(allowDescription ? [{ value: "description", label: "description（说明，仅新建时建议填写）" }] : []),
    { value: "lecturer_review", label: "lecturers.reviews（老师评价）" },
    { value: "textbooks", label: "textbooks（教材）" },
    { value: "online_resources", label: "online_resources（网课/资源）" },
    { value: "course", label: "course（课程内容）" },
    { value: "exam", label: "exam（考试）" },
    { value: "lab", label: "lab（实验）" },
    { value: "advice", label: "advice（建议）" },
    { value: "schedule", label: "schedule（安排）" },
    { value: "related_links", label: "related_links（相关链接）" },
    { value: "misc", label: "misc（杂项）" },
  ];

  sel.innerHTML = "";
  for (const o of opts) {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
  }

  sel.value = opts.some((o) => o.value === cur) ? cur : (allowDescription ? "description" : "lecturer_review");
  buildForm();
}

function opsFromForm({ dryRun = false } = {}) {
  if (!selected) throw new Error("未选择课程");

  const sec = $("section").value;
  const a = author();

  const ops = [];
  if (sec === "description") {
    if (!selected.__isNew) {
      throw new Error("description 仅支持新建仓库流程填写（避免覆盖已有仓库）");
    }
    const content = ($("content").value || "").trimEnd();
    ops.push({ op: "set_description", content });
  } else if (sec === "lecturer_review") {
    const lecturer_name = ($("lecturerName").value || "").trim();
    const content = ($("content").value || "").trimEnd();
    ops.push({ op: "add_lecturer_review", lecturer_name, content, author: a });
  } else if (sec === "textbooks") {
    const fields = {
      title: ($("tbTitle").value || "").trim(),
      book_author: ($("tbAuthor").value || "").trim(),
      publisher: ($("tbPublisher").value || "").trim(),
      edition: ($("tbEdition").value || "").trim(),
      type: ($("tbType").value || "").trim(),
    };
    ops.push({ op: "append_section_item", section: "textbooks", item: fields });
  } else if (sec === "online_resources") {
    const item = {
      title: ($("orTitle").value || "").trim(),
      url: ($("orUrl").value || "").trim(),
      description: ($("content").value || "").trimEnd(),
      author: a,
    };
    ops.push({ op: "append_section_item", section: "online_resources", item });
  } else if (sec === "misc") {
    const item = {
      topic: ($("miscTopic").value || "").trim(),
      content: ($("content").value || "").trimEnd(),
      author: a,
    };
    ops.push({ op: "append_section_item", section: "misc", item });
  } else {
    const sectionMap = {
      course: "course",
      exam: "exam",
      lab: "lab",
      advice: "advice",
      schedule: "schedule",
      related_links: "related_links",
    };
    const section = sectionMap[sec];
    const item = { content: ($("content").value || "").trimEnd(), author: a };
    ops.push({ op: "append_section_item", section, item });
  }

  return {
    repo_name: selected.repo_name,
    course_code: selected.course_code || selected.repo_name,
    course_name: selected.course_name || selected.course_code || selected.repo_name,
    repo_type: selected.repo_type || "normal",
    ops,
    dry_run: dryRun,
  };
}

async function pollRequest(requestId) {
  const r = await apiGet(`/v1/requests/${requestId}`);
  const status = r.status || "";
  const prUrl = r.pr_url || "";
  const lastError = r.last_error || "";

  const base = `<div class="font-semibold">排队中（request_id=${escapeHtml(requestId)}）</div>
    <div class="text-sm mt-1">当前状态：<span class="mono">${escapeHtml(status)}</span></div>
    ${lastError ? `<div class="text-sm mt-1">错误：${escapeHtml(lastError)}</div>` : ""}
    <div class="text-xs mt-2 text-slate-700">提示：后台会按配置的轮询周期检查仓库是否创建并自动发 PR。</div>`;

  if (prUrl) {
    setSubmitStatus(
      `${base}<div class="text-sm mt-2">PR：<a class="underline" target="_blank" rel="noreferrer" href="${escapeHtml(prUrl)}">${escapeHtml(prUrl)}</a></div>`,
      { kind: "success" }
    );
    setToast({ type: "success", title: "PR 已创建", message: `request_id=${requestId}`, linkUrl: prUrl, linkText: "打开 PR" });
    stopPolling();
  } else {
    setSubmitStatus(
      `${base}<div class="mt-3 flex gap-2">
        <button id="stopPoll" class="px-2 py-1 text-xs border rounded bg-white/60">停止轮询</button>
        <button id="refreshPoll" class="px-2 py-1 text-xs border rounded bg-white/60">手动刷新</button>
      </div>`,
      { kind: "warn" }
    );
    $("stopPoll")?.addEventListener("click", () => stopPolling());
    $("refreshPoll")?.addEventListener("click", () => pollRequest(requestId).catch(showErr));
  }
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function doSubmit({ dryRun = false } = {}) {
  stopPolling();
  const payload = opsFromForm({ dryRun });
  $("result").textContent = "";
  setBusy(true, dryRun ? "生成中…" : "提交中…");
  setSubmitStatus(
    `<div class="font-semibold">${dryRun ? "正在生成 TOML…" : "正在提交…"}</div>
     <div class="text-sm mt-1">repo=<span class="mono">${escapeHtml(payload.repo_name || "")}</span></div>`,
    { kind: "info" }
  );
  setToast({ type: "info", title: dryRun ? "生成中" : "提交中", message: "请稍候…" });

  const data = await apiPost("/v1/courses/submit_ops", payload);
  $("result").textContent = JSON.stringify({ payload, response: data }, null, 2);

  if (data.status === "patched") {
    setSubmitStatus(
      `<div class="font-semibold">Dry-run 完成</div>
       <div class="text-sm mt-1">已生成 patched TOML（见下方详情）</div>`,
      { kind: "success" }
    );
    setToast({ type: "success", title: "Dry-run 完成", message: "已生成 TOML" });
    return;
  }

  if (data.status === "pr_created" && data.pr_url) {
    setSubmitStatus(
      `<div class="font-semibold">PR 已创建</div>
       <div class="text-sm mt-1">链接：<a class="underline" target="_blank" rel="noreferrer" href="${escapeHtml(data.pr_url)}">${escapeHtml(data.pr_url)}</a></div>`,
      { kind: "success" }
    );
    setToast({ type: "success", title: "PR 已创建", linkUrl: data.pr_url, linkText: "打开 PR" });
    await loadReadme();
    return;
  }

  if (data.status === "waiting_repo" && data.request_id) {
    const id = data.request_id;
    setSubmitStatus(
      `<div class="font-semibold">已进入排队</div>
       <div class="text-sm mt-1">request_id=<span class="mono">${escapeHtml(id)}</span></div>
       <div class="text-xs mt-2 text-slate-700">我会自动轮询状态；仓库创建后会自动创建 PR。</div>`,
      { kind: "warn" }
    );
    setToast({ type: "warn", title: "已进入排队", message: `request_id=${id}` });

    await pollRequest(id);
    pollTimer = setInterval(() => {
      pollRequest(id).catch((e) => {
        // don't spam UI
        console.error(e);
      });
    }, 5000);
    return;
  }

  setSubmitStatus(
    `<div class="font-semibold">已提交</div>
     <div class="text-sm mt-1">返回状态：<span class="mono">${escapeHtml(data.status || "")}</span></div>`,
    { kind: "info" }
  );
}

function showErr(e) {
  console.error(e);
  const msg = String(e && e.message ? e.message : e);
  setBusy(false);
  setToast({ type: "error", title: "操作失败", message: msg });
  setSubmitStatus(`<div class="font-semibold">操作失败</div><div class="text-sm mt-1">${escapeHtml(msg)}</div>`, { kind: "error" });
  $("result").textContent = msg;
  // Always show errors where user can see them.
  $("repoList").innerHTML = `<div class="p-3 text-sm text-red-700">${escapeHtml(msg)}<div class="text-xs text-slate-600 mt-2">提示：如果你把 API Base 填成了 <span class="mono">http://localhost:8000/web/</span>，请改为 <span class="mono">http://localhost:8000</span> 或留空。</div></div>`;
}

function setup() {
  $("apiBase").value = loadSetting("apiBase", "");
  $("apiKey").value = loadSetting("apiKey", "");

  $("apiBase").addEventListener("change", () => saveSetting("apiBase", $("apiBase").value));
  $("apiKey").addEventListener("change", () => saveSetting("apiKey", $("apiKey").value));

  $("tabPreview").addEventListener("click", () => setTab("preview"));
  $("tabEdit").addEventListener("click", () => setTab("edit"));
  $("reloadReadme").addEventListener("click", () => loadReadme().catch(showErr));

  $("refresh").addEventListener("click", () => refreshIndex({ force: true }).catch(showErr));
  $("search").addEventListener("input", () => renderRepoList(filterCourses()));
  $("section").addEventListener("change", () => {
    buildForm();
  });

  $("dryRun").addEventListener("click", () => doSubmit({ dryRun: true }).catch(showErr));
  $("submit").addEventListener("click", () => doSubmit({ dryRun: false }).catch(showErr));

  // New repo request flow
  $("toggleNew").addEventListener("click", () => {
    $("newRepoPanel").classList.toggle("hidden");
  });
  $("cancelNew").addEventListener("click", () => {
    $("newRepoPanel").classList.add("hidden");
  });
  $("startNew").addEventListener("click", () => {
    const course_code = ($("newCourseCode").value || "").trim();
    if (!course_code) return showErr(new Error("course_code 不能为空"));
    const course_name = ($("newCourseName").value || "").trim() || course_code;
    const repo_type = $("newRepoType").value;
    const repo_name = ($("newRepoName").value || "").trim() || course_code;
    selectCourse({ repo_name, course_code, course_name, repo_type, __isNew: true }).catch(showErr);
    $("newRepoPanel").classList.add("hidden");
    setTab("edit");
  });

  buildForm();
  updateSectionOptions();
  refreshIndex({ force: false }).catch(showErr);
}

setup();
