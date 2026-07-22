let allReports = [];
let allProfiles = [];
let profileLookup = {};
let adminMap = null;
let currentAdminId = null;

// ---------- Auth guard ----------
(async function init() {
  const user = await getCurrentUser();
  if (!user) {
    goTo("login.html");
    return;
  }

  const profile = await getProfile(user.id);
  if (!profile || profile.role !== "admin") {
    goTo("citizen-dashboard.html");
    return;
  }

  currentAdminId = user.id;
  document.getElementById("adminName").textContent = profile.full_name;
  document.getElementById("adminEmail").textContent = user.email;

  setupSidebar();
  setupToolbarFilters();
  setupCategoryForm();
  document.getElementById("exportPdfBtn").addEventListener("click", exportPdfSummary);

  await loadProfiles();
  await loadReports();
  await loadCategories();
})();

document.getElementById("logoutBtn").addEventListener("click", signOut);

// ---------- Sidebar navigation ----------
function setupSidebar() {
  const buttons = document.querySelectorAll(".side-nav button[data-panel]");
  const titles = {
    overview: "Overview",
    reports: "Reports",
    map: "Hotspot Map",
    users: "Users",
    categories: "Categories"
  };

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.panel;

      buttons.forEach((b) => b.classList.toggle("active", b.dataset.panel === target));
      document.querySelectorAll(".admin-panel").forEach((p) => {
        p.classList.toggle("active", p.id === `admin-${target}`);
      });
      document.getElementById("pageTitle").textContent = titles[target];
      document.getElementById("sidebar").classList.remove("open");
      document.getElementById("sidebarBackdrop").classList.remove("show");

      if (target === "map") {
        initOrRefreshMap();
      }
    });
  });

  document.getElementById("sidebarToggle").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("open");
    document.getElementById("sidebarBackdrop").classList.toggle("show");
  });

  document.getElementById("sidebarBackdrop").addEventListener("click", () => {
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("sidebarBackdrop").classList.remove("show");
  });
}

// ---------- Data loading ----------
async function loadProfiles() {
  const { data, error } = await supabaseClient.from("profiles").select("*");
  if (error) {
    console.error("Failed to load profiles:", error.message);
    return;
  }
  allProfiles = data || [];
  profileLookup = {};
  allProfiles.forEach((p) => (profileLookup[p.id] = p));
  renderUsersTable(allProfiles);
}

async function loadReports() {
  const { data, error } = await supabaseClient
    .from("reports")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    document.getElementById("reportsTableBody").innerHTML =
      `<tr><td colspan="6"><div class="empty-state">Could not load reports: ${error.message}</div></td></tr>`;
    return;
  }

  allReports = data || [];
  renderStats(allReports);
  renderReportsTable(allReports);
}

// ---------- Overview ----------
function renderStats(reports) {
  const total = reports.length;
  const counts = { Pending: 0, "Under Review": 0, Resolved: 0, Rejected: 0 };
  const categoryCounts = {};

  reports.forEach((r) => {
    if (counts[r.status] !== undefined) counts[r.status]++;
    categoryCounts[r.category] = (categoryCounts[r.category] || 0) + 1;
  });

  document.getElementById("statGrid").innerHTML = `
    <div class="card stat-card"><div class="stat-value">${total}</div><div class="stat-label">Total reports</div></div>
    <div class="card stat-card"><div class="stat-value">${counts.Pending}</div><div class="stat-label">Pending</div></div>
    <div class="card stat-card"><div class="stat-value">${counts["Under Review"]}</div><div class="stat-label">Under review</div></div>
    <div class="card stat-card"><div class="stat-value">${counts.Resolved}</div><div class="stat-label">Resolved</div></div>
    <div class="card stat-card"><div class="stat-value">${counts.Rejected}</div><div class="stat-label">Rejected</div></div>
  `;

  const maxCategory = Math.max(1, ...Object.values(categoryCounts));
  document.getElementById("categoryBreakdown").innerHTML =
    Object.entries(categoryCounts).length === 0
      ? `<div class="empty-state">No reports yet.</div>`
      : Object.entries(categoryCounts)
          .sort((a, b) => b[1] - a[1])
          .map(
            ([cat, count]) => `
        <div class="bar-row">
          <div class="bar-row-label"><span>${cat}</span><span>${count}</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${(count / maxCategory) * 100}%"></div></div>
        </div>`
          )
          .join("");

  const maxStatus = Math.max(1, ...Object.values(counts));
  document.getElementById("statusBreakdown").innerHTML = Object.entries(counts)
    .map(
      ([status, count]) => `
        <div class="bar-row">
          <div class="bar-row-label"><span>${status}</span><span>${count}</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${(count / maxStatus) * 100}%"></div></div>
        </div>`
    )
    .join("");
}

// ---------- Reports table ----------
function setupToolbarFilters() {
  document.getElementById("reportSearch").addEventListener("input", applyReportFilters);
  document.getElementById("statusFilter").addEventListener("change", applyReportFilters);
  document.getElementById("userSearch").addEventListener("input", applyUserFilter);
}

function applyReportFilters() {
  const term = document.getElementById("reportSearch").value.trim().toLowerCase();
  const status = document.getElementById("statusFilter").value;

  const filtered = allReports.filter((r) => {
    const matchesTerm =
      !term || r.title.toLowerCase().includes(term) || r.category.toLowerCase().includes(term);
    const matchesStatus = !status || r.status === status;
    return matchesTerm && matchesStatus;
  });

  renderReportsTable(filtered);
}

function renderReportsTable(reports) {
  const body = document.getElementById("reportsTableBody");

  if (reports.length === 0) {
    body.innerHTML = `<tr><td colspan="6"><div class="empty-state">No reports match your filters.</div></td></tr>`;
    return;
  }

  body.innerHTML = reports
    .map((r) => {
      const date = new Date(r.created_at).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
      });

      const filedBy = r.is_anonymous
        ? "Anonymous"
        : profileLookup[r.user_id]?.full_name || "Unknown citizen";

      const location =
        r.latitude && r.longitude
          ? `<a href="https://www.openstreetmap.org/?mlat=${r.latitude}&mlon=${r.longitude}#map=16/${r.latitude}/${r.longitude}" target="_blank" rel="noopener">View</a>`
          : `<span style="color:var(--color-slate-400);">None</span>`;

      return `
        <tr>
          <td>${escapeHtml(r.title)}</td>
          <td>${r.category}</td>
          <td>${escapeHtml(filedBy)}</td>
          <td>${date}</td>
          <td class="link-cell">${location}</td>
          <td>
            <select data-report-id="${r.id}" class="status-select">
              ${REPORT_STATUSES.map(
                (s) => `<option value="${s}" ${s === r.status ? "selected" : ""}>${s}</option>`
              ).join("")}
            </select>
          </td>
        </tr>`;
    })
    .join("");

  body.querySelectorAll(".status-select").forEach((select) => {
    select.addEventListener("change", async () => {
      const reportId = select.dataset.reportId;
      const newStatus = select.value;

      const { error } = await supabaseClient
        .from("reports")
        .update({ status: newStatus })
        .eq("id", reportId);

      if (error) {
        alert(`Could not update status: ${error.message}`);
        return;
      }

      const report = allReports.find((r) => r.id === reportId);
      if (report) report.status = newStatus;
      renderStats(allReports);
    });
  });
}

// ---------- Hotspot map ----------
function initOrRefreshMap() {
  const pinned = allReports.filter((r) => r.latitude && r.longitude);

  if (!adminMap) {
    adminMap = L.map("adminMap").setView([0.3476, 32.5825], 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19
    }).addTo(adminMap);
  } else {
    setTimeout(() => adminMap.invalidateSize(), 50);
  }

  pinned.forEach((r) => {
    L.marker([r.latitude, r.longitude])
      .addTo(adminMap)
      .bindPopup(`<strong>${escapeHtml(r.title)}</strong><br>${r.category}<br>${r.status}`);
  });
}

// ---------- Users table ----------
function applyUserFilter() {
  const term = document.getElementById("userSearch").value.trim().toLowerCase();
  const filtered = allProfiles.filter((p) => (p.full_name || "").toLowerCase().includes(term));
  renderUsersTable(filtered);
}

function renderUsersTable(profiles) {
  const body = document.getElementById("usersTableBody");

  if (profiles.length === 0) {
    body.innerHTML = `<tr><td colspan="4"><div class="empty-state">No users found.</div></td></tr>`;
    return;
  }

  body.innerHTML = profiles
    .map((p) => {
      const joined = new Date(p.created_at).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
      });

      return `
        <tr>
          <td>${escapeHtml(p.full_name || "-")}</td>
          <td>${escapeHtml(p.phone || "-")}</td>
          <td>
            <select data-user-id="${p.id}" class="role-select" ${p.id === currentAdminId ? "disabled" : ""}>
              <option value="citizen" ${p.role === "citizen" ? "selected" : ""}>Citizen</option>
              <option value="admin" ${p.role === "admin" ? "selected" : ""}>Admin</option>
            </select>
          </td>
          <td>${joined}</td>
        </tr>`;
    })
    .join("");

  body.querySelectorAll(".role-select").forEach((select) => {
    select.addEventListener("change", async () => {
      const userId = select.dataset.userId;
      const newRole = select.value;

      if (!confirm(`Change this user's role to "${newRole}"?`)) {
        select.value = profileLookup[userId].role;
        return;
      }

      const { error } = await supabaseClient
        .from("profiles")
        .update({ role: newRole })
        .eq("id", userId);

      if (error) {
        alert(`Could not update role: ${error.message}`);
        select.value = profileLookup[userId].role;
        return;
      }

      profileLookup[userId].role = newRole;
    });
  });
}

// ---------- Categories ----------
let allCategories = [];

function setupCategoryForm() {
  const form = document.getElementById("categoryForm");
  const alertEl = document.getElementById("categoryAlert");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideAlert(alertEl);

    const input = document.getElementById("newCategoryName");
    const name = input.value.trim();
    if (!name) return;

    const { error } = await supabaseClient.from("categories").insert({ name });

    if (error) {
      showAlert(alertEl, error.message.includes("duplicate") ? "That category already exists." : error.message);
      return;
    }

    input.value = "";
    await loadCategories();
  });
}

async function loadCategories() {
  const { data, error } = await supabaseClient.from("categories").select("*").order("name");

  if (error) {
    document.getElementById("categoriesTableBody").innerHTML =
      `<tr><td colspan="2"><div class="empty-state">Could not load categories: ${error.message}</div></td></tr>`;
    return;
  }

  allCategories = data || [];
  renderCategoriesTable();
}

function renderCategoriesTable() {
  const body = document.getElementById("categoriesTableBody");

  if (allCategories.length === 0) {
    body.innerHTML = `<tr><td colspan="2"><div class="empty-state">No categories yet. Add one above.</div></td></tr>`;
    return;
  }

  body.innerHTML = allCategories
    .map(
      (c) => `
        <tr data-category-id="${c.id}">
          <td>
            <span class="category-name-display">${escapeHtml(c.name)}</span>
            <input type="text" class="category-name-input hidden" value="${escapeHtml(c.name)}" style="padding:6px 10px; border:1px solid var(--color-slate-200); border-radius:6px; font-size:0.87rem;">
          </td>
          <td style="display:flex; gap:8px;">
            <button class="btn btn-outline btn-sm category-edit-btn">Rename</button>
            <button class="btn btn-danger btn-sm category-delete-btn">Delete</button>
          </td>
        </tr>`
    )
    .join("");

  body.querySelectorAll("tr[data-category-id]").forEach((row) => {
    const id = row.dataset.categoryId;
    const display = row.querySelector(".category-name-display");
    const input = row.querySelector(".category-name-input");
    const editBtn = row.querySelector(".category-edit-btn");
    const deleteBtn = row.querySelector(".category-delete-btn");

    editBtn.addEventListener("click", async () => {
      if (editBtn.textContent === "Rename") {
        display.classList.add("hidden");
        input.classList.remove("hidden");
        input.focus();
        editBtn.textContent = "Save";
        return;
      }

      const newName = input.value.trim();
      if (!newName) return;

      const { error } = await supabaseClient
        .from("categories")
        .update({ name: newName })
        .eq("id", id);

      if (error) {
        alert(`Could not rename category: ${error.message}`);
        return;
      }

      await loadCategories();
    });

    deleteBtn.addEventListener("click", async () => {
      if (!confirm(`Delete the category "${display.textContent}"? This won't affect existing reports.`)) return;

      const { error } = await supabaseClient.from("categories").delete().eq("id", id);

      if (error) {
        alert(`Could not delete category: ${error.message}`);
        return;
      }

      await loadCategories();
    });
  });
}

// ---------- PDF export ----------
function exportPdfSummary() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  const total = allReports.length;
  const counts = { Pending: 0, "Under Review": 0, Resolved: 0, Rejected: 0 };
  allReports.forEach((r) => {
    if (counts[r.status] !== undefined) counts[r.status]++;
  });

  doc.setFontSize(16);
  doc.text("ACIS — Corruption Report Summary", 14, 18);
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Generated ${new Date().toLocaleString()}`, 14, 25);

  doc.setFontSize(11);
  doc.setTextColor(20);
  doc.text(
    `Total: ${total}   Pending: ${counts.Pending}   Under Review: ${counts["Under Review"]}   Resolved: ${counts.Resolved}   Rejected: ${counts.Rejected}`,
    14,
    34
  );

  doc.autoTable({
    startY: 42,
    head: [["Title", "Category", "Status", "Filed by", "Date"]],
    body: allReports.map((r) => [
      r.title,
      r.category,
      r.status,
      r.is_anonymous ? "Anonymous" : profileLookup[r.user_id]?.full_name || "Unknown",
      new Date(r.created_at).toLocaleDateString()
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [10, 31, 61] }
  });

  doc.save(`acis-summary-${Date.now()}.pdf`);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}