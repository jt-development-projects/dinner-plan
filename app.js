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
let shoppingLocked = false;
let shoppingChecked = {};  // key → true/false (got-it ticks)

// ─── Plan (localStorage) ──────────────────────────────────────────────────────

const PLAN_KEY = "dinner-plan";

async function loadPlan() {
  let saved = {};
  try {
    const { data } = await sb.from("groups").select("plan").eq("id", currentGroupId).single();
    saved = data?.plan || {};
  } catch {
    try { saved = JSON.parse(localStorage.getItem(PLAN_KEY) || "{}"); } catch {}
  }
  checkedIds = new Set(saved.checked || []);
  shoppingLocked = saved.locked || false;
  shoppingChecked = saved.shoppingChecked || {};
  const peopleInput = document.getElementById("home-people");
  if (saved.people) peopleInput.value = saved.people;
}

function savePlan() {
  const plan = {
    checked: Array.from(checkedIds),
    people: document.getElementById("home-people").value,
    locked: shoppingLocked,
    shoppingChecked,
  };
  localStorage.setItem(PLAN_KEY, JSON.stringify(plan));
  if (currentGroupId) {
    sb.from("groups").update({ plan }).eq("id", currentGroupId).then(() => {});
  }
}

// ─── View Router ──────────────────────────────────────────────────────────────

const AUTH_VIEWS = ["auth-login", "auth-register", "auth-forgot", "auth-reset"];
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
    .eq("group_id", currentGroupId);
  if (error) throw error;
  return data.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
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
      .update({ name: recipe.name, serves: recipe.serves, cook_time: recipe.cook_time, ingredients: recipe.ingredients, steps: recipe.steps })
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
  const btn      = e.target.querySelector("button[type='submit']");
  errEl.classList.add("hidden");
  btn.textContent = "Signing in…";
  btn.disabled = true;

  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    errEl.textContent = error.message;
    errEl.classList.remove("hidden");
    btn.textContent = "Sign in";
    btn.disabled = false;
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
  const btn      = e.target.querySelector("button[type='submit']");
  errEl.classList.add("hidden");
  msgEl.classList.add("hidden");
  btn.textContent = "Creating account…";
  btn.disabled = true;

  const { error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { display_name: name } },
  });

  if (error) {
    errEl.textContent = error.message;
    errEl.classList.remove("hidden");
    btn.textContent = "Create account";
    btn.disabled = false;
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
  const btn   = e.target.querySelector("button[type='submit']");
  errEl.classList.add("hidden");
  msgEl.classList.add("hidden");
  btn.textContent = "Sending…";
  btn.disabled = true;

  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });

  if (error) {
    errEl.textContent = error.message;
    errEl.classList.remove("hidden");
    btn.textContent = "Send reset link";
    btn.disabled = false;
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
  const btn      = e.target.querySelector("button[type='submit']");
  errEl.classList.add("hidden");

  if (password !== confirm) {
    errEl.textContent = "Passwords do not match.";
    errEl.classList.remove("hidden");
    return;
  }

  btn.textContent = "Saving…";
  btn.disabled = true;

  const { error } = await sb.auth.updateUser({ password });
  if (error) {
    errEl.textContent = error.message;
    errEl.classList.remove("hidden");
    btn.textContent = "Set new password";
    btn.disabled = false;
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

// ─── Group auto-create / invite join ─────────────────────────────────────────

async function createPersonalGroup() {
  const groupId = crypto.randomUUID();
  const { error: gErr } = await sb
    .from("groups")
    .insert({ id: groupId, name: "My Household", created_by: currentUser.id });
  if (gErr) throw gErr;
  const { error: mErr } = await sb
    .from("group_members")
    .insert({ group_id: groupId, user_id: currentUser.id, role: "owner" });
  if (mErr) throw mErr;
  currentGroupId = groupId;
}

async function joinViaToken(token) {
  let t = token;
  try { t = new URL(token).searchParams.get("invite") || token; } catch {}

  const { data: invite } = await sb
    .from("invite_tokens")
    .select("group_id, expires_at")
    .eq("token", t)
    .single();

  if (!invite || new Date(invite.expires_at) < new Date()) {
    await createPersonalGroup();
    return;
  }
  const { error } = await sb
    .from("group_members")
    .insert({ group_id: invite.group_id, user_id: currentUser.id, role: "member" });
  if (error) throw error;
  currentGroupId = invite.group_id;
}

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
    const btn = document.getElementById("btn-invite");

    try {
      await navigator.clipboard.writeText(url);
      const orig = btn.textContent;
      btn.textContent = "Link copied!";
      setTimeout(() => btn.textContent = orig, 2000);
    } catch {
      prompt("Copy this invite link and share it:", url);
    }
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
    applyLockState();
    return;
  }
  empty.classList.add("hidden");

  // Checked recipes always float to the top
  const thisWeek = recipes.filter(r => checkedIds.has(r.id));
  const theRest  = recipes.filter(r => !checkedIds.has(r.id));
  const ordered  = thisWeek.length ? [...thisWeek, ...theRest] : recipes;

  if (shoppingLocked && thisWeek.length) {
    const label = document.createElement("div");
    label.className = "recipe-section-label";
    label.textContent = "This week";
    grid.appendChild(label);
  }

  let dividerAdded = false;
  ordered.forEach(recipe => {
    const card = document.createElement("div");
    card.className = "recipe-card";
    card.dataset.id = recipe.id;

    const checked = checkedIds.has(recipe.id);

    // Add divider between this week's recipes and the rest (only when locked)
    if (shoppingLocked && thisWeek.length && !checked && !dividerAdded) {
      const divider = document.createElement("div");
      divider.className = "recipe-section-label recipe-section-rest";
      divider.textContent = "All recipes";
      grid.appendChild(divider);
      dividerAdded = true;
    }

    const cb = document.createElement("input");
    cb.type      = "checkbox";
    cb.className = "card-checkbox";
    cb.dataset.id = recipe.id;
    cb.checked   = checked;

    const name = document.createElement("div");
    name.className   = "card-name";
    name.textContent = recipe.name;

    const meta = document.createElement("div");
    meta.className   = "card-meta";
    if (recipe.cook_time) meta.textContent = `${recipe.cook_time} min`;

    card.appendChild(cb);
    card.appendChild(name);
    card.appendChild(meta);

    cb.addEventListener("change", e => {
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
  applyLockState();
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
    document.getElementById("field-cook-time").value = recipe.cook_time || "";
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
  document.getElementById("image-input-camera").click();
});

document.getElementById("image-gallery-trigger").addEventListener("click", () => {
  document.getElementById("image-input").click();
});

async function handleImageFiles(files, inputEl) {
  if (!files.length) return;

  if (files.length === 1) {
    // Single image: fill the form for review
    await handleImageFile(files[0], inputEl);
    return;
  }

  // Multiple images: parse and save all directly
  const inner       = document.querySelector(".image-upload-inner");
  const loading     = document.getElementById("image-loading");
  const loadingText = document.getElementById("image-loading-text");
  inner.classList.add("hidden");
  loading.classList.remove("hidden");

  let saved = 0, failed = 0;
  for (let i = 0; i < files.length; i++) {
    loadingText.textContent = `Reading recipe ${i + 1} of ${files.length}…`;
    try {
      const base64     = await compressImage(files[i]);
      const controller = new AbortController();
      const timeout    = setTimeout(() => controller.abort(), 30000);
      const res        = await fetch("/api/parse-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64, mediaType: "image/jpeg" }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Unknown error");
      loadingText.textContent = `Saving recipe ${i + 1} of ${files.length}…`;
      await apiSave(data);
      saved++;
    } catch {
      failed++;
    }
  }

  loading.classList.add("hidden");
  inner.classList.remove("hidden");
  inputEl.value = "";

  if (failed > 0) alert(`Saved ${saved} recipe${saved !== 1 ? "s" : ""}. ${failed} could not be read.`);
  await renderHome(true);
}

async function handleImageFile(file, inputEl) {
  if (!file) return;
  const inner       = document.querySelector(".image-upload-inner");
  const loading     = document.getElementById("image-loading");
  const loadingText = document.getElementById("image-loading-text");
  inner.classList.add("hidden");
  loading.classList.remove("hidden");
  loadingText.textContent = "Reading recipe…";

  try {
    const base64 = await compressImage(file);
    const res    = await fetch("/api/parse-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: base64, mediaType: "image/jpeg" }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Unknown error");
    fillFormFromRecipe(data);
  } catch (err) {
    alert("Could not read recipe: " + err.message);
  } finally {
    loading.classList.add("hidden");
    inner.classList.remove("hidden");
    inputEl.value = "";
  }
}

document.getElementById("image-input").addEventListener("change", e => handleImageFiles(e.target.files, e.target));
document.getElementById("image-input-camera").addEventListener("change", e => handleImageFiles(e.target.files, e.target));

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = ev => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const MAX = 1600;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
          else                { width  = Math.round(width  * MAX / height); height = MAX; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.82).split(",")[1]);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function fillFormFromRecipe(recipe) {
  if (recipe.name)      document.getElementById("field-name").value = recipe.name;
  if (recipe.serves)    document.getElementById("field-serves").value = recipe.serves;
  if (recipe.cook_time) document.getElementById("field-cook-time").value = recipe.cook_time;

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

  const name     = document.getElementById("field-name").value.trim();
  const serves   = parseInt(document.getElementById("field-serves").value, 10);
  const cookTime = parseInt(document.getElementById("field-cook-time").value, 10) || null;
  const editId   = document.getElementById("edit-id").value;

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

  const saveBtn = e.target.querySelector("button[type='submit']");
  saveBtn.textContent = "Normalising…";
  saveBtn.disabled = true;

  const normalisedIngredients = await normaliseIngredients(ingredients);

  saveBtn.textContent = "Saving…";

  const recipe = { name, serves, cook_time: cookTime, ingredients: normalisedIngredients, steps };
  if (editId) recipe.id = editId;

  try {
    await apiSave(recipe);
  } catch (err) {
    showError("Could not save recipe.");
    saveBtn.textContent = "Save Recipe";
    saveBtn.disabled = false;
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
  const cookTimeEl = document.getElementById("detail-cook-time");
  cookTimeEl.textContent = recipe.cook_time ? `${recipe.cook_time} min` : "";
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

// Unit conversion tables (to base unit)
const TO_G   = { g: 1, kg: 1000 };
const TO_ML  = { ml: 1, dl: 100, l: 1000 };
const TO_TSP = { tsp: 1, tbsp: 3, cup: 48 };

function unitFamily(u) {
  if (!u) return "__none__";
  if (u in TO_G)   return "weight";
  if (u in TO_ML)  return "volume";
  if (u in TO_TSP) return "spoon";
  return u; // pcs, pinch, slices, bunch — each its own group
}

function toBaseAmount(amount, unit) {
  if (unit in TO_G)   return amount * TO_G[unit];
  if (unit in TO_ML)  return amount * TO_ML[unit];
  if (unit in TO_TSP) return amount * TO_TSP[unit];
  return amount;
}

function fromBaseAmount(base, family) {
  if (family === "weight") {
    return base >= 1000
      ? { amount: base / 1000, unit: "kg" }
      : { amount: base, unit: "g" };
  }
  if (family === "volume") {
    if (base >= 1000) return { amount: base / 1000, unit: "l" };
    if (base >= 100)  return { amount: base / 100,  unit: "dl" };
    return { amount: base, unit: "ml" };
  }
  if (family === "spoon") {
    if (base >= 48) return { amount: base / 48, unit: "cup" };
    if (base >= 3)  return { amount: base / 3,  unit: "tbsp" };
    return { amount: base, unit: "tsp" };
  }
  return null;
}

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

  // name → { displayName, families: Map<family, baseAmount>, hasNoAmount }
  const nameMap = new Map();
  selected.forEach(recipe => {
    const scale = people / recipe.serves;
    recipe.ingredients.forEach(ing => {
      const key = ing.name.toLowerCase().trim();
      if (!nameMap.has(key)) nameMap.set(key, { displayName: ing.name, families: new Map(), hasNoAmount: false });
      const entry = nameMap.get(key);

      if (ing.amount == null) { entry.hasNoAmount = true; return; }

      const family = unitFamily(ing.unit);
      const base   = toBaseAmount(ing.amount * scale, ing.unit);
      entry.families.set(family, (entry.families.get(family) || 0) + base);
    });
  });

  Array.from(nameMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([key, entry]) => {
      const parts = [];
      entry.families.forEach((base, family) => {
        const converted = fromBaseAmount(base, family);
        if (converted) {
          parts.push(`${formatAmount(converted.amount)} ${converted.unit}`);
        } else {
          // pcs, pinch, slices, bunch, or no-unit
          const unit = family === "__none__" ? "" : ` ${family}`;
          parts.push(`${formatAmount(base)}${unit}`.trim());
        }
      });
      if (entry.hasNoAmount && parts.length === 0) parts.push("—");

      const amountStr = parts.join(" + ");
      const li = document.createElement("li");
      const gotIt = !!shoppingChecked[key];

      const cb = document.createElement("input");
      cb.type    = "checkbox";
      cb.title   = "Mark as got";
      cb.checked = gotIt;

      const amtSpan = document.createElement("span");
      amtSpan.className   = "shopping-amount";
      amtSpan.textContent = amountStr;

      const nameSpan = document.createElement("span");
      nameSpan.textContent = entry.displayName;

      li.appendChild(cb);
      li.appendChild(amtSpan);
      li.appendChild(nameSpan);
      if (gotIt) li.classList.add("checked");

      cb.addEventListener("change", e => {
        li.classList.toggle("checked", e.target.checked);
        shoppingChecked[key] = e.target.checked;
        savePlan();
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

document.getElementById("btn-lock-shopping").addEventListener("click", () => {
  shoppingLocked = !shoppingLocked;
  // When unlocking, clear the got-it ticks so the list is fresh next time
  if (!shoppingLocked) shoppingChecked = {};
  savePlan();
  applyLockState();
  if (!shoppingLocked) renderShoppingList();
});

function applyLockState() {
  const homeView = document.getElementById("view-home");
  const lockBtn  = document.getElementById("btn-lock-shopping");
  const people   = document.getElementById("home-people");

  homeView.classList.toggle("shopping-locked", shoppingLocked);
  lockBtn.textContent = shoppingLocked ? "🔓 Unlock Dinner Plan" : "🔒 Lock Dinner Plan";

  document.querySelectorAll(".card-checkbox").forEach(cb => {
    cb.disabled = shoppingLocked;
  });
  people.disabled = shoppingLocked;
}

// ─── Ingredient normalisation ─────────────────────────────────────────────────

async function normaliseIngredients(ingredients) {
  const existingNames = [...new Set(recipes.flatMap(r => r.ingredients.map(i => i.name)))];
  const newNames      = [...new Set(ingredients.map(i => i.name))];
  if (!existingNames.length) return ingredients;
  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 15000);
    const res = await fetch("/api/normalise-ingredients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newNames, existingNames }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const { mapping } = await res.json();
    return ingredients.map(ing => ({ ...ing, name: mapping[ing.name] ?? ing.name }));
  } catch {
    return ingredients;
  }
}

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
  } else {
    // New user — join via stored invite or auto-create a personal group
    const storedInvite = localStorage.getItem("pendingInvite");
    if (storedInvite) {
      localStorage.removeItem("pendingInvite");
      await joinViaToken(storedInvite);
    } else {
      await createPersonalGroup();
    }
  }

  pendingInviteToken = null;
  await loadPlan();
  await renderHome(true);
}

async function initApp() {
  const urlParams = new URLSearchParams(window.location.search);
  pendingInviteToken = urlParams.get("invite");
  if (pendingInviteToken) localStorage.setItem("pendingInvite", pendingInviteToken);

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
