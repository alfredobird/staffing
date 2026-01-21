/* ========= SUPABASE CONFIG =========*/
const SUPABASE_URL = "https://iscorbmnboxytqgiqypq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_odsZMZ8KyDkMAkVN7QMclg_Ju5dDOPN";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ========= UI ELEMENTS ========= */
const tabs = document.querySelectorAll(".tab");
const tabPanels = {
  main: document.getElementById("tab-main"),
  gantt: document.getElementById("tab-gantt"),
  "pro-maint": document.getElementById("tab-pro-maint"),
  "proj-maint": document.getElementById("tab-proj-maint"),
};

const btnRefresh = document.getElementById("btnRefresh");
const btnImport = document.getElementById("btnImport");

const professionalsListEl = document.getElementById("professionalsList");
const projectsListEl = document.getElementById("projectsList");

const sortProsEl = document.getElementById("sortPros");
const proSearchEl = document.getElementById("proSearch");
const projectSearchEl = document.getElementById("projectSearch");

const prosTableEl = document.getElementById("prosTable");
const projectsTableEl = document.getElementById("projectsTable");

const btnAddPro = document.getElementById("btnAddPro");
const btnAddProject = document.getElementById("btnAddProject");
const btnAddRole = document.getElementById("btnAddRole");

const sortGanttEl = document.getElementById("sortGantt");
const ganttSearchEl = document.getElementById("ganttSearch");
const ganttRootEl = document.getElementById("ganttRoot");

/* ========= MODAL ========= */
const modalBackdrop = document.getElementById("modalBackdrop");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
const modalClose = document.getElementById("modalClose");
const modalCancel = document.getElementById("modalCancel");
const modalSave = document.getElementById("modalSave");

let modalState = null;

/* ========= DATA CACHE ========= */
let cache = {
  professionals: [],
  projects: [],
  roles: [],
  allocations: [],
};

const todayISO = () => new Date().toISOString().slice(0, 10);

function clampInt(n, min, max) {
  const x = Number.parseInt(n, 10);
  if (Number.isNaN(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return !(aEnd < bStart || aStart > bEnd);
}

function addDays(iso, days) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDateRange(a, b) {
  return `${a} → ${b}`;
}

/* ========= BANDWIDTH + AVAILABILITY ========= */
function allocationsForProfessional(pid) {
  return cache.allocations.filter(a => a.professional_id === pid);
}

function sumPercentAtDate(pid, kind, dateISO) {
  const allocs = allocationsForProfessional(pid).filter(a => a.kind === kind);
  let sum = 0;
  for (const a of allocs) {
    if (overlaps(a.start_date, a.end_date, dateISO, dateISO)) sum += a.percent;
  }
  return sum;
}

function remainingAtDate(pid, dateISO) {
  const actual = sumPercentAtDate(pid, "actual", dateISO);
  const proposed = sumPercentAtDate(pid, "proposed", dateISO);
  return 100 - actual - proposed;
}

function computeAvailableDate(pid) {
  const start = todayISO();
  const horizonWeeks = 26; // ~6 months (your definition)
  for (let w = 0; w <= horizonWeeks; w++) {
    const d = addDays(start, w * 7);
    const rem = remainingAtDate(pid, d);
    if (rem < 80) return d;
  }
  return "—";
}

function currentUtilSummary(pid) {
  const actual = sumPercentAtDate(pid, "actual", todayISO());
  const proposed = sumPercentAtDate(pid, "proposed", todayISO());
  const rem = 100 - actual - proposed;
  return { actual, proposed, rem };
}

function bandwidthDot(rem) {
  // green if above 80%, red if below 50%, yellow otherwise
  if (rem > 80) return "🟢";
  if (rem < 50) return "🔴";
  return "🟡";
}

function badgeForRemaining(rem) {
  if (rem < 0) return { cls: "danger", text: `${rem}% (OVER)` };
  if (rem < 20) return { cls: "warn", text: `${rem}%` };
  return { cls: "ok", text: `${rem}%` };
}

/* ========= SUPABASE IO ========= */
async function loadAll() {
  const [p1, p2, p3, p4] = await Promise.all([
    sb.from("professionals").select("*").order("full_name", { ascending: true }),
    sb.from("projects").select("*").order("start_date", { ascending: true }),
    sb.from("project_roles").select("*").order("start_date", { ascending: true }),
    sb.from("allocations").select("*"),
  ]);

  if (p1.error) throw p1.error;
  if (p2.error) throw p2.error;
  if (p3.error) throw p3.error;
  if (p4.error) throw p4.error;

  cache.professionals = p1.data || [];
  cache.projects = p2.data || [];
  cache.roles = p3.data || [];
  cache.allocations = p4.data || [];
}

async function createAllocation({ professional_id, project_id, project_role_id, kind, percent, start_date, end_date }) {
  const pct = clampInt(percent, 0, 100);

  // Guard: prevent exceeding 100% at allocation start date
  const actualAtStart = sumPercentAtDate(professional_id, "actual", start_date);
  const proposedAtStart = sumPercentAtDate(professional_id, "proposed", start_date);

  const nextTotal =
    (kind === "actual" ? (actualAtStart + pct) : actualAtStart) +
    (kind === "proposed" ? (proposedAtStart + pct) : proposedAtStart);

  if (nextTotal > 100) {
    alert(`Cannot assign: total utilization would be ${nextTotal}% (> 100%).`);
    return null;
  }

  const ins = await sb.from("allocations").insert([{
    professional_id,
    project_id,
    project_role_id,
    kind,
    percent: pct,
    start_date,
    end_date
  }]).select().single();

  if (ins.error) throw ins.error;
  return ins.data;
}

async function deleteAllocation(allocationId) {
  const res = await sb.from("allocations").delete().eq("id", allocationId);
  if (res.error) throw res.error;
}

async function updateRow(table, id, patch) {
  const res = await sb.from(table).update(patch).eq("id", id).select().single();
  if (res.error) throw res.error;
  return res.data;
}

async function deleteRow(table, id) {
  const res = await sb.from(table).delete().eq("id", id);
  if (res.error) throw res.error;
}

/* ========= RENDER ========= */
function render() {
  renderMain();
  renderProMaintenance();
  renderProjectMaintenance();
  renderGantt();
}

/* ========= MAIN ========= */
function renderMain() {
  const search = (proSearchEl?.value || "").toLowerCase().trim();
  const sortMode = sortProsEl?.value || "name";

  const proComputed = (cache.professionals || []).map(p => {
    const util = currentUtilSummary(p.id);
    const available = computeAvailableDate(p.id);
    return { ...p, _util: util, _available: available };
  });

  let filtered = proComputed.filter(p =>
    (p.full_name + " " + p.title).toLowerCase().includes(search)
  );

  if (sortMode === "name") {
    filtered.sort((a, b) => a.full_name.localeCompare(b.full_name));
  } else {
    filtered.sort((a, b) => {
      const da = a._available === "—" ? "9999-12-31" : a._available;
      const db = b._available === "—" ? "9999-12-31" : b._available;
      return da.localeCompare(db) || a.full_name.localeCompare(b.full_name);
    });
  }

  if (professionalsListEl) {
    professionalsListEl.innerHTML = "";
    for (const p of filtered) professionalsListEl.appendChild(renderProfessionalCard(p));
  }

  const pSearch = (projectSearchEl?.value || "").toLowerCase().trim();
  if (projectsListEl) {
    projectsListEl.innerHTML = "";
    for (const proj of (cache.projects || [])) {
      const roles = (cache.roles || []).filter(r => r.project_id === proj.id);
      const matches = (proj.name + " " + roles.map(r => r.role_name).join(" ")).toLowerCase().includes(pSearch);
      if (!matches) continue;
      projectsListEl.appendChild(renderProjectBlock(proj, roles));
    }
  }
}

function renderProfessionalCard(p) {
  const card = document.createElement("div");
  card.className = "card";
  card.dataset.professionalId = p.id;
  card.draggable = true;

  const { actual, proposed, rem } = p._util;
  const badge = badgeForRemaining(rem);
  const available = p._available;
  const dot = bandwidthDot(rem);

  const allocs = allocationsForProfessional(p.id);
  const actualAlloc = allocs.filter(a => a.kind === "actual");
  const proposedAlloc = allocs.filter(a => a.kind === "proposed");

  card.innerHTML = `
    <div class="card-title">
      <div>
        <div class="name">${dot} ${escapeHtml(p.full_name)}</div>
        <div class="sub">${escapeHtml(p.title)}</div>
      </div>
      <div class="badge ${badge.cls}">Remaining: ${badge.text}</div>
    </div>

    <div class="kv">
      <div>Sold Utilization (today)</div><b>${actual}%</b>
      <div>Proposed Utilization (today)</div><b>${proposed}%</b>
      <div>Available Date (rem &lt; 80%)</div><b>${available}</b>
    </div>

    <div class="allocs">
      <div class="small">Current/Upcoming Assignments</div>
      ${actualAlloc.length ? actualAlloc.map(a => renderAllocLineWithDelete(a)).join("") : `<div class="small">—</div>`}
      <div class="small" style="margin-top:6px;">Proposed</div>
      ${proposedAlloc.length ? proposedAlloc.map(a => renderAllocLineWithDelete(a)).join("") : `<div class="small">—</div>`}
    </div>
  `;

  // delete assignment
  card.querySelectorAll("[data-del-alloc]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-del-alloc");
      if (!id) return;
      if (!confirm("Remove this assignment?")) return;
      await deleteAllocation(id);
      await refresh();
    });
  });

  // drag professional -> role
  card.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", JSON.stringify({
      type: "professional",
      professional_id: p.id
    }));
  });

  // drop role -> professional
  card.addEventListener("dragover", (e) => {
    e.preventDefault();
    card.classList.add("dragover");
  });
  card.addEventListener("dragleave", () => card.classList.remove("dragover"));
  card.addEventListener("drop", async (e) => {
    e.preventDefault();
    card.classList.remove("dragover");
    const payload = safeParse(e.dataTransfer.getData("text/plain"));
    if (!payload || payload.type !== "role") return;

    const role = (cache.roles || []).find(r => r.id === payload.project_role_id);
    const proj = (cache.projects || []).find(pr => pr.id === payload.project_id);
    if (!role || !proj) return;

    await assignmentFlow({
      professional_id: p.id,
      project_id: proj.id,
      project_role_id: role.id,
      defaultPercent: role.required_percent,
      defaultStart: role.start_date,
      defaultEnd: role.end_date,
      kind: "actual",
      label: `Assign ${p.full_name} → ${proj.name} / ${role.role_name}`
    });
  });

  return card;
}

function renderAllocLineWithDelete(a) {
  const proj = (cache.projects || []).find(p => p.id === a.project_id);
  const role = a.project_role_id ? (cache.roles || []).find(r => r.id === a.project_role_id) : null;
  const left = `${escapeHtml(proj?.name || "Project")} · ${escapeHtml(role?.role_name || "Role")}`;
  const right = `${a.percent}% · ${formatDateRange(a.start_date, a.end_date)}`;

  return `
    <div class="alloc" style="align-items:center;">
      <div class="left">${left}</div>
      <div class="right" style="display:flex; align-items:center; gap:10px;">
        <span>${escapeHtml(right)}</span>
        <button class="alloc-x" title="Remove assignment" data-del-alloc="${a.id}">✕</button>
      </div>
    </div>
  `;
}

/* ========= Projects pane: show assignees per role ========= */
function roleAssignees(roleId) {
  const allocs = (cache.allocations || []).filter(a => a.project_role_id === roleId);
  const byPro = new Map(); // pid -> { name, hasActual, hasProposed }

  for (const a of allocs) {
    const pro = (cache.professionals || []).find(p => p.id === a.professional_id);
    if (!pro) continue;
    const cur = byPro.get(pro.id) || { name: pro.full_name, hasActual: false, hasProposed: false };
    if (a.kind === "actual") cur.hasActual = true;
    if (a.kind === "proposed") cur.hasProposed = true;
    byPro.set(pro.id, cur);
  }

  return Array.from(byPro.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function renderProjectBlock(proj, roles) {
  const wrap = document.createElement("div");
  wrap.className = "project";

  wrap.innerHTML = `
    <div class="project-head">
      <div>
        <div class="project-name">${escapeHtml(proj.name)}</div>
        <div class="sub">${proj.start_date} → ${proj.end_date}</div>
      </div>
      <div class="badge">Drag & drop</div>
    </div>
    <div class="roles"></div>
  `;

  const rolesEl = wrap.querySelector(".roles");
  for (const r of roles) {
    const assignees = roleAssignees(r.id);

    const chips = assignees.length
      ? assignees.map(a => {
        const parts = [
          a.hasActual ? `<span class="pill actual"><b>A</b> ${escapeHtml(a.name)}</span>` : "",
          a.hasProposed ? `<span class="pill proposed"><b>P</b> ${escapeHtml(a.name)}</span>` : ""
        ].filter(Boolean);
        return parts.join("");
      }).join("")
      : `<span class="small">No assignees</span>`;

    const roleEl = document.createElement("div");
    roleEl.className = "role";
    roleEl.dataset.roleId = r.id;
    roleEl.draggable = true;

    roleEl.innerHTML = `
      <div style="min-width: 0;">
        <div><b>${escapeHtml(r.role_name)}</b></div>
        <div class="meta">${r.start_date} → ${r.end_date}</div>
        <div style="margin-top:8px; display:flex; flex-wrap:wrap; gap:6px;">
          ${chips}
        </div>
      </div>
      <div class="pct">Needs: ${r.required_percent}%</div>
    `;

    // drag role -> professional
    roleEl.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", JSON.stringify({
        type: "role",
        project_id: proj.id,
        project_role_id: r.id
      }));
    });

    // drop professional -> role
    roleEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      roleEl.classList.add("dragover");
    });
    roleEl.addEventListener("dragleave", () => roleEl.classList.remove("dragover"));
    roleEl.addEventListener("drop", async (e) => {
      e.preventDefault();
      roleEl.classList.remove("dragover");
      const payload = safeParse(e.dataTransfer.getData("text/plain"));
      if (!payload || payload.type !== "professional") return;

      const professional = (cache.professionals || []).find(p => p.id === payload.professional_id);
      if (!professional) return;

      await assignmentFlow({
        professional_id: professional.id,
        project_id: proj.id,
        project_role_id: r.id,
        defaultPercent: r.required_percent,
        defaultStart: r.start_date,
        defaultEnd: r.end_date,
        kind: "actual",
        label: `Assign ${professional.full_name} → ${proj.name} / ${r.role_name}`
      });
    });

    rolesEl.appendChild(roleEl);
  }

  return wrap;
}

/* ========= PROFESSIONALS MAINT ========= */
function renderProMaintenance() {
  if (!prosTableEl) return;
  prosTableEl.innerHTML = "";

  for (const p of (cache.professionals || [])) {
    const row = document.createElement("div");
    row.className = "table-row";
    row.innerHTML = `
      <div><b>${escapeHtml(p.full_name)}</b><div class="sub">${escapeHtml(p.title)}</div></div>
      <div class="sub">ID: <span style="font-family:var(--mono)">${p.id.slice(0, 8)}…</span></div>
      <div class="sub">Updated: ${p.updated_at ? new Date(p.updated_at).toLocaleString() : "—"}</div>
      <div class="actions">
        <button class="btn ghost" data-act="edit">Edit</button>
        <button class="btn ghost" data-act="delete" style="border-color:rgba(255,107,107,.35); color:var(--danger)">Delete</button>
      </div>
    `;
    row.querySelector('[data-act="edit"]').addEventListener("click", () => openProModal(p));
    row.querySelector('[data-act="delete"]').addEventListener("click", async () => {
      if (!confirm(`Delete professional "${p.full_name}"? This also deletes allocations.`)) return;
      await deleteRow("professionals", p.id);
      await refresh();
    });
    prosTableEl.appendChild(row);
  }
}

/* ========= PROJECTS MAINT ========= */
function renderProjectMaintenance() {
  if (!projectsTableEl) return;
  projectsTableEl.innerHTML = "";

  for (const proj of (cache.projects || [])) {
    const row = document.createElement("div");
    row.className = "table-row";
    row.innerHTML = `
      <div><b>${escapeHtml(proj.name)}</b><div class="sub">${proj.start_date} → ${proj.end_date}</div></div>
      <div class="sub">${(cache.roles || []).filter(r => r.project_id === proj.id).length} roles</div>
      <div class="sub">Updated: ${proj.updated_at ? new Date(proj.updated_at).toLocaleString() : "—"}</div>
      <div class="actions">
        <button class="btn ghost" data-act="edit">Edit</button>
        <button class="btn ghost" data-act="delete" style="border-color:rgba(255,107,107,.35); color:var(--danger)">Delete</button>
      </div>
    `;

    row.querySelector('[data-act="edit"]').addEventListener("click", () => openProjectModal(proj));
    row.querySelector('[data-act="delete"]').addEventListener("click", async () => {
      if (!confirm(`Delete project "${proj.name}"? This deletes roles & allocations.`)) return;
      await deleteRow("projects", proj.id);
      await refresh();
    });

    const roleList = document.createElement("div");
    roleList.className = "card";
    roleList.style.marginTop = "10px";

    const roles = (cache.roles || []).filter(r => r.project_id === proj.id);
    roleList.innerHTML = `
      <div class="small" style="margin-bottom:10px;">Roles</div>
      ${roles.length ? roles.map(r => `
        <div class="alloc" style="align-items:center;">
          <div class="left">
            <b>${escapeHtml(r.role_name)}</b>
            <div class="sub">${r.start_date} → ${r.end_date}</div>
          </div>
          <div class="right">
            ${r.required_percent}%
            <button class="btn ghost" data-role-edit="${r.id}" style="margin-left:10px;">Edit</button>
            <button class="btn ghost" data-role-del="${r.id}" style="margin-left:8px; border-color:rgba(255,107,107,.35); color:var(--danger)">Delete</button>
          </div>
        </div>
      `).join("") : `<div class="small">—</div>`}
    `;

    roleList.querySelectorAll("[data-role-edit]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-role-edit");
        const role = (cache.roles || []).find(r => r.id === id);
        openRoleModal(role);
      });
    });

    roleList.querySelectorAll("[data-role-del]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-role-del");
        const role = (cache.roles || []).find(r => r.id === id);
        if (!role) return;
        if (!confirm(`Delete role "${role.role_name}"?`)) return;
        await deleteRow("project_roles", role.id);
        await refresh();
      });
    });

    projectsTableEl.appendChild(row);
    projectsTableEl.appendChild(roleList);
  }
}

/* ========= GANTT (ALWAYS RENDERS ROWS) ========= */
function renderGantt() {
  if (!ganttRootEl) return;

  try {
    const search = (ganttSearchEl?.value || "").toLowerCase().trim();
    const sortMode = sortGanttEl?.value || "name";

    let computed = (cache.professionals || [])
      .map(p => {
        const util = currentUtilSummary(p.id);
        const available = computeAvailableDate(p.id);
        return { ...p, _util: util, _available: available };
      })
      .filter(p => (p.full_name + " " + p.title).toLowerCase().includes(search));

    if (sortMode === "name") {
      computed.sort((a, b) => a.full_name.localeCompare(b.full_name));
    } else {
      computed.sort((a, b) => {
        const da = a._available === "—" ? "9999-12-31" : a._available;
        const db = b._available === "—" ? "9999-12-31" : b._available;
        return da.localeCompare(db) || a.full_name.localeCompare(b.full_name);
      });
    }

    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 12, 1));

    const months = Array.from({ length: 12 }, (_, i) =>
      new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1))
    );
    const monthLabel = (d) => d.toLocaleString(undefined, { month: "short", year: "2-digit" });
    const clamp01 = (x) => Math.max(0, Math.min(1, x));

    ganttRootEl.innerHTML = `
      <div class="gantt-header">
        <div class="gantt-left">
          <div style="font-weight:700;">Professional</div>
          <div class="small">Bars show allocations (Actual + Proposed)</div>
        </div>
        <div class="gantt-right">
          <div class="gantt-months">
            ${months.map(m => `<div class="gantt-month">${escapeHtml(monthLabel(m))}</div>`).join("")}
          </div>
        </div>
      </div>
    `;

    if (!computed.length) {
      const empty = document.createElement("div");
      empty.className = "card";
      empty.style.margin = "12px";
      empty.innerHTML = `
        <div class="name">No professionals to display</div>
        <div class="sub">Create professionals or check your Supabase RLS policies.</div>
      `;
      ganttRootEl.appendChild(empty);
      return;
    }

    const winStartISO = start.toISOString().slice(0, 10);
    const winEndISO = new Date(end.getTime() - 1).toISOString().slice(0, 10);

    for (const p of computed) {
      const { actual, proposed, rem } = p._util;
      const dot = bandwidthDot(rem);
      const badge = badgeForRemaining(rem);

      const row = document.createElement("div");
      row.className = "gantt-row";

      const left = document.createElement("div");
      left.className = "gantt-person";
      left.innerHTML = `
        <div class="top">
          <div style="font-weight:700; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            ${dot} ${escapeHtml(p.full_name)}
          </div>
          <div class="badge ${badge.cls}" style="margin-left:auto;">${rem}%</div>
        </div>
        <div class="sub">${escapeHtml(p.title)}</div>
        <div class="meta">
          <div>Sold (today)</div><b>${actual}%</b>
          <div>Proposed (today)</div><b>${proposed}%</b>
          <div>Available Date</div><b>${p._available}</b>
        </div>
      `;

      const lane = document.createElement("div");
      lane.className = "gantt-lane";

      const grid = document.createElement("div");
      grid.className = "gantt-grid";
      for (let i = 0; i < 12; i++) {
        const cell = document.createElement("div");
        cell.className = "gantt-cell";
        grid.appendChild(cell);
      }
      lane.appendChild(grid);

      const allocs = allocationsForProfessional(p.id)
        .filter(a => overlaps(a.start_date, a.end_date, winStartISO, winEndISO))
        .sort((a, b) => (a.start_date || "").localeCompare(b.start_date || ""));

      for (const a of allocs) {
        const bar = document.createElement("div");
        bar.className = "gantt-bar" + (a.kind === "proposed" ? " proposed" : "");

        const proj = (cache.projects || []).find(x => x.id === a.project_id);
        const role = a.project_role_id ? (cache.roles || []).find(x => x.id === a.project_role_id) : null;
        const label = `${proj?.name || "Project"} · ${role?.role_name || "Role"} · ${a.percent}%`;

        const startMs = Date.parse(a.start_date + "T00:00:00Z");
        const endMs = Date.parse(a.end_date + "T23:59:59Z");
        const winStartMs = start.getTime();
        const winEndMs = end.getTime();

        const leftPct = clamp01((startMs - winStartMs) / (winEndMs - winStartMs));
        const rightPct = clamp01((endMs - winStartMs) / (winEndMs - winStartMs));
        const widthPct = Math.max(0.006, rightPct - leftPct);

        bar.style.left = `calc(${(leftPct * 100).toFixed(4)}% + 12px)`;
        bar.style.width = `calc(${(widthPct * 100).toFixed(4)}% - 24px)`;
        bar.title = `${a.kind.toUpperCase()} · ${label}\n${formatDateRange(a.start_date, a.end_date)}`;
        bar.textContent = (a.kind === "proposed" ? "P: " : "A: ") + label;

        lane.appendChild(bar);
      }

      row.appendChild(left);
      row.appendChild(lane);
      ganttRootEl.appendChild(row);
    }
  } catch (err) {
    console.error(err);
    ganttRootEl.innerHTML = `
      <div class="card" style="margin:12px; border-color: rgba(255,107,107,.35);">
        <div class="name">Gantt failed to render</div>
        <div class="sub">Copy this error if you want me to pinpoint it:</div>
        <div style="margin-top:10px; font-family: var(--mono); color: var(--danger); white-space: pre-wrap;">${escapeHtml(err?.stack || err?.message || String(err))}</div>
      </div>
    `;
  }
}

/* ========= ASSIGNMENT FLOW ========= */
async function assignmentFlow({ professional_id, project_id, project_role_id, defaultPercent, defaultStart, defaultEnd, kind, label }) {
  openModal({
    title: label,
    bodyHtml: `
      <div class="form">
        <div class="field">
          <div class="label">Allocation kind</div>
          <select id="allocKind" class="input">
            <option value="actual"${kind === "actual" ? " selected" : ""}>Actual (Sold)</option>
            <option value="proposed">Proposed</option>
          </select>
        </div>
        <div class="field">
          <div class="label">Percent (0–100)</div>
          <input id="allocPercent" class="input" type="number" min="0" max="100" value="${defaultPercent ?? 0}"/>
        </div>
        <div class="field">
          <div class="label">Start date</div>
          <input id="allocStart" class="input" type="date" value="${defaultStart ?? todayISO()}"/>
        </div>
        <div class="field">
          <div class="label">End date</div>
          <input id="allocEnd" class="input" type="date" value="${defaultEnd ?? todayISO()}"/>
        </div>
        <div class="full small">
          Constraint: total utilization for the professional must be ≤ 100% (checked at allocation start).
        </div>
      </div>
    `,
    onSave: async () => {
      const kindSel = document.getElementById("allocKind").value;
      const percent = clampInt(document.getElementById("allocPercent").value, 0, 100);
      const start_date = document.getElementById("allocStart").value;
      const end_date = document.getElementById("allocEnd").value;

      if (!start_date || !end_date) { alert("Please provide start/end dates."); return false; }
      if (end_date < start_date) { alert("End date cannot be before start date."); return false; }

      await createAllocation({
        professional_id,
        project_id,
        project_role_id,
        kind: kindSel,
        percent,
        start_date,
        end_date
      });

      await refresh();
      return true;
    }
  });
}

/* ========= MODALS CORE ========= */
function openModal({ title, bodyHtml, onSave }) {
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHtml;
  modalState = { onSave };
  modalBackdrop.classList.remove("hidden");
}
function closeModal() {
  modalBackdrop.classList.add("hidden");
  modalState = null;
}
modalClose?.addEventListener("click", closeModal);
modalCancel?.addEventListener("click", closeModal);
modalBackdrop?.addEventListener("click", (e) => {
  if (e.target === modalBackdrop) closeModal();
});
modalSave?.addEventListener("click", async () => {
  if (!modalState?.onSave) return closeModal();
  try {
    const ok = await modalState.onSave();
    if (ok) closeModal();
  } catch (e) {
    console.error(e);
    alert(e.message || String(e));
  }
});

/* ========= CRUD MODALS (WORKING) ========= */
function openProModal(p) {
  const isNew = !p;
  openModal({
    title: isNew ? "Add Professional" : "Edit Professional",
    bodyHtml: `
      <div class="form">
        <div class="field full">
          <div class="label">Full name</div>
          <input id="proName" class="input" value="${escapeAttr(p?.full_name || "")}" />
        </div>
        <div class="field full">
          <div class="label">Title</div>
          <input id="proTitle" class="input" value="${escapeAttr(p?.title || "")}" />
        </div>
      </div>
    `,
    onSave: async () => {
      const full_name = document.getElementById("proName").value.trim();
      const title = document.getElementById("proTitle").value.trim();
      if (!full_name || !title) { alert("Name and title are required."); return false; }

      if (isNew) {
        const res = await sb.from("professionals").insert([{ full_name, title }]);
        if (res.error) throw res.error;
      } else {
        await updateRow("professionals", p.id, { full_name, title });
      }
      await refresh();
      return true;
    }
  });
}

function openProjectModal(proj) {
  const isNew = !proj;
  openModal({
    title: isNew ? "Add Project" : "Edit Project",
    bodyHtml: `
      <div class="form">
        <div class="field full">
          <div class="label">Project name</div>
          <input id="projName" class="input" value="${escapeAttr(proj?.name || "")}" />
        </div>
        <div class="field">
          <div class="label">Start date</div>
          <input id="projStart" class="input" type="date" value="${escapeAttr(proj?.start_date || todayISO())}" />
        </div>
        <div class="field">
          <div class="label">End date</div>
          <input id="projEnd" class="input" type="date" value="${escapeAttr(proj?.end_date || todayISO())}" />
        </div>
      </div>
    `,
    onSave: async () => {
      const name = document.getElementById("projName").value.trim();
      const start_date = document.getElementById("projStart").value;
      const end_date = document.getElementById("projEnd").value;

      if (!name || !start_date || !end_date) { alert("All fields required."); return false; }
      if (end_date < start_date) { alert("End date cannot be before start date."); return false; }

      if (isNew) {
        const res = await sb.from("projects").insert([{ name, start_date, end_date }]);
        if (res.error) throw res.error;
      } else {
        await updateRow("projects", proj.id, { name, start_date, end_date });
      }
      await refresh();
      return true;
    }
  });
}

function openRoleModal(role) {
  const isNew = !role;
  const projectOptions = (cache.projects || [])
    .map(p => `<option value="${p.id}"${role?.project_id === p.id ? " selected" : ""}>${escapeHtml(p.name)}</option>`)
    .join("");

  openModal({
    title: isNew ? "Add Role" : "Edit Role",
    bodyHtml: `
      <div class="form">
        <div class="field full">
          <div class="label">Project</div>
          <select id="roleProject" class="input">
            ${projectOptions || `<option value="">(Create a project first)</option>`}
          </select>
        </div>
        <div class="field full">
          <div class="label">Role name</div>
          <input id="roleName" class="input" value="${escapeAttr(role?.role_name || "")}" />
        </div>
        <div class="field">
          <div class="label">Start date</div>
          <input id="roleStart" class="input" type="date" value="${escapeAttr(role?.start_date || todayISO())}" />
        </div>
        <div class="field">
          <div class="label">End date</div>
          <input id="roleEnd" class="input" type="date" value="${escapeAttr(role?.end_date || todayISO())}" />
        </div>
        <div class="field">
          <div class="label">Required percent (0–100)</div>
          <input id="roleReq" class="input" type="number" min="0" max="100" value="${role?.required_percent ?? 0}" />
        </div>
      </div>
    `,
    onSave: async () => {
      const project_id = document.getElementById("roleProject").value;
      const role_name = document.getElementById("roleName").value.trim();
      const start_date = document.getElementById("roleStart").value;
      const end_date = document.getElementById("roleEnd").value;
      const required_percent = clampInt(document.getElementById("roleReq").value, 0, 100);

      if (!project_id) { alert("Select a project."); return false; }
      if (!role_name || !start_date || !end_date) { alert("All fields required."); return false; }
      if (end_date < start_date) { alert("End date cannot be before start date."); return false; }

      if (isNew) {
        const res = await sb.from("project_roles").insert([{
          project_id, role_name, start_date, end_date, required_percent
        }]);
        if (res.error) throw res.error;
      } else {
        await updateRow("project_roles", role.id, {
          project_id, role_name, start_date, end_date, required_percent
        });
      }
      await refresh();
      return true;
    }
  });
}

/* ========= Maintenance buttons ========= */
btnAddPro?.addEventListener("click", () => openProModal(null));
btnAddProject?.addEventListener("click", () => openProjectModal(null));
btnAddRole?.addEventListener("click", () => openRoleModal(null));

/* ========= Tabs + Events ========= */
tabs.forEach(t => {
  t.addEventListener("click", () => {
    tabs.forEach(x => x.classList.remove("active"));
    t.classList.add("active");
    const key = t.dataset.tab;
    Object.entries(tabPanels).forEach(([k, el]) => el && el.classList.toggle("active", k === key));
    if (key === "gantt") renderGantt();
  });
});

btnRefresh?.addEventListener("click", () => refresh());

sortProsEl?.addEventListener("change", renderMain);
proSearchEl?.addEventListener("input", renderMain);
projectSearchEl?.addEventListener("input", renderMain);

sortGanttEl?.addEventListener("change", renderGantt);
ganttSearchEl?.addEventListener("input", renderGantt);

btnImport?.addEventListener("click", () => {
  if (typeof openImportModal === "function") return openImportModal();
  alert("Import modal not found in this app.js. If you want, I can paste the full openImportModal() implementation again.");
});

/* ========= INIT ========= */
async function refresh() {
  try {
    await loadAll();
    render();
  } catch (e) {
    console.error(e);
    alert(e.message || String(e));
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;").replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll("\n", " ");
}

refresh();
