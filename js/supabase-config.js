// Supabase project credentials
// The anon/publishable key is safe to expose in frontend code by design.
const SUPABASE_URL = "https://iarzyqogstwwebsbnzmh.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_3tDBH8__3M2JGY6epL-gig_z1b4rJcG";

// Supabase client, available to every page that loads this file after the Supabase library
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Report status values used throughout the system, kept in one place
const REPORT_STATUSES = ["Pending", "Under Review", "Resolved", "Rejected"];

// Report categories are managed by admins in the categories table.
// This is only a fallback used if that table can't be reached.
const FALLBACK_CATEGORIES = ["Bribery", "Embezzlement", "Fraud", "Other"];

// Fetches the current list of category names from Supabase
async function fetchCategories() {
  const { data, error } = await supabaseClient
    .from("categories")
    .select("*")
    .order("name");

  if (error) {
    console.error("Failed to load categories:", error.message);
    return FALLBACK_CATEGORIES.map((name) => ({ name }));
  }
  return data;
}

// Redirects the current tab to a given page
function goTo(page) {
  window.location.href = page;
}

// Reads the currently logged in user, or null if no session exists
async function getCurrentUser() {
  const { data, error } = await supabaseClient.auth.getUser();
  if (error || !data?.user) return null;
  return data.user;
}

// Reads the profile row (full_name, role, phone) for a given user id
async function getProfile(userId) {
  try {
    const { data, error } = await supabaseClient
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    if (!error && data) {
      return data;
    }
  } catch (err) {
    console.warn("Could not load profile from DB:", err);
  }

  // Fallback: If no profile row exists, attempt to upsert or return fallback profile object
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (user && user.id === userId) {
      const fallbackProfile = {
        id: userId,
        full_name: user.user_metadata?.full_name || user.email?.split("@")[0] || "Citizen User",
        phone: user.user_metadata?.phone || "",
        role: "citizen"
      };

      await supabaseClient.from("profiles").upsert(fallbackProfile);
      return fallbackProfile;
    }
  } catch (err) {
    console.warn("Could not upsert fallback profile:", err);
  }

  return {
    id: userId,
    full_name: "Citizen User",
    phone: "",
    role: "citizen"
  };
}

// Signs the current user out and returns to the landing page
async function signOut() {
  await supabaseClient.auth.signOut();
  goTo("index.html");
}

// Wires a show/hide toggle button to a password input
function setupPasswordToggle(inputId, toggleId) {
  const input = document.getElementById(inputId);
  const toggle = document.getElementById(toggleId);
  if (!input || !toggle) return;

  toggle.addEventListener("click", () => {
    const isHidden = input.type === "password";
    input.type = isHidden ? "text" : "password";
    toggle.textContent = isHidden ? "Hide" : "Show";
  });
}

// Basic email format check
function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// Marks a field as invalid and shows its error message
function setFieldError(fieldEl, message) {
  fieldEl.classList.add("has-error");
  const errorEl = fieldEl.querySelector(".field-error");
  if (errorEl) errorEl.textContent = message;
}

// Clears the invalid state on a field
function clearFieldError(fieldEl) {
  fieldEl.classList.remove("has-error");
}

// Shows a page-level alert box (error or success)
function showAlert(alertEl, message) {
  alertEl.textContent = message;
  alertEl.classList.add("visible");
}

function hideAlert(alertEl) {
  alertEl.classList.remove("visible");
}
