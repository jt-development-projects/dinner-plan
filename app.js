// ─── Constants ────────────────────────────────────────────────────────────────

const UNITS = ["", "g", "kg", "ml", "dl", "l", "tsp", "tbsp", "cup", "pcs", "pinch", "slices", "bunch"];

// ─── State ────────────────────────────────────────────────────────────────────

let sb;
let currentUser = null;
let currentGroupId = null;
let recipes = [];
let currentDetailId = null;
let recipesLoaded = false;
let checkedIds = new Set();
let pendingInviteToken = null;

// ─── Plan (localStorage) ──────────────────────────────────────────────────────

const PLAN_KEY = "dinner-plan";

function loadPlan() {
  try {
    const saved = JSON.parse(localStorage.getItem(PLAN_KEY) || "{}");
    checkedIds = new Set(saved.checked || []);
    const peopleInput = document.getElementById("home-people");
    if (saved.people) peopleInput.value = saved.people;
  } catch {
    checkedIds = new Set();
  }
}

function savePlan() {
  localStorage.setItem(PLAN_KEY, JSON.stringify({
    checked: Array.from(checkedIds),
    people: document.getElementById("home-people").value,
  }));
}

// ─── View Router ──────────────────────────────────────────────────────────────

const AUTH_VIEWS = ["auth-login", "auth-register", "auth-forgot", "auth-reset", "group-setup"];
const APP_VIEWS  = ["home", "add", "detail"];
const ALL_VIEWS  = [...AUTH_VIEWS, ...APP_VIEWS];

function showView(name) {
  ALL_VIEWS.forEach(v => {
    document.getElementById("view-" + v).classList.toggle("hidden", v !== name);
  });
  const isAuth = AUTH_VIEWS.includes(name);
  document.getElementById("main-nav").classList.toggle("hidden", isAuth);
}

// ─── Supabase data API ────────────────────────────────────────────────────────

async function apiGet() {
  const { data, error } = await sb
    .from("recipes")
    .select("*")
    .eq("group_id", currentGroupId)
    .order("name");
  if (error) throw error;
  return data;
}

async function apiSave(recipe) {
  const isNew = !recipe.id || !recipes.find(r => r.id === recipe.id);
  if (isNew) {
    const { data, error } = await sb
      .from("recipes")
      .insert({ ...recipe, group_id: currentGroupId, created_by: currentUser.id })
      .select()
      .single();
    if (error) throw error;
    return data;
  } else {
    const { data, error } = await sb
      .from("recipes")
      .update({ name: recipe.name, serves: recipe.serves, ingredients: recipe.ingredients, steps: recipe.steps })
      .eq("id", recipe.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
}

async function apiDelete(id) {
  const { error } = await sb.from("recipes").delete().eq("id", id);
  if (error) throw error;
}

// ─── Auth forms ───────────────────────────────────────────────────────────────

document.getElementById("form-login").addEventListener("submit", async e => {
  e.preventDefault();
  const email    = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const errEl    = document.getElementById("login-error");
  errEl.classList.add("hidden");

  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    errEl.textContent = error.message;
    errEl.classList.remove("hidden");
  } else {
    currentUser = data.user;
    document.getElementById("nav-user-name").textContent =
      data.user.user_metadata?.display_name || data.user.email;
    await loadUserGroup();
  }
});

document.getElementById("form-register").addEventListener("submit", async e => {
  e.preventDefault();
  const name     = document.getElementById("register-name").value.trim();
  const email    = document.getElementById("register-email").value.trim();
  const password = document.getElementById("register-password").value;
  const errEl    = document.getElementById("register-error");
  const msgEl    = document.getElementById("register-message");
  errEl.classList.add("hidden");
  msgEl.classList.add("hidden");

  const { error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { display_name: name } },
  });

  if (error) {
    errEl.textContent = error.message;
    errEl.classList.remove("hidden");
  } else {
    document.getElementById("form-register").classList.add("hidden");
    msgEl.textContent = "Check your email to confirm your account, then sign in.";
    msgEl.classList.remove("hidden");
  }
});

document.getElementById("form-forgot").addEventListener("submit", async e => {
  e.preventDefault();
  const email = document.getElementById("forgot-email").value.trim();
  const errEl = document.getElementById("forgot-error");
  const msgEl = document.getElementById("forgot-message");
  errEl.classList.add("hidden");
  msgEl.classList.add("hidden");

  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });

  if (error) {
    errEl.textContent = error.message;
    errEl.classList.remove("hidden");
  } else {
    document.getElementById("form-forgot").classList.add("hidden");
    msgEl.textContent = "Password reset link sent — check your email.";
    msgEl.classList.remove("hidden");
  }
});

document.getElementById("form-reset").addEventListener("submit", async e => {
  e.preventDefault();
  const password = document.getElementById("reset-password").value;
  const confirm  = document.getElementById("reset-confirm").value;
  const errEl    = document.getElementById("reset-error");
  errEl.classList.add("hidden");

  if (password !== confirm) {
    errEl.textContent = "Passwords do not match.";
    errEl.classList.remove("hidden");
    return;
  }

  const { error } = await sb.auth.updateUser({ password });
  if (error) {
    errEl.textContent = error.message;
    errEl.classList.remove("hidden");
  } else {
    await loadUserGroup();
  }
});

document.getElementById("link-to-register").addEventListener("click", e => { e.preventDefault(); showView("auth-register"); });
document.getElementById("link-to-forgot").addEventListener("click", e => { e.preventDefault(); showView("auth-forgot"); });
document.getElementById("link-to-login-from-register").addEventListener("click", e => { e.preventDefault(); showView("auth-login"); });
document.getElementById("link-to-login-from-forgot").addEventListener("click", e => { e.preventDefault(); showView("auth-login"); });

document.getElementById("btn-signout").addEventListener("click", async () => {
  await sb.auth.signOut();
  recipes = [];
  recipesLoaded = false;
  currentGroupId = null;
  currentUser = null;
  showView("auth-login");
});

// ─── Group setup ──────────────────────────────────────────────────────────────

document.getElementById("form-create-group").addEventListener("submit", async e => {
  e.preventDefault();
  const name  = document.getElementById("group-name").value.trim();
  const errEl = document.getElementById("create-group-error");
  errEl.classList.add("hidden");

  try {
    const { data: group, error: groupErr } = await sb
      .from("groups")
      .insert({ name, created_by: currentUser.id })
      .select()
      .single();
    if (groupErr) throw groupErr;

    const { error: memberErr } = await sb
      .from("group_members")
      .insert({ group_id: group.id, user_id: currentUser.id, role: "owner" });
    if (memberErr) throw memberErr;

    currentGroupId = group.id;
    loadPlan();
    await renderHome(true);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
  }
});

document.getElementById("form-join-group").addEventListener("submit", async e => {
  e.preventDefault();
  const input = document.getElementById("invite-code").value.trim();
  const errEl = document.getElementById("join-group-error");
  errEl.classList.add("hidden");

  let token = input;
  try { token = new URL(input).searchParams.get("invite") || input; } catch {}

  try {
    const { data: invite, error: tokenErr } = await sb
      .from("invite_tokens")
      .select("group_id, expires_at")
      .eq("token", token)
      .single();

    if (tokenErr || !invite) throw new Error("Invalid invite link.");
    if (new Date(invite.expires_at) < new Date()) throw new Error("This invite has expired.");

    const { error: memberErr } = await sb
      .from("group_members")
      .insert({ group_id: invite.group_id, user_id: currentUser.id, role: "member" });
    if (memberErr) throw memberErr;

    currentGroupId = invite.group_id;
    loadPlan();
    await renderHome(true);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
  }
});

// ─── Invite ───────────────────────────────────────────────────────────────────

document.getElementById("btn-invite").addEventListener("click", async () => {
  try {
    const { data: invite, error } = await sb
      .from("invite_tokens")
      .insert({ group_id: currentGroupId, created_by: currentUser.id })
      .select("token")
      .single();
    if (error) throw error;

    const url = `${window.location.origin}?invite=${invite.token}`;
    await navigator.clipboard.writeText(url);

    const btn = document.getElementById("btn-invite");
    const orig = btn.textContent;
    btn.textContent = "Link copied!";
    setTimeout(() => btn.textContent = orig, 2000);
  } catch (err) {
    alert("Could not generate invite link: " + err.message);
  }
});

// ─── Wake Lock ────────────────────────────────────────────────────────────────

let wakeLock = null;

async function acquireWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try { wakeLock = await navigator.wakeLock.request("screen"); } catch {}
}

function releaseWakeLock() {
  if (wakeLock) { wakeLock.release(); wakeLock = null; }
}

document.addEventListener("visibilitychange", () => {
  const detailVisible = !document.getElementById("view-detail").classList.contains("hidden");
  if (document.visibilityState === "visible" && detailVisible) acquireWakeLock();
});

// ─── Home View ────────────────────────────────────────────────────────────────

async function renderHome(refresh = false) {
  showView("home");

  if (!recipesLoaded || refresh) {
    try {
      recipes = await apiGet();
      recipesLoaded = true;
    } catch (e) {
      showError("Could not load recipes.");
      return;
    }
  }

  const grid  = document.getElementById("recipe-list");
  const empty = document.getElementById("no-recipes");
  grid.innerHTML = "";

  if (recipes.length === 0) {
    empty.classList.remove("hidden");
    renderShoppingList();
    return;
  }
  empty.classList.add("hidden");

  recipes.forEach(recipe => {
    const card = document.createElement("div");
    card.className = "recipe-card";
    card.dataset.id = recipe.id;

    const checked = checkedIds.has(recipe.id);
    card.innerHTML = `
      <input type="checkbox" class="card-checkbox" data-id="${recipe.id}" ${checked ? "checked" : ""}>
      <div class="card-name">${escHtml(recipe.name)}</div>
    `;

    card.querySelector(".card-checkbox").addEventListener("change", e => {
      e.stopPropagation();
      if (e.target.checked) checkedIds.add(recipe.id);
      else checkedIds.delete(recipe.id);
      savePlan();
      renderShoppingList();
    });

    card.addEventListener("click", e => {
      if (e.target.classList.contains("card-checkbox")) return;
      openDetail(recipe.id);
    });

    grid.appendChild(card);
  });

  renderShoppingList();
}

// ─── Add / Edit Recipe View ───────────────────────────────────────────────────

function openAddView(recipeId = null) {
  const form = document.getElementById("recipe-form");
  form.reset();
  document.getElementById("edit-id").value = "";
  document.getElementById("ingredients-list").innerHTML = "";
  document.getElementById("steps-list").innerHTML = "";
  document.getElementById("form-title").textContent = recipeId ? "Edit Recipe" : "Add Recipe";

  if (recipeId) {
    const recipe = recipes.find(r => r.id === recipeId);
    if (!recipe) return;
    document.getElementById("edit-id").value = recipe.id;
    document.getElementById("field-name").value = recipe.name;
    document.getElementById("field-serves").value = recipe.serves;
    recipe.ingredients.forEach(ing => addIngredientRow(ing));
    recipe.steps.forEach(step => addStepRow(step));
  } else {
    addIngredientRow();
    addStepRow();
  }

  showView("add");
}

function addIngredientRow(ing = {}) {
  const list = document.getElementById("ingredients-list");
  const row  = document.createElement("div");
  row.className = "ingredient-row";

  const unitValue   = (ing.unit || "").toLowerCase();
  const matchedUnit = UNITS.find(u => u === unitValue) ?? "";
  const unitOptions = UNITS.map(u =>
    `<option value="${u}"${u === matchedUnit ? " selected" : ""}>${u || "—"}</option>`
  ).join("");

  row.innerHTML = `
    <input type="text" name="ing-name" placeholder="Ingredient" value="${escAttr(ing.name || "")}" required>
    <input type="number" name="ing-amount" placeholder="Amount" value="${ing.amount != null ? ing.amount : ""}" min="0" step="any">
    <select name="ing-unit">${unitOptions}</select>
    <button type="button" class="remove-btn" title="Remove">×</button>
  `;
  row.querySelector(".remove-btn").addEventListener("click", () => row.remove());
  list.appendChild(row);
}

function addStepRow(text = "") {
  const list = document.getElementById("steps-list");
  const row  = document.createElement("div");
  row.className = "step-row";
  const n = list.children.length + 1;
  row.innerHTML = `
    <div class="step-number">${n}</div>
    <textarea name="step-text" placeholder="Describe this step…" required>${escHtml(text)}</textarea>
    <button type="button" class="remove-btn" title="Remove">×</button>
  `;
  row.querySelector(".remove-btn").addEventListener("click", () => {
    row.remove();
    renumberSteps();
  });
  list.appendChild(row);
}

function renumberSteps() {
  document.querySelectorAll("#steps-list .step-number").forEach((el, i) => {
    el.textContent = i + 1;
  });
}

// ─── Image Upload ─────────────────────────────────────────────────────────────

document.getElementById("image-upload-trigger").addEventListener("click", () => {
  document.getElementById("image-input").click();
});

document.getElementById("image-input").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;

  const inner   = document.getElementById("image-upload-trigger");
  const loading = document.getElementById("image-loading");
  inner.classList.add("hidden");
  loading.classList.remove("hidden");

  try {
    const base64 = await fileToBase64(file);
    const res    = await fetch("/api/parse-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: base64, mediaType: file.type }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Unknown error");
    fillFormFromRecipe(data);
  } catch (err) {
    alert("Could not read recipe: " + err.message);
  } finally {
    loading.classList.add("hidden");
    inner.classList.remove("hidden");
    e.target.value = "";
  }
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function fillFormFromRecipe(recipe) {
  if (recipe.name)   document.getElementById("field-name").value = recipe.name;
  if (recipe.serves) document.getElementById("field-serves").value = recipe.serves;

  document.getElementById("ingredients-list").innerHTML = "";
  (recipe.ingredients || []).forEach(ing => addIngredientRow(ing));
  if (!recipe.ingredients?.length) addIngredientRow();

  document.getElementById("steps-list").innerHTML = "";
  (recipe.steps || []).forEach(step => addStepRow(step));
  if (!recipe.steps?.length) addStepRow();
}

document.getElementById("btn-add-ingredient").addEventListener("click", () => addIngredientRow());
document.getElementById("btn-add-step").addEventListener("click", () => addStepRow());

document.getElementById("recipe-form").addEventListener("submit", async e => {
  e.preventDefault();

  const name   = document.getElementById("field-name").value.trim();
  const serves = parseInt(document.getElementById("field-serves").value, 10);
  const editId = document.getElementById("edit-id").value;

  const ingredients = [];
  document.querySelectorAll("#ingredients-list .ingredient-row").forEach(row => {
    const n = row.querySelector("[name='ing-name']").value.trim();
    const a = parseFloat(row.querySelector("[name='ing-amount']").value);
    const u = row.querySelector("[name='ing-unit']").value;
    if (n) ingredients.push({ name: n, amount: isNaN(a) ? null : a, unit: u });
  });

  const steps = [];
  document.querySelectorAll("#steps-list [name='step-text']").forEach(ta => {
    const s = ta.value.trim();
    if (s) steps.push(s);
  });

  if (!name || serves < 1 || ingredients.length === 0 || steps.length === 0) {
    alert("Please fill in all fields, and add at least one ingredient and one step.");
    return;
  }

  const recipe = { name, serves, ingredients, steps };
  if (editId) recipe.id = editId;

  try {
    await apiSave(recipe);
  } catch (err) {
    showError("Could not save recipe.");
    return;
  }

  await renderHome(true);
});

document.getElementById("btn-cancel").addEventListener("click", () => {
  if (currentDetailId) openDetail(currentDetailId);
  else renderHome();
});

// ─── Detail View ──────────────────────────────────────────────────────────────

function openDetail(id) {
  const recipe = recipes.find(r => r.id === id);
  if (!recipe) return;

  currentDetailId = id;
  document.getElementById("detail-name").textContent = recipe.name;
  document.getElementById("detail-people").value = recipe.serves;
  renderDetailIngredients(recipe, recipe.serves);

  const stepsList = document.getElementById("detail-steps");
  stepsList.innerHTML = recipe.steps.map(s => `<li>${escHtml(s)}</li>`).join("");

  showView("detail");
  acquireWakeLock();
}

function renderDetailIngredients(recipe, people) {
  const scale = people / recipe.serves;
  const list  = document.getElementById("detail-ingredients");
  list.innerHTML = recipe.ingredients.map(ing => {
    if (ing.amount == null) return `<li><strong>${escHtml(ing.name)}</strong></li>`;
    const scaled = formatAmount(ing.amount * scale);
    const unit   = ing.unit ? ` ${ing.unit}` : "";
    return `<li><strong>${escHtml(ing.name)}</strong> — ${scaled}${escHtml(unit)}</li>`;
  }).join("");

  const note = document.getElementById("detail-serves-note");
  note.textContent = people === recipe.serves
    ? `(original recipe serves ${recipe.serves})`
    : `(original serves ${recipe.serves})`;
}

document.getElementById("detail-people").addEventListener("input", e => {
  const people = Math.max(1, parseInt(e.target.value, 10) || 1);
  const recipe = recipes.find(r => r.id === currentDetailId);
  if (recipe) renderDetailIngredients(recipe, people);
});

document.getElementById("btn-edit-recipe").addEventListener("click", () => {
  releaseWakeLock();
  openAddView(currentDetailId);
});

document.getElementById("btn-delete-recipe").addEventListener("click", async () => {
  const recipe = recipes.find(r => r.id === currentDetailId);
  if (!recipe) return;
  if (!confirm(`Delete "${recipe.name}"? This cannot be undone.`)) return;
  try {
    await apiDelete(currentDetailId);
  } catch (err) {
    showError("Could not delete recipe.");
    return;
  }
  releaseWakeLock();
  checkedIds.delete(currentDetailId);
  currentDetailId = null;
  await renderHome(true);
});

document.getElementById("btn-print-recipe").addEventListener("click", () => window.print());

document.getElementById("btn-back-detail").addEventListener("click", () => {
  releaseWakeLock();
  renderHome();
});

// ─── Shopping List (inline) ───────────────────────────────────────────────────

function renderShoppingList() {
  const people   = Math.max(1, parseInt(document.getElementById("home-people").value, 10) || 1);
  const selected = recipes.filter(r => checkedIds.has(r.id));

  const noShopping = document.getElementById("no-shopping");
  const itemsList  = document.getElementById("shopping-items");
  const summary    = document.getElementById("shopping-summary");
  itemsList.innerHTML = "";

  if (selected.length === 0) {
    noShopping.classList.remove("hidden");
    summary.textContent = "";
    return;
  }

  noShopping.classList.add("hidden");
  summary.textContent = `${selected.length} recipe${selected.length > 1 ? "s" : ""}`;

  const map = new Map();
  selected.forEach(recipe => {
    const scale = people / recipe.serves;
    recipe.ingredients.forEach(ing => {
      if (ing.amount == null) {
        const key = ing.name.toLowerCase() + "||no-amount";
        if (!map.has(key)) map.set(key, { name: ing.name, unit: "", amount: null });
        return;
      }
      const key = ing.name.toLowerCase() + "||" + ing.unit.toLowerCase();
      if (map.has(key)) {
        map.get(key).amount += ing.amount * scale;
      } else {
        map.set(key, { name: ing.name, unit: ing.unit, amount: ing.amount * scale });
      }
    });
  });

  Array.from(map.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(item => {
      const li      = document.createElement("li");
      const unit    = item.unit ? ` ${item.unit}` : "";
      const amountStr = item.amount != null ? `${formatAmount(item.amount)}${unit}` : "—";
      li.innerHTML = `
        <input type="checkbox" title="Mark as got">
        <span class="shopping-amount">${escHtml(amountStr)}</span>
        <span>${escHtml(item.name)}</span>
      `;
      li.querySelector("input").addEventListener("change", e => {
        li.classList.toggle("checked", e.target.checked);
      });
      itemsList.appendChild(li);
    });
}

document.getElementById("home-people").addEventListener("input", () => {
  savePlan();
  renderShoppingList();
});

document.getElementById("btn-copy-shopping").addEventListener("click", () => {
  const items = Array.from(document.querySelectorAll("#shopping-items li")).map(li => {
    const amount = li.querySelector(".shopping-amount")?.textContent.trim() || "";
    const name   = li.querySelectorAll("span")[1]?.textContent.trim() || "";
    return amount && amount !== "—" ? `${amount}  ${name}` : name;
  });
  if (!items.length) return;
  navigator.clipboard.writeText(items.join("\n")).then(() => {
    const btn  = document.getElementById("btn-copy-shopping");
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => btn.textContent = orig, 1500);
  });
});

document.getElementById("btn-print-shopping").addEventListener("click", () => window.print());

// ─── Export ───────────────────────────────────────────────────────────────────

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

document.getElementById("btn-export-all").addEventListener("click", () => {
  if (!recipes.length) return;
  downloadJson(recipes, "dinner-plan-recipes.json");
});

document.getElementById("btn-export-recipe").addEventListener("click", () => {
  const recipe = recipes.find(r => r.id === currentDetailId);
  if (!recipe) return;
  const slug = recipe.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  downloadJson(recipe, `${slug}.json`);
});

// ─── Nav ──────────────────────────────────────────────────────────────────────

document.getElementById("nav-home").addEventListener("click", e => {
  e.preventDefault();
  releaseWakeLock();
  currentDetailId = null;
  renderHome();
});

document.getElementById("nav-add").addEventListener("click", () => {
  currentDetailId = null;
  openAddView();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatAmount(n) {
  if (Number.isInteger(n)) return n.toString();
  return parseFloat(n.toFixed(2)).toString();
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escAttr(str) {
  return String(str).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function showError(msg) { alert("Error: " + msg); }

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function loadUserGroup() {
  const { data } = await sb
    .from("group_members")
    .select("group_id")
    .eq("user_id", currentUser.id)
    .single();

  if (data) {
    currentGroupId = data.group_id;
    pendingInviteToken = null;
    loadPlan();
    await renderHome(true);
  } else {
    if (pendingInviteToken) {
      document.getElementById("invite-code").value =
        `${window.location.origin}?invite=${pendingInviteToken}`;
    }
    showView("group-setup");
  }
}

async function initApp() {
  const urlParams = new URLSearchParams(window.location.search);
  pendingInviteToken = urlParams.get("invite");

  const config = await fetch("/api/config").then(r => r.json());
  sb = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === "PASSWORD_RECOVERY") {
      showView("auth-reset");
    } else if (event === "SIGNED_IN" && session) {
      currentUser = session.user;
      document.getElementById("nav-user-name").textContent =
        session.user.user_metadata?.display_name || session.user.email;
      await loadUserGroup();
    }
  });

  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    currentUser = session.user;
    document.getElementById("nav-user-name").textContent =
      session.user.user_metadata?.display_name || session.user.email;
    await loadUserGroup();
  } else {
    showView(pendingInviteToken ? "auth-register" : "auth-login");
  }
}

initApp();
