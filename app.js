
const API = "/api";

let isAdmin = false;
let reports = [];
let clockTimer;

const map = L.map("map").setView([33.6844, 73.0479], 11);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

const markers = L.layerGroup().addTo(map);

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, function (char) {
    const characters = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return characters[char];
  });
}

// Show the current date and time in Pakistan.
function updateClock() {
  const now = new Date();

  document.getElementById("currentDateTime").textContent =
    new Intl.DateTimeFormat("en-PK", {
      timeZone: "Asia/Karachi",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    }).format(now);
}

updateClock();
clockTimer = setInterval(updateClock, 1000);

// Format report timestamps.
function formatDateTime(value) {
  if (!value) return "Not available";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not available";
  }

  return new Intl.DateTimeFormat("en-PK", {
    timeZone: "Asia/Karachi",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  }).format(date);
}

function showMessage(id, message, type = "") {
  const element = document.getElementById(id);
  element.textContent = message;
  element.className = "message";

  if (type) element.classList.add(type);
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");

  clearTimeout(toast.hideTimer);

  toast.hideTimer = setTimeout(function () {
    toast.classList.add("hidden");
  }, 3500);
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "The request failed.");
  }

  return data;
}

function setAdmin(loggedIn, username = "") {
  isAdmin = loggedIn;

  document.getElementById("loginOpenBtn").classList.toggle("hidden", loggedIn);
  document.getElementById("logoutBtn").classList.toggle("hidden", !loggedIn);

  document.getElementById("accountText").textContent = loggedIn
    ? `Logged in as ${username || "admin"}`
    : "Not logged in";

  document.getElementById("loginNote").textContent = loggedIn
    ? "You can now add road reports and update their status."
    : "Log in as an administrator to add or update reports.";

  document.getElementById("reportLoginMessage").classList.toggle("hidden", loggedIn);

  document.getElementById("submitReportBtn").disabled = !loggedIn;
  document.getElementById("submitReportBtn").textContent = loggedIn
    ? "Add Report"
    : "Log in to Add Report";

  renderReports();
}

async function checkLogin() {
  try {
    const data = await apiRequest(`${API}/me`);
    setAdmin(data.loggedIn, data.username || "");
  } catch (error) {
    setAdmin(false);
  }
}

// Open and close the login window.
function openLogin() {
  document.getElementById("loginModal").classList.remove("hidden");
  showMessage("loginMessage", "");
  document.getElementById("username").focus();
}

function closeLogin() {
  document.getElementById("loginModal").classList.add("hidden");
}

document.getElementById("loginOpenBtn").addEventListener("click", openLogin);
document.getElementById("closeLoginBtn").addEventListener("click", closeLogin);

document.getElementById("loginModal").addEventListener("click", function (event) {
  if (event.target.id === "loginModal") closeLogin();
});

document.addEventListener("keydown", function (event) {
  if (event.key === "Escape") closeLogin();
});

// Log in using the credentials saved in the .env file.
document.getElementById("loginForm").addEventListener("submit", async function (event) {
  event.preventDefault();

  const button = document.getElementById("loginBtn");
  button.disabled = true;

  showMessage("loginMessage", "Checking your login...");

  try {
    const data = await apiRequest(`${API}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: document.getElementById("username").value.trim(),
        password: document.getElementById("password").value
      })
    });

    setAdmin(true, data.username);
    document.getElementById("loginForm").reset();
    closeLogin();

    showToast("Login successful.");
    await loadReports();
  } catch (error) {
    showMessage("loginMessage", error.message, "error");
  } finally {
    button.disabled = false;
  }
});

// Log out.
document.getElementById("logoutBtn").addEventListener("click", async function () {
  try {
    await apiRequest(`${API}/logout`, { method: "POST" });
    setAdmin(false);
    showToast("You have logged out.");
  } catch (error) {
    showToast(error.message);
  }
});

// Click the map to select report coordinates.
map.on("click", function (event) {
  document.getElementById("latitude").value = event.latlng.lat.toFixed(6);
  document.getElementById("longitude").value = event.latlng.lng.toFixed(6);
});

// Add a new report.
document.getElementById("reportForm").addEventListener("submit", async function (event) {
  event.preventDefault();

  if (!isAdmin) {
    openLogin();
    showMessage("loginMessage", "Please log in first.", "error");
    return;
  }

  const latitudeText = document.getElementById("latitude").value;
  const longitudeText = document.getElementById("longitude").value;
  const latitude = Number(latitudeText);
  const longitude = Number(longitudeText);

  if (
    latitudeText === "" ||
    longitudeText === "" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 || latitude > 90 ||
    longitude < -180 || longitude > 180
  ) {
    showMessage("formMessage", "Please choose a valid location on the map.", "error");
    return;
  }

  const button = document.getElementById("submitReportBtn");
  button.disabled = true;

  try {
    await apiRequest(`${API}/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        issue_type: document.getElementById("issueType").value,
        description: document.getElementById("description").value.trim(),
        latitude: latitude,
        longitude: longitude
      })
    });

    document.getElementById("reportForm").reset();
    showMessage("formMessage", "Report saved successfully.", "success");
    showToast("Road report added.");

    await loadReports();
  } catch (error) {
    showMessage("formMessage", error.message, "error");
  } finally {
    button.disabled = !isAdmin;
  }
});

// Apply filters and refresh the reports.
document.getElementById("typeFilter").addEventListener("change", loadReports);
document.getElementById("statusFilter").addEventListener("change", loadReports);
document.getElementById("refreshBtn").addEventListener("click", loadReports);

async function loadReports() {
  const parameters = new URLSearchParams();
  const type = document.getElementById("typeFilter").value;
  const status = document.getElementById("statusFilter").value;

  if (type) parameters.set("type", type);
  if (status) parameters.set("status", status);

  try {
    const data = await apiRequest(`${API}/reports?${parameters.toString()}`);
    reports = Array.isArray(data) ? data : [];
    renderReports();
    renderMarkers();
    await loadStats();
  } catch (error) {
    document.getElementById("reportsContainer").innerHTML =
      `<p class="empty-state">${escapeHTML(error.message)}</p>`;
  }
}

// Display report locations on the map.
function renderMarkers() {
  markers.clearLayers();

  reports.forEach(function (report) {
    const latitude = Number(report.latitude);
    const longitude = Number(report.longitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

    let color = "#b7791f";

    if (report.status === "In Progress") color = "#2876bd";
    if (report.status === "Resolved") color = "#21865b";

    const marker = L.circleMarker([latitude, longitude], {
      radius: 8,
      color: color,
      fillColor: color,
      fillOpacity: 0.85,
      weight: 2
    });

    marker.bindPopup(`
      <strong>${escapeHTML(report.issue_type)}</strong><br>
      ${escapeHTML(report.description)}<br>
      Status: ${escapeHTML(report.status)}<br>
      Reported: ${escapeHTML(formatDateTime(report.created_at))}
    `);

    marker.addTo(markers);
  });
}

function getStatusClass(status) {
  if (status === "Resolved") return "status-resolved";
  if (status === "In Progress") return "status-in-progress";
  return "status-pending";
}

// Show the reports, including date and time.
function renderReports() {
  const container = document.getElementById("reportsContainer");

  if (!reports.length) {
    container.innerHTML = '<p class="empty-state">No reports found.</p>';
    return;
  }

  container.innerHTML = reports.map(function (report) {
    const id = Number(report.id);
    const status = report.status || "Pending";

    let updateControls = "";

    if (isAdmin) {
      updateControls = `
        <div class="status-control">
          <select id="status-${id}" aria-label="Report status">
            <option ${status === "Pending" ? "selected" : ""}>Pending</option>
            <option ${status === "In Progress" ? "selected" : ""}>In Progress</option>
            <option ${status === "Resolved" ? "selected" : ""}>Resolved</option>
          </select>
          <button class="btn btn-primary" data-update-id="${id}">
            Update Status
          </button>
        </div>`;
    }

    return `
      <article class="report-card">
        <div class="report-top">
          <div>
            <h4>#${id} · ${escapeHTML(report.issue_type)}</h4>
            <span class="status-badge ${getStatusClass(status)}">
              ${escapeHTML(status)}
            </span>
          </div>

          <button class="btn btn-light" data-zoom-id="${id}">
            View on Map
          </button>
        </div>

        <p class="report-description">
          ${escapeHTML(report.description)}
        </p>

        <div class="report-meta">
          <span>Reported: ${escapeHTML(formatDateTime(report.created_at))}</span>
          <span>Last Updated: ${escapeHTML(formatDateTime(report.updated_at))}</span>
          <span>Latitude: ${escapeHTML(report.latitude)}</span>
          <span>Longitude: ${escapeHTML(report.longitude)}</span>
        </div>

        ${updateControls}
      </article>`;
  }).join("");
}

// Handle report buttons.
document.getElementById("reportsContainer").addEventListener("click", async function (event) {
  const zoomButton = event.target.closest("[data-zoom-id]");
  const updateButton = event.target.closest("[data-update-id]");

  if (zoomButton) {
    const id = Number(zoomButton.dataset.zoomId);
    const report = reports.find(item => Number(item.id) === id);

    if (report) {
      map.setView([Number(report.latitude), Number(report.longitude)], 16);
    }
  }

  if (updateButton) {
    if (!isAdmin) {
      openLogin();
      return;
    }

    const id = Number(updateButton.dataset.updateId);
    const newStatus = document.getElementById(`status-${id}`).value;

    updateButton.disabled = true;

    try {
      await apiRequest(`${API}/reports/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus })
      });

      showToast("Report status updated.");
      await loadReports();
    } catch (error) {
      showToast(error.message);
    } finally {
      updateButton.disabled = false;
    }
  }
});

// Update the four dashboard totals.
async function loadStats() {
  try {
    const stats = await apiRequest(`${API}/stats`);

    document.getElementById("totalCount").textContent = stats.total ?? 0;
    document.getElementById("pendingCount").textContent = stats.pending ?? 0;
    document.getElementById("progressCount").textContent = stats.in_progress ?? 0;
    document.getElementById("resolvedCount").textContent = stats.resolved ?? 0;
  } catch (error) {
    console.error("Could not load statistics:", error.message);
  }
}

// Start the application.
async function startApp() {
  await checkLogin();
  await loadReports();

  setTimeout(function () {
    map.invalidateSize();
  }, 200);
}

startApp();
