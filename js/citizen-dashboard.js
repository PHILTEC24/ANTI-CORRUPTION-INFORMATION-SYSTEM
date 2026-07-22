let selectedFiles = [];
let marker = null;
let map = null;

// ---------- Auth guard ----------
(async function init() {
  const user = await getCurrentUser();
  if (!user) {
    goTo("login.html");
    return;
  }

  const profile = await getProfile(user.id);
  if (!profile) {
    goTo("login.html");
    return;
  }

  if (profile.role === "admin") {
    goTo("admin-dashboard.html");
    return;
  }

  document.getElementById("userName").innerHTML =
    `${profile.full_name}<span>${user.email}</span>`;

  setupTabs();
  setupMobileToggle();
  await setupCategoryOptions();
  setupMap();
  setupFileUpload();
  setupReportForm(user.id);
  loadMyReports(user.id);
})();

document.getElementById("logoutBtn").addEventListener("click", signOut);
document.getElementById("logoutBtnMobile").addEventListener("click", signOut);

// ---------- Tabs ----------
function setupTabs() {
  const tabs = document.querySelectorAll(".dash-tab[data-panel]");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.panel;

      document.querySelectorAll(".dash-tab[data-panel]").forEach((t) => {
        t.classList.toggle("active", t.dataset.panel === target);
      });

      document.querySelectorAll(".panel").forEach((p) => {
        p.classList.toggle("active", p.id === `panel-${target}`);
      });

      document.getElementById("dashMobilePanel").classList.remove("open");

      // Leaflet needs a resize nudge when its container becomes visible again
      if (target === "submit" && map) {
        setTimeout(() => map.invalidateSize(), 50);
      }
    });
  });
}

function setupMobileToggle() {
  const toggle = document.getElementById("dashToggle");
  const panel = document.getElementById("dashMobilePanel");
  toggle.addEventListener("click", () => {
    panel.classList.toggle("open");
  });
}

// ---------- Category dropdown ----------
async function setupCategoryOptions() {
  const select = document.getElementById("category");
  const categories = await fetchCategories();
  select.innerHTML = '<option value="">Select a category</option>' +
    categories.map((c) => `<option value="${c.name}">${c.name}</option>`).join("");
}

// ---------- Map ----------
function setupMap() {
  map = L.map("map").setView([0.3476, 32.5825], 7); // default view, citizen clicks to refine

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19
  }).addTo(map);

  map.on("click", (e) => {
    const { lat, lng } = e.latlng;
    placeMarker(lat, lng);
  });
}

function placeMarker(lat, lng) {
  if (marker) {
    marker.setLatLng([lat, lng]);
  } else {
    marker = L.marker([lat, lng]).addTo(map);
  }
  document.getElementById("mapCoords").textContent =
    `Pinned location: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

// ---------- Evidence upload ----------
function setupFileUpload() {
  const drop = document.getElementById("fileDrop");
  const input = document.getElementById("fileInput");

  drop.addEventListener("click", () => input.click());

  input.addEventListener("change", () => {
    Array.from(input.files).forEach((file) => selectedFiles.push(file));
    input.value = "";
    renderFileList();
  });
}

function renderFileList() {
  const list = document.getElementById("fileList");
  list.innerHTML = selectedFiles
    .map(
      (file, i) => `
      <div class="file-list-item">
        <span>${file.name}</span>
        <button type="button" data-index="${i}">Remove</button>
      </div>`
    )
    .join("");

  list.querySelectorAll("button[data-index]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedFiles.splice(Number(btn.dataset.index), 1);
      renderFileList();
    });
  });
}

// ---------- Submit report ----------
function setupReportForm(userId) {
  const form = document.getElementById("reportForm");
  const alertEl = document.getElementById("submitAlert");
  const successEl = document.getElementById("submitSuccess");
  const submitBtn = document.getElementById("submitBtn");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideAlert(alertEl);
    successEl.classList.remove("visible");

    ["title", "category", "description"].forEach((id) =>
      clearFieldError(document.getElementById(`field-${id}`))
    );

    const title = document.getElementById("title").value.trim();
    const category = document.getElementById("category").value;
    const description = document.getElementById("description").value.trim();
    const isAnonymous = document.getElementById("isAnonymous").checked;

    let hasError = false;
    if (!title) {
      setFieldError(document.getElementById("field-title"), "Please enter a title.");
      hasError = true;
    }
    if (!category) {
      setFieldError(document.getElementById("field-category"), "Please select a category.");
      hasError = true;
    }
    if (!description) {
      setFieldError(document.getElementById("field-description"), "Please describe the incident.");
      hasError = true;
    }
    if (hasError) return;

    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";

    const { data: report, error: reportError } = await supabaseClient
      .from("reports")
      .insert({
        user_id: userId,
        title,
        category,
        description,
        is_anonymous: isAnonymous,
        latitude: marker ? marker.getLatLng().lat : null,
        longitude: marker ? marker.getLatLng().lng : null
      })
      .select()
      .single();

    if (reportError) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit report";
      showAlert(alertEl, reportError.message);
      return;
    }

    if (selectedFiles.length > 0) {
      const uploadError = await uploadEvidence(report.id, userId);
      if (uploadError) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit report";
        showAlert(alertEl, `Report saved, but evidence upload failed: ${uploadError}`);
        return;
      }
    }

    submitBtn.disabled = false;
    submitBtn.textContent = "Submit report";
    successEl.classList.add("visible");
    form.reset();
    selectedFiles = [];
    renderFileList();
    if (marker) {
      map.removeLayer(marker);
      marker = null;
      document.getElementById("mapCoords").textContent = "Click on the map to drop a pin.";
    }

    loadMyReports(userId);
  });
}

async function uploadEvidence(reportId, userId) {
  for (const file of selectedFiles) {
    const path = `${userId}/${reportId}/${Date.now()}-${file.name}`;

    const { error: uploadErr } = await supabaseClient.storage
      .from("evidence")
      .upload(path, file);

    if (uploadErr) return uploadErr.message;

    const { data: urlData } = supabaseClient.storage.from("evidence").getPublicUrl(path);

    const { error: insertErr } = await supabaseClient.from("evidence").insert({
      report_id: reportId,
      file_url: urlData.publicUrl,
      file_name: file.name
    });

    if (insertErr) return insertErr.message;
  }
  return null;
}

// ---------- My reports list ----------
async function loadMyReports(userId) {
  const container = document.getElementById("reportsContainer");

  const { data: reports, error } = await supabaseClient
    .from("reports")
    .select("*, evidence(file_url, file_name)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    container.innerHTML = `<div class="empty-state">Could not load your reports: ${error.message}</div>`;
    return;
  }

  if (!reports || reports.length === 0) {
    container.innerHTML = `<div class="empty-state">You haven't filed any reports yet.</div>`;
    return;
  }

  container.innerHTML = reports.map(renderReportCard).join("");
}

function renderReportCard(report) {
  const date = new Date(report.created_at).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });

  const badgeClass = {
    Pending: "badge-pending",
    "Under Review": "badge-review",
    Resolved: "badge-resolved",
    Rejected: "badge-rejected"
  }[report.status];

  const evidenceHtml =
    report.evidence && report.evidence.length > 0
      ? `<div class="report-evidence">${report.evidence
          .map((f) => `<a href="${f.file_url}" target="_blank" rel="noopener">${f.file_name}</a>`)
          .join("")}</div>`
      : `<span style="font-size:0.8rem; color:var(--color-slate-400);">No evidence attached</span>`;

  const locationHtml =
    report.latitude && report.longitude
      ? `<a href="https://www.openstreetmap.org/?mlat=${report.latitude}&mlon=${report.longitude}#map=16/${report.latitude}/${report.longitude}" target="_blank" rel="noopener" style="font-size:0.8rem;">View location</a>`
      : `<span style="font-size:0.8rem; color:var(--color-slate-400);">No location pinned</span>`;

  return `
    <div class="card report-card">
      <div class="report-card-top">
        <div>
          <h3>${escapeHtml(report.title)}</h3>
          <div class="report-meta">${report.category} · Filed ${date}${report.is_anonymous ? " · Anonymous" : ""}</div>
        </div>
        <span class="badge ${badgeClass}">${report.status}</span>
      </div>
      <p class="report-desc">${escapeHtml(report.description)}</p>
      <div class="report-footer">
        ${evidenceHtml}
        ${locationHtml}
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
