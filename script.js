const SUPABASE_URL = "https://ckffdidxajqyezjvdrpa.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNrZmZkaWR4YWpxeWV6anZkcnBhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwMjAxODQsImV4cCI6MjA5ODU5NjE4NH0.FCVhoRJsZb7TkZ-KxczHM8iltFhMUlTSSfDhN6KOpoY";
const STORAGE_KEY = "protask_app_state_v3";
const PASSWORD_RECOVERY_KEY = "protask_password_recovery_request";

const titles = {
  login: "Inicio de sesión / Registro",
  dashboard: "Dashboard principal",
  project: "Vista de proyecto",
  timer: "Ejecución de micro tarea",
  history: "Historial de logros",
  profile: "Perfil y privacidad",
  admin: "Administración",
};

const defaultState = {
  users: [],
  currentUserId: "",
  activeProjectId: "",
  activeTimer: null,
};

const cloud = window.supabase?.createClient
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  : null;
let state = loadState();
let authMode = "login";
let timerInterval = null;
let secondsRemaining = 25 * 60;
let totalTimerSeconds = 25 * 60;
let passwordRecoveryMode = false;
let accountConfirmationMode = false;
let profileSnapshot = "";
let profileEditMode = false;
let pendingProfileAvatarUrl = "";
let avatarColumnAvailable = true;
let activeScreenId = "login";

const navItems = document.querySelectorAll("[data-screen]");
const screens = document.querySelectorAll(".screen");
const screenTitle = document.querySelector("#screen-title");
const sessionLabel = document.querySelector("#session-label");
const logoutButton = document.querySelector("#btn-logout");
const toast = document.querySelector("#toast");

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved ? { ...structuredClone(defaultState), ...saved } : structuredClone(defaultState);
  } catch (error) {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function currentUser() {
  return state.users.find((user) => user.id === state.currentUserId) || null;
}

function setCurrentUser(user) {
  const existingIndex = state.users.findIndex((item) => item.id === user.id);
  if (existingIndex >= 0) state.users[existingIndex] = user;
  else state.users.push(user);
  state.currentUserId = user.id;
  saveState();
}

function userProjects() {
  return currentUser()?.projects || [];
}

function activeProject() {
  return userProjects().find((project) => project.id === state.activeProjectId) || userProjects()[0] || null;
}

function ensureAuthenticated() {
  if (currentUser()) return true;
  showToast("Inicia sesión o crea una cuenta para continuar.");
  showScreen("login", { history: "replace" });
  return false;
}

function showScreen(screenId, options = {}) {
  if (screenId !== "login" && !ensureAuthenticated()) return;
  if (screenId === "admin" && currentUser()?.role !== "admin") {
    showToast("Solo un administrador puede acceder a este panel.");
    return;
  }

  activeScreenId = screenId;
  document.body.classList.toggle("login-mode", screenId === "login");
  screens.forEach((screen) => screen.classList.toggle("active", screen.id === screenId));
  navItems.forEach((item) => item.classList.toggle("active", item.dataset.screen === screenId));
  screenTitle.textContent = titles[screenId] || "ProTask";

  if (screenId === "dashboard") renderDashboard();
  if (screenId === "project") renderProjectDetail();
  if (screenId === "timer") setupTimerScreen();
  if (screenId === "history") renderHistoryTimeline();
  if (screenId === "profile") {
    profileEditMode = false;
    renderProfile();
  }
  if (screenId === "admin") renderAdminPanel();
  syncAppHistory(screenId, options.history || "push");
}

function syncAppHistory(screenId, mode = "push") {
  if (!window.history?.pushState || mode === "skip") return;

  const historyState = { protask: true, screenId };
  if (mode === "replace") {
    window.history.replaceState(historyState, document.title);
    return;
  }
  if (mode === "guard") {
    window.history.replaceState(historyState, document.title);
    window.history.pushState(historyState, document.title);
    return;
  }
  if (window.history.state?.protask && window.history.state.screenId === screenId) return;
  window.history.pushState(historyState, document.title);
}

window.addEventListener("popstate", (event) => {
  const requestedScreen = event.state?.protask ? event.state.screenId : null;

  if (!requestedScreen) {
    showScreen(currentUser() ? "dashboard" : "login", { history: "replace" });
    return;
  }

  if (requestedScreen === "login" && currentUser()) {
    showScreen("dashboard", { history: "replace" });
    return;
  }

  showScreen(requestedScreen, { history: "skip" });
});

function updateSessionUi() {
  const user = currentUser();
  sessionLabel.textContent = user ? `${user.name} · ${roleLabel(user.role)}` : "Sin sesión";
  logoutButton.classList.toggle("hidden", !user);
  navItems.forEach((item) => item.classList.toggle("locked", !user && item.dataset.screen !== "login"));
  document.querySelectorAll(".auth-nav").forEach((element) => {
    element.classList.toggle("hidden", Boolean(user));
  });
  document.querySelectorAll(".admin-only").forEach((element) => {
    element.classList.toggle("hidden", user?.role !== "admin");
  });
  renderSidebarSummary(user);
}

function renderSidebarSummary(user = currentUser()) {
  const weekSummary = document.querySelector("#sidebar-week-summary");
  const weekProgress = document.querySelector("#sidebar-week-progress");
  const projectSummary = document.querySelector("#sidebar-project-summary");
  if (!weekSummary || !weekProgress || !projectSummary) return;

  if (!user) {
    weekSummary.textContent = "0/10 micro tareas";
    weekProgress.style.width = "0%";
    projectSummary.textContent = "Inicia sesión para ver tu avance.";
    return;
  }

  const weeklyGoal = Number(user.weeklyGoal) || 10;
  const weekCompleted = (user.history || []).filter((item) => isCurrentWeek(new Date(item.completedAt))).length;
  const progress = Math.min(100, Math.round((weekCompleted / weeklyGoal) * 100));
  const projectCount = (user.projects || []).length;

  weekSummary.textContent = `${weekCompleted}/${weeklyGoal} micro tareas`;
  weekProgress.style.width = `${progress}%`;
  projectSummary.textContent = projectCount
    ? `${projectCount} ${projectCount === 1 ? "proyecto activo" : "proyectos activos"} en tu tablero.`
    : "Sin proyectos activos por ahora.";
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.add("hidden"), 3200);
}

function cloudReady() {
  return Boolean(cloud);
}

async function requireCloudSession() {
  if (!cloudReady()) return null;
  const { data, error } = await cloud.auth.getSession();
  if (error) throw error;
  return data.session;
}

async function loadCloudUser(authUser) {
  const userId = authUser.id;
  const email = authUser.email || "";
  let name = authUser.user_metadata?.name || email.split("@")[0] || "Usuario ProTask";
  let lastName = authUser.user_metadata?.last_name || "";
  let role = authUser.user_metadata?.role || "student";

  let { data: profile, error: profileError } = await cloud
    .from("profiles")
    .select("id, name, email, role, last_name, career, institution, goal, weekly_goal, focus_time, avatar_url, created_at")
    .eq("id", userId)
    .maybeSingle();

  if (profileError && isMissingColumnError(profileError, "avatar_url")) {
    avatarColumnAvailable = false;
    const fallback = await cloud
      .from("profiles")
      .select("id, name, email, role, last_name, career, institution, goal, weekly_goal, focus_time, created_at")
      .eq("id", userId)
      .maybeSingle();
    profile = fallback.data;
    profileError = fallback.error;
  }

  if (profileError) throw profileError;

  if (!profile) {
    const profilePayload = { id: userId, name, email, role, last_name: lastName };
    if (avatarColumnAvailable) profilePayload.avatar_url = "";
    const { error } = await cloud.from("profiles").insert(profilePayload);
    if (error) throw error;
  } else {
    name = profile.name || name;
    lastName = profile.last_name || lastName;
    role = profile.role || role;
  }

  const [{ data: projects, error: projectsError }, { data: history, error: historyError }, { data: reports, error: reportsError }] =
    await Promise.all([
      cloud.from("projects").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      cloud.from("task_history").select("*").eq("user_id", userId).order("completed_at", { ascending: false }),
      cloud.from("weekly_reports").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    ]);

  if (projectsError) throw projectsError;
  if (historyError) throw historyError;
  if (reportsError) throw reportsError;

  const projectIds = (projects || []).map((project) => project.id);
  let tasks = [];
  if (projectIds.length) {
    const { data, error } = await cloud
      .from("tasks")
      .select("*")
      .in("project_id", projectIds)
      .order("created_at", { ascending: true });
    if (error) throw error;
    tasks = data || [];
  }

  return {
    id: userId,
    name,
    email,
    role,
    lastName,
    career: profile?.career || "",
    institution: profile?.institution || "",
    goal: profile?.goal || "",
    weeklyGoal: profile?.weekly_goal || 10,
    focusTime: profile?.focus_time || 25,
    avatarUrl: profile?.avatar_url || "",
    password: "",
    createdAt: authUser.created_at || new Date().toISOString(),
    projects: (projects || []).map((project) => ({
      id: project.id,
      title: project.title,
      desc: project.description || "",
      deadline: project.deadline,
      tag: project.tag || "Académico",
      createdAt: project.created_at,
      tasks: tasks
        .filter((task) => task.project_id === project.id)
        .map((task) => ({
          id: task.id,
          name: task.name,
          time: task.minutes,
          status: task.status,
          createdAt: task.created_at,
        })),
    })),
    history: (history || []).map((item) => ({
      id: item.id,
      taskName: item.task_name,
      projectName: item.project_name,
      projectId: item.project_id,
      minutes: item.minutes,
      completedAt: item.completed_at,
      detail: item.detail,
    })),
    reports: (reports || []).map((item) => ({
      id: item.id,
      createdAt: item.created_at,
      tasks: item.tasks_count,
      minutes: item.minutes,
    })),
  };
}

async function refreshCloudState() {
  if (!cloudReady()) return;
  const session = await requireCloudSession();
  if (!session?.user) return;
  const user = await loadCloudUser(session.user);
  setCurrentUser(user);
}

async function saveProjectToCloud(project) {
  if (!cloudReady() || !currentUser()) return;
  const { error } = await cloud.from("projects").upsert({
    id: project.id,
    user_id: currentUser().id,
    title: project.title,
    description: project.desc,
    deadline: project.deadline,
    tag: project.tag,
    created_at: project.createdAt,
  });
  if (error) throw error;
}

async function deleteProjectFromCloud(projectId) {
  if (!cloudReady()) return;
  const { error } = await cloud.from("projects").delete().eq("id", projectId);
  if (error) throw error;
}

async function saveTaskToCloud(projectId, task) {
  if (!cloudReady() || !currentUser()) return;
  const { error } = await cloud.from("tasks").upsert({
    id: task.id,
    user_id: currentUser().id,
    project_id: projectId,
    name: task.name,
    minutes: task.time,
    status: task.status,
    created_at: task.createdAt,
  });
  if (error) throw error;
}

async function saveHistoryToCloud(historyItem) {
  if (!cloudReady() || !currentUser()) return;
  const { error } = await cloud.from("task_history").upsert({
    id: historyItem.id,
    user_id: currentUser().id,
    task_name: historyItem.taskName,
    project_name: historyItem.projectName,
    project_id: historyItem.projectId,
    minutes: historyItem.minutes,
    detail: historyItem.detail,
    completed_at: historyItem.completedAt,
  });
  if (error) throw error;
}

async function saveReportToCloud(report) {
  if (!cloudReady() || !currentUser()) return;
  const { error } = await cloud.from("weekly_reports").upsert({
    id: report.id,
    user_id: currentUser().id,
    tasks_count: report.tasks,
    minutes: report.minutes,
    created_at: report.createdAt,
  });
  if (error) throw error;
}

async function invokeWeeklyEmail(report) {
  if (!cloudReady()) return { sent: false, reason: "Supabase no está disponible." };
  const { data, error } = await cloud.functions.invoke("send-emails", {
    body: {
      name: currentUser().name,
      email: currentUser().email,
      tasks: report.tasks,
      minutes: report.minutes,
      generatedAt: report.createdAt,
    },
  });
  if (error) throw error;
  return data;
}

navItems.forEach((item) => {
  item.addEventListener("click", () => showScreen(item.dataset.screen));
});

document.querySelector("#tab-login").addEventListener("click", () => setAuthMode("login"));
document.querySelector("#tab-register").addEventListener("click", () => setAuthMode("register"));

function setAuthMode(mode) {
  authMode = mode;
  showAuthPanel("auth");
  document.querySelector("#tab-login").classList.toggle("active", mode === "login");
  document.querySelector("#tab-register").classList.toggle("active", mode === "register");
  document.querySelectorAll(".register-only").forEach((element) => element.classList.toggle("hidden", mode !== "register"));
  document.querySelector("#btn-auth").textContent = mode === "login" ? "Entrar al tablero" : "Crear cuenta";
  document.querySelector("#auth-note").textContent = cloudReady()
    ? "Conectado a Supabase Auth y base de datos."
    : "Modo local: no se pudo cargar el cliente de Supabase.";
}

function showAuthPanel(panel) {
  document.querySelector("#auth-form").classList.toggle("hidden", panel !== "auth");
  document.querySelector("#recovery-form").classList.toggle("hidden", panel !== "recovery");
  document.querySelector("#new-password-form").classList.toggle("hidden", panel !== "new-password");
}

document.querySelector("#btn-forgot-password").addEventListener("click", () => {
  document.querySelector("#recovery-email").value = document.querySelector("#auth-email").value.trim();
  showAuthPanel("recovery");
});

document.querySelector("#btn-back-login").addEventListener("click", () => {
  passwordRecoveryMode = false;
  showAuthPanel("auth");
});

document.querySelector("#recovery-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.querySelector("#recovery-email").value.trim().toLowerCase();
  if (!email) return showToast("Ingresa el correo de tu cuenta.");
  if (!cloudReady()) return showToast("No se cargó Supabase. Revisa tu conexión.");
  if (window.location.protocol === "file:") {
    return showToast("Para recuperar contraseña abre la app desde localhost o una URL publicada, no como archivo.");
  }

  try {
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { error } = await cloud.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
    localStorage.setItem(PASSWORD_RECOVERY_KEY, JSON.stringify({ email, requestedAt: Date.now() }));
    showToast("Correo de recuperación enviado. Revisa tu bandeja de entrada.");
    showAuthPanel("auth");
  } catch (error) {
    showToast(error.message || "No se pudo enviar el correo de recuperación.");
  }
});

document.querySelector("#new-password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = document.querySelector("#new-password").value.trim();
  const confirmPassword = document.querySelector("#confirm-password").value.trim();
  if (password.length < 6) return showToast("La contraseña debe tener al menos 6 caracteres.");
  if (password !== confirmPassword) return showToast("Las contraseñas no coinciden.");

  try {
    const { error } = await cloud.auth.updateUser({ password });
    if (error) throw error;
    passwordRecoveryMode = false;
    localStorage.removeItem(PASSWORD_RECOVERY_KEY);
    await cloud.auth.signOut();
    showToast("Contraseña actualizada. Inicia sesión nuevamente.");
    showAuthPanel("auth");
  } catch (error) {
    showToast(error.message || "No se pudo actualizar la contraseña.");
  }
});

document.querySelector("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.querySelector("#auth-email").value.trim().toLowerCase();
  const password = document.querySelector("#auth-password").value.trim();
  const name = document.querySelector("#auth-name").value.trim();
  const lastName = document.querySelector("#auth-last-name").value.trim();

  if (!email || !password) return showToast("Ingresa correo y contraseña.");
  if (!cloudReady()) return showToast("No se cargó Supabase. Revisa tu conexión a Internet.");

  try {
    if (authMode === "register") {
      if (!name) return showToast("Ingresa tu nombre para crear la cuenta.");
      if (!lastName) return showToast("Ingresa tu apellido para crear la cuenta.");
      if (!document.querySelector("#accept-terms").checked) return showToast("Debes aceptar términos y privacidad.");

      const { data, error } = await cloud.auth.signUp({
        email,
        password,
        options: { data: { name, last_name: lastName, role: "student" } },
      });
      if (error) throw error;
      if (!data.session || !data.user) return showToast("Cuenta creada. Revisa tu correo para confirmar antes de iniciar sesión.");
      const user = await loadCloudUser(data.user);
      setCurrentUser(user);
      updateSessionUi();
      showScreen("dashboard", { history: "guard" });
      return showToast("Cuenta creada en Supabase.");
    }

    const { data, error } = await cloud.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const user = await loadCloudUser(data.user);
    setCurrentUser(user);
    state.activeProjectId = user.projects[0]?.id || "";
    saveState();
    updateSessionUi();
    showScreen("dashboard", { history: "guard" });
    showToast("Sesión iniciada con Supabase.");
  } catch (error) {
    showToast(error.message || "No se pudo completar el acceso.");
  }
});

logoutButton.addEventListener("click", async () => {
  stopTimer();
  if (cloudReady()) await cloud.auth.signOut();
  state.currentUserId = "";
  state.activeProjectId = "";
  state.activeTimer = null;
  saveState();
  updateSessionUi();
  showScreen("login", { history: "replace" });
});

document.querySelector("#project-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const user = currentUser();
  const titleInput = document.querySelector("#new-project-title");
  const descInput = document.querySelector("#new-project-desc");
  const deadlineInput = document.querySelector("#new-project-deadline");
  const tagInput = document.querySelector("#new-project-tag");
  const today = getTodayInputValue();

  if (!titleInput.value.trim()) return showToast("Ingresa el objetivo principal del proyecto.");
  if (!deadlineInput.value) return showToast("Define una fecha límite.");
  if (deadlineInput.value < today) return showToast("Elige una fecha límite desde hoy en adelante.");

  const newProject = {
    id: createUuid(),
    title: titleInput.value.trim(),
    desc: descInput.value.trim() || "Sin descripción proporcionada.",
    deadline: deadlineInput.value,
    tag: tagInput.value,
    createdAt: new Date().toISOString(),
    tasks: [],
  };

  try {
    await saveProjectToCloud(newProject);
    user.projects.unshift(newProject);
    state.activeProjectId = newProject.id;
    saveState();
    event.target.reset();
    setProjectDeadlineMin();
    renderDashboard();
    showToast("Proyecto guardado en Supabase.");
  } catch (error) {
    showToast(error.message || "No se pudo guardar el proyecto.");
  }
});

document.querySelector("#project-search").addEventListener("input", renderDashboard);
document.querySelector("#project-filter").addEventListener("change", renderDashboard);
document.querySelector("#btn-go-to-project").addEventListener("click", () => showScreen("project"));

function setProjectDeadlineMin() {
  const deadlineInput = document.querySelector("#new-project-deadline");
  const today = getTodayInputValue();
  deadlineInput.min = today;
  if (deadlineInput.value && deadlineInput.value < today) deadlineInput.value = today;
}

function renderDashboard() {
  const projects = userProjects();
  const project = activeProject();
  const container = document.querySelector("#projects-container");
  const search = document.querySelector("#project-search").value.trim().toLowerCase();
  const filter = document.querySelector("#project-filter").value;
  renderSidebarSummary();
  setProjectDeadlineMin();
  document.querySelector("#project-count-label").textContent = `${projects.length} ${projects.length === 1 ? "proyecto" : "proyectos"}`;

  if (project && !state.activeProjectId) {
    state.activeProjectId = project.id;
    saveState();
  }

  renderMainProject(project);
  renderWeeklyChart();

  const filtered = projects.filter((item) => {
    const matchesSearch = `${item.title} ${item.desc}`.toLowerCase().includes(search);
    const matchesFilter = filter === "all" || item.tag === filter;
    return matchesSearch && matchesFilter;
  });

  if (!filtered.length) {
    container.innerHTML = `<p class="empty-state">No hay proyectos para mostrar. Crea uno o ajusta los filtros.</p>`;
    return;
  }

  container.innerHTML = "";
  filtered.forEach((item) => {
    const stats = calculateProjectMetrics(item);
    const article = document.createElement("article");
    article.className = "project-card-item";
    if (item.id === state.activeProjectId) article.classList.add("selected");
    article.innerHTML = `
      <div class="card-head">
        <span class="tag">${escapeHtml(item.tag)}</span>
        <button class="delete-project-btn" type="button" aria-label="Eliminar proyecto">×</button>
      </div>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.desc)}</p>
      <div class="progress-line"><span style="width: ${stats.percent}%"></span></div>
      <div class="project-card-meta">
        <small>${stats.completed}/${item.tasks.length} micro tareas</small>
        <small>${daysLeftLabel(item.deadline)}</small>
      </div>
    `;
    article.querySelector(".delete-project-btn").addEventListener("click", (event) => {
      event.stopPropagation();
      deleteProject(item.id);
    });
    article.addEventListener("click", () => {
      state.activeProjectId = item.id;
      saveState();
      showScreen("project");
    });
    container.appendChild(article);
  });
}

function renderMainProject(project) {
  if (!project) {
    document.querySelector("#main-project-title").textContent = "No hay proyectos activos";
    document.querySelector("#main-project-desc").textContent = "Crea un proyecto para comenzar a organizar tus pendientes.";
    document.querySelector("#main-project-tag").textContent = "Sin proyecto";
    document.querySelector("#main-project-days").textContent = "-";
    document.querySelector("#main-project-percent").textContent = "0%";
    document.querySelector("#main-project-progress-bar").style.width = "0%";
    document.querySelector("#main-project-tasks-count").textContent = "0";
    return;
  }

  const stats = calculateProjectMetrics(project);
  document.querySelector("#main-project-title").textContent = project.title;
  document.querySelector("#main-project-desc").textContent = project.desc || "Sin descripción proporcionada.";
  document.querySelector("#main-project-tag").textContent = project.tag || "Proyecto";
  document.querySelector("#main-project-days").textContent = daysLeft(project.deadline);
  document.querySelector("#main-project-percent").textContent = `${stats.percent}%`;
  document.querySelector("#main-project-progress-bar").style.width = `${stats.percent}%`;
  document.querySelector("#main-project-tasks-count").textContent = project.tasks.length;
}

function renderWeeklyChart() {
  const user = currentUser();
  const counts = [0, 0, 0, 0, 0, 0, 0];
  user.history.forEach((item) => {
    const date = new Date(item.completedAt);
    if (isCurrentWeek(date)) counts[(date.getDay() + 6) % 7] += 1;
  });
  const max = Math.max(1, ...counts);
  document.querySelectorAll("#dashboard-mini-chart span").forEach((span, index) => {
    span.style.height = `${Math.round((counts[index] / max) * 100)}%`;
  });
  const total = counts.reduce((sum, count) => sum + count, 0);
  document.querySelector("#week-summary").textContent = total
    ? `${total} sesiones completadas durante la semana actual.`
    : "Sin sesiones registradas esta semana.";
}

async function deleteProject(projectId) {
  if (!confirm("¿Estás seguro de que deseas eliminar este proyecto?")) return;
  try {
    await deleteProjectFromCloud(projectId);
    const user = currentUser();
    user.projects = user.projects.filter((project) => project.id !== projectId);
    if (state.activeProjectId === projectId) state.activeProjectId = user.projects[0]?.id || "";
    saveState();
    renderDashboard();
    showToast("Proyecto eliminado.");
  } catch (error) {
    showToast(error.message || "No se pudo eliminar.");
  }
}

document.querySelector("#task-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const project = activeProject();
  const nameInput = document.querySelector("#new-task-name");
  const timeInput = document.querySelector("#new-task-time");
  const minutes = Number.parseInt(timeInput.value, 10);

  if (!project) return showToast("Crea o selecciona un proyecto primero.");
  if (!nameInput.value.trim()) return showToast("Ingresa el nombre de la micro tarea.");
  if (Number.isNaN(minutes) || minutes < 15 || minutes > 25) return showToast("La micro tarea debe durar entre 15 y 25 minutos.");

  const hasCurrent = project.tasks.some((task) => task.status === "current");
  const task = {
    id: createUuid(),
    name: nameInput.value.trim(),
    time: minutes,
    status: hasCurrent ? "pending" : "current",
    createdAt: new Date().toISOString(),
  };

  try {
    await saveTaskToCloud(project.id, task);
    project.tasks.push(task);
    saveState();
    event.target.reset();
    document.querySelector("#new-task-time").value = 25;
    renderProjectDetail();
    showToast("Micro tarea guardada en Supabase.");
  } catch (error) {
    showToast(error.message || "No se pudo guardar la micro tarea.");
  }
});

document.querySelector("#btn-suggest-tasks").addEventListener("click", createSuggestedTasks);

function renderProjectDetail() {
  const project = activeProject();
  const container = document.querySelector("#tasks-container");
  const suggestButton = document.querySelector("#btn-suggest-tasks");

  if (!project) {
    document.querySelector("#project-view-title").textContent = "Ningún proyecto activo";
    document.querySelector("#project-view-desc").textContent = "Crea o selecciona un proyecto en el Dashboard para ver sus micro tareas.";
    document.querySelector("#btn-start-next").style.display = "none";
    suggestButton.disabled = true;
    container.innerHTML = "";
    return;
  }

  suggestButton.disabled = false;
  state.activeProjectId = project.id;
  saveState();
  document.querySelector("#project-view-title").textContent = project.title;
  document.querySelector("#project-view-desc").textContent = `${project.desc} · ${project.tag} · ${daysLeftLabel(project.deadline)}`;

  if (!project.tasks.length) {
    container.innerHTML = `<p class="empty-state">Este proyecto no tiene micro tareas todavía. Desglosa el objetivo en bloques pequeños.</p>`;
  } else {
    container.innerHTML = "";
    project.tasks.forEach((task) => {
      const card = document.createElement("article");
      card.className = `task-card ${task.status}`;
      card.innerHTML = `
        <div>
          <span class="status-lbl">${statusLabel(task.status)}</span>
          <h3>${escapeHtml(task.name)}</h3>
        </div>
        <div>
          <p>${task.time} min</p>
          <div class="task-actions-div">
            ${task.status !== "done" ? `<button class="primary-action compact task-focus" type="button">Foco</button>` : ""}
            ${task.status !== "done" ? `<button class="secondary-action compact task-done" type="button">Completar</button>` : ""}
          </div>
        </div>
      `;
      const focusButton = card.querySelector(".task-focus");
      const doneButton = card.querySelector(".task-done");
      if (focusButton) focusButton.addEventListener("click", () => setTaskAsCurrent(task.id, true));
      if (doneButton) doneButton.addEventListener("click", () => completeTask(task.id, "Completada manualmente."));
      container.appendChild(card);
    });
  }

  const currentTask = project.tasks.find((task) => task.status === "current");
  const startButton = document.querySelector("#btn-start-next");
  startButton.style.display = currentTask ? "inline-flex" : "none";
  startButton.textContent = "Foco";
  startButton.title = currentTask ? `Abrir temporizador: ${currentTask.name}` : "Abrir temporizador";
}

async function createSuggestedTasks() {
  const project = activeProject();
  if (!project) return showToast("Selecciona un proyecto primero.");

  const suggestions = buildSuggestedTasks(project);
  const existingNames = new Set(project.tasks.map((task) => normalizeText(task.name)));
  const nextSuggestions = suggestions.filter((task) => !existingNames.has(normalizeText(task.name))).slice(0, 10);
  if (!nextSuggestions.length) return showToast("El proyecto ya tiene esas micro tareas sugeridas.");

  const hasCurrent = project.tasks.some((task) => task.status === "current");
  const newTasks = nextSuggestions.map((suggestion, index) => ({
    id: createUuid(),
    name: suggestion.name,
    time: suggestion.time,
    status: !hasCurrent && index === 0 ? "current" : "pending",
    createdAt: new Date().toISOString(),
  }));

  try {
    await Promise.all(newTasks.map((task) => saveTaskToCloud(project.id, task)));
    project.tasks.push(...newTasks);
    saveState();
    renderProjectDetail();
    const totalMinutes = newTasks.reduce((sum, task) => sum + task.time, 0);
    showToast(`${newTasks.length} micro tareas creadas (${totalMinutes} min estimados).`);
  } catch (error) {
    showToast(error.message || "No se pudieron crear las micro tareas.");
  }
}

function buildSuggestedTasks(project) {
  const text = normalizeText(`${project.title} ${project.desc}`);
  const descriptionParts = splitProjectDescription(project.desc);

  if (text.includes("entrevista") || text.includes("ingles") || text.includes("oral")) {
    return [
      taskSuggestion("Preparar vocabulario clave", 20),
      taskSuggestion("Practicar pronunciación", 20),
      taskSuggestion("Escribir respuestas posibles", 25),
      taskSuggestion("Ensayar respuestas personales", 25),
      taskSuggestion("Simular entrevista completa", 20),
      taskSuggestion("Revisar errores y mejorar fluidez", 15),
    ];
  }

  if (text.includes("ensayo") || text.includes("informe") || text.includes("redaccion") || text.includes("redactar")) {
    return [
      taskSuggestion("Reunir información principal", 25),
      taskSuggestion("Ordenar ideas y estructura", 20),
      taskSuggestion("Redactar primer apartado", 25),
      taskSuggestion("Redactar segundo apartado", 25),
      taskSuggestion("Revisar coherencia y ortografía", 20),
      taskSuggestion("Preparar versión final", 15),
    ];
  }

  if (text.includes("presentacion") || text.includes("exposicion") || text.includes("diapositiva")) {
    return [
      taskSuggestion("Definir puntos principales", 20),
      taskSuggestion("Crear diapositivas base", 25),
      taskSuggestion("Preparar guion breve", 20),
      taskSuggestion("Ensayar presentación", 25),
      taskSuggestion("Ajustar tiempos de exposición", 15),
      taskSuggestion("Revisar diseño final", 15),
    ];
  }

  if (text.includes("investigacion") || text.includes("investigar")) {
    return [
      taskSuggestion("Definir pregunta de investigación", 20),
      taskSuggestion("Buscar fuentes confiables", 25),
      taskSuggestion("Tomar apuntes clave", 25),
      taskSuggestion("Organizar hallazgos", 20),
      taskSuggestion("Redactar conclusiones", 25),
      taskSuggestion("Revisar fuentes y formato", 15),
    ];
  }

  if (descriptionParts.length >= 2) return descriptionParts;

  return [
    taskSuggestion("Definir objetivo específico", 15),
    taskSuggestion("Reunir material necesario", 20),
    taskSuggestion("Completar primer avance", 25),
    taskSuggestion("Completar segundo avance", 25),
    taskSuggestion("Revisar el resultado", 20),
    taskSuggestion("Preparar entrega final", 15),
  ];
}

function splitProjectDescription(description = "") {
  return description
    .split(/[,.;]|\sy\s|\se\s|\s\/\s/gi)
    .map((part) => part.trim())
    .filter((part) => part.length > 3 && !normalizeText(part).includes("sin descripcion"))
    .flatMap((part) => expandEstimatedActivity(capitalizeTaskName(part), estimateActivityMinutes(part)))
    .slice(0, 10);
}

function capitalizeTaskName(value) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : clean;
}

function taskSuggestion(name, estimatedMinutes = 20) {
  return {
    name,
    time: clampMicroTaskMinutes(estimatedMinutes),
  };
}

function estimateActivityMinutes(value = "") {
  const normalized = normalizeText(value);
  const words = normalized.split(" ").filter(Boolean).length;
  let minutes = 20;

  if (words >= 5) minutes += 10;
  if (/(investigar|buscar|analizar|redactar|desarrollar|resolver|ensayar|simular|crear|preparar)/.test(normalized)) minutes += 15;
  if (/(revisar|ordenar|practicar|estudiar|corregir|organizar)/.test(normalized)) minutes += 10;
  if (/(completo|completa|final|entrega|informe|ensayo|presentacion|entrevista)/.test(normalized)) minutes += 10;

  return Math.min(75, Math.max(15, minutes));
}

function expandEstimatedActivity(name, estimatedMinutes) {
  const minutes = distributeEstimatedMinutes(estimatedMinutes);
  if (minutes.length === 1) return [taskSuggestion(name, minutes[0])];

  if (minutes.length === 2) {
    return [
      taskSuggestion(`Iniciar ${lowerFirst(name)}`, minutes[0]),
      taskSuggestion(`Completar ${lowerFirst(name)}`, minutes[1]),
    ];
  }

  return [
    taskSuggestion(`Preparar ${lowerFirst(name)}`, minutes[0]),
    taskSuggestion(`Desarrollar ${lowerFirst(name)}`, minutes[1]),
    taskSuggestion(`Revisar ${lowerFirst(name)}`, minutes[2]),
  ];
}

function distributeEstimatedMinutes(estimatedMinutes) {
  if (estimatedMinutes <= 17) return [15];
  if (estimatedMinutes <= 22) return [20];
  if (estimatedMinutes <= 25) return [25];
  if (estimatedMinutes <= 40) return [20, 20];
  if (estimatedMinutes <= 45) return [25, 20];
  if (estimatedMinutes <= 50) return [25, 25];
  if (estimatedMinutes <= 60) return [20, 20, 20];
  return [25, 25, 20];
}

function clampMicroTaskMinutes(value) {
  if (value <= 17) return 15;
  if (value <= 22) return 20;
  return 25;
}

function lowerFirst(value) {
  return value ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}

function normalizeText(value = "") {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function setTaskAsCurrent(taskId, openTimer = false) {
  const project = activeProject();
  if (!project) return;
  const selectedTask = project.tasks.find((task) => task.id === taskId);
  if (!selectedTask || selectedTask.status === "done") return;

  if (state.activeTimer?.status === "running" && state.activeTimer.taskId !== taskId) {
    return showToast("Finaliza o pausa la sesión activa antes de iniciar otra.");
  }

  const changed = [];
  project.tasks.forEach((task) => {
    const previous = task.status;
    if (task.status === "current") task.status = "pending";
    if (task.id === taskId) task.status = "current";
    if (task.status !== previous) changed.push(task);
  });
  try {
    await Promise.all(changed.map((task) => saveTaskToCloud(project.id, task)));
    saveState();
    renderProjectDetail();
    if (openTimer) startTimerForTask(project, selectedTask);
  } catch (error) {
    showToast(error.message || "No se pudo cambiar el foco.");
  }
}

document.querySelector("#btn-start-next").addEventListener("click", () => {
  const project = activeProject();
  const task = project?.tasks.find((item) => item.status === "current");
  if (!task) return showToast("Selecciona una micro tarea en foco.");
  startTimerForTask(project, task);
});

function startTimerForTask(project, task) {
  if (state.activeTimer?.status === "running" && state.activeTimer.taskId !== task.id) {
    return showToast("Finaliza o pausa la sesión activa antes de iniciar otra.");
  }

  if (state.activeTimer?.taskId === task.id && state.activeTimer?.projectId === project.id) {
    showScreen("timer");
    return;
  }

  state.activeTimer = {
    projectId: project.id,
    taskId: task.id,
    startedAt: new Date().toISOString(),
    status: "ready",
    remaining: task.time * 60,
    total: task.time * 60,
  };
  saveState();
  showScreen("timer");
}

function setupTimerScreen() {
  const timerData = getTimerData();
  const checklistContainer = document.querySelector("#timer-checklist-container");
  stopTimer(false);

  if (!timerData) {
    secondsRemaining = 25 * 60;
    totalTimerSeconds = 25 * 60;
    document.querySelector("#timer-current-task-title").textContent = "No hay una tarea activa en ejecución";
    document.querySelector("#timer-current-project").textContent = "Selecciona una micro tarea desde la vista de proyecto.";
    checklistContainer.innerHTML = `<p class="muted-text">El temporizador se activa cuando eliges una micro tarea en foco.</p>`;
    document.querySelector("#timer-toggle").disabled = true;
    document.querySelector("#timer-complete").disabled = true;
    renderTimer();
    return;
  }

  secondsRemaining = timerData.timer.remaining;
  totalTimerSeconds = timerData.timer.total;
  document.querySelector("#timer-current-task-title").textContent = timerData.task.name;
  document.querySelector("#timer-current-project").textContent = timerData.project.title;
  document.querySelector("#timer-toggle").disabled = false;
  document.querySelector("#timer-complete").disabled = false;
  document.querySelector("#timer-toggle").textContent = "Iniciar";
  checklistContainer.innerHTML = `
    <label class="check-row"><input type="checkbox" checked /> Preparar espacio de estudio sin distractores</label>
    <label class="check-row"><input type="checkbox" /> Ejecutar micro tarea: <strong>${escapeHtml(timerData.task.name)}</strong></label>
    <label class="check-row"><input type="checkbox" /> Registrar avance o evidencia de trabajo</label>
  `;
  renderTimer();
}

document.querySelector("#timer-toggle").addEventListener("click", () => {
  const timerData = getTimerData();
  if (!timerData) return showToast("No hay una micro tarea activa.");

  if (timerInterval) {
    stopTimer(true);
    document.querySelector("#timer-toggle").textContent = "Continuar";
    return;
  }

  state.activeTimer.status = "running";
  saveState();
  document.querySelector("#timer-toggle").textContent = "Pausar";
  timerInterval = setInterval(() => {
    secondsRemaining = Math.max(0, secondsRemaining - 1);
    state.activeTimer.remaining = secondsRemaining;
    saveState();
    renderTimer();
    if (secondsRemaining === 0) finishActiveTimer("Completada al finalizar el temporizador.");
  }, 1000);
});

document.querySelector("#timer-reset").addEventListener("click", () => {
  const timerData = getTimerData();
  if (!timerData) return;
  stopTimer(false);
  secondsRemaining = timerData.task.time * 60;
  totalTimerSeconds = timerData.task.time * 60;
  state.activeTimer.remaining = secondsRemaining;
  state.activeTimer.total = totalTimerSeconds;
  state.activeTimer.status = "ready";
  saveState();
  document.querySelector("#timer-toggle").textContent = "Iniciar";
  renderTimer();
});

document.querySelector("#timer-complete").addEventListener("click", () => finishActiveTimer("Completada desde el temporizador."));
document.querySelector("#timer-back-project").addEventListener("click", () => showScreen("project"));

function stopTimer(keepPaused = true) {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  if (keepPaused && state.activeTimer) {
    state.activeTimer.status = "paused";
    state.activeTimer.remaining = secondsRemaining;
    saveState();
  }
}

function getTimerData() {
  if (!state.activeTimer) return null;
  const project = userProjects().find((item) => item.id === state.activeTimer.projectId);
  const task = project?.tasks.find((item) => item.id === state.activeTimer.taskId);
  return project && task && task.status !== "done" ? { project, task, timer: state.activeTimer } : null;
}

function finishActiveTimer(detail) {
  const timerData = getTimerData();
  if (!timerData) return;
  stopTimer(false);
  completeTask(timerData.task.id, detail, timerData.project.id);
  state.activeTimer = null;
  saveState();
  showToast("Sesión terminada de forma exitosa.");
  showScreen("project");
}

function renderTimer() {
  const minutes = Math.floor(secondsRemaining / 60).toString().padStart(2, "0");
  const seconds = (secondsRemaining % 60).toString().padStart(2, "0");
  const percent = totalTimerSeconds ? Math.round(((totalTimerSeconds - secondsRemaining) / totalTimerSeconds) * 100) : 0;
  document.querySelector("#timer-display").textContent = `${minutes}:${seconds}`;
  document.querySelector("#timer-ring").style.setProperty("--timer-progress", `${percent}%`);
}

async function completeTask(taskId, detail, projectId = state.activeProjectId) {
  const project = userProjects().find((item) => item.id === projectId);
  const task = project?.tasks.find((item) => item.id === taskId);
  if (!project || !task || task.status === "done") return;

  try {
    task.status = "done";
    await saveTaskToCloud(project.id, task);

    const historyItem = {
      id: createUuid(),
      taskName: task.name,
      projectName: project.title,
      projectId: project.id,
      minutes: task.time,
      completedAt: new Date().toISOString(),
      detail,
    };
    await saveHistoryToCloud(historyItem);
    currentUser().history.unshift(historyItem);

    const nextTask = project.tasks.find((item) => item.status === "pending");
    if (nextTask) {
      nextTask.status = "current";
      await saveTaskToCloud(project.id, nextTask);
    }
    saveState();
    renderSidebarSummary();
    renderProjectDetail();
  } catch (error) {
    showToast(error.message || "No se pudo completar la tarea.");
  }
}

function renderHistoryTimeline() {
  const user = currentUser();
  const history = user.history;
  const container = document.querySelector("#history-timeline-container");
  const totalMinutes = history.reduce((sum, item) => sum + item.minutes, 0);
  const average = history.length ? Math.round(totalMinutes / history.length) : 0;

  document.querySelector("#history-count").textContent = history.length;
  document.querySelector("#history-total-time").textContent = totalMinutes;
  document.querySelector("#history-average").textContent = average;
  document.querySelector("#history-streak").textContent = calculateStreak(history);
  document.querySelector("#history-global-progress").style.width = history.length ? `${Math.min(100, history.length * 10)}%` : "0%";

  if (!history.length) {
    container.innerHTML = `<div class="empty-state"><h3>Historial limpio</h3><p>Aún no registras tareas completadas en esta cuenta.</p></div>`;
    return;
  }

  container.innerHTML = "";
  history.forEach((item) => {
    const article = document.createElement("article");
    article.innerHTML = `
      <time>${formatDateTime(item.completedAt)}</time>
      <h3>${escapeHtml(item.taskName)}</h3>
      <p><strong>Proyecto:</strong> ${escapeHtml(item.projectName)} · ${item.minutes} min</p>
      <p>${escapeHtml(item.detail)}</p>
    `;
    container.appendChild(article);
  });
}

document.querySelector("#btn-weekly-report").addEventListener("click", async () => {
  const user = currentUser();
  const weekItems = user.history.filter((item) => isCurrentWeek(new Date(item.completedAt)));
  const minutes = weekItems.reduce((sum, item) => sum + item.minutes, 0);
  const report = {
    id: createUuid(),
    createdAt: new Date().toISOString(),
    tasks: weekItems.length,
    minutes,
  };

  try {
    await saveReportToCloud(report);
    user.reports.unshift(report);
    saveState();
    const emailResult = await invokeWeeklyEmail(report);
    showToast(
      emailResult?.sent
        ? "Reporte semanal guardado y enviado por correo."
        : "Reporte guardado. Falta desplegar la función de correo."
    );
  } catch (error) {
    showToast(error.message || "Reporte guardado, pero no se pudo enviar el correo.");
  }
});

function renderProfile() {
  const user = currentUser();
  const fullName = [user.name, user.lastName].filter(Boolean).join(" ") || "Usuario ProTask";
  pendingProfileAvatarUrl = user.avatarUrl || "";
  renderProfilePhoto(user);
  document.querySelector("#profile-view-fullname").textContent = fullName;
  document.querySelector("#profile-view-email").textContent = user.email;
  document.querySelector("#profile-view-career").textContent = user.career || "Sin información";
  document.querySelector("#profile-view-institution").textContent = user.institution || "Sin información";
  document.querySelector("#profile-view-goal").textContent = user.goal || "Sin información";
  document.querySelector("#profile-view-weekly-goal").textContent = `${user.weeklyGoal || 10} micro tareas`;
  document.querySelector("#profile-view-focus-time").textContent = `${user.focusTime || 25} minutos`;

  document.querySelector("#profile-name").value = user.name || "";
  document.querySelector("#profile-last-name").value = user.lastName || "";
  document.querySelector("#profile-email").value = user.email;
  document.querySelector("#profile-career").value = user.career || "";
  document.querySelector("#profile-institution").value = user.institution || "";
  document.querySelector("#profile-goal").value = user.goal || "";
  document.querySelector("#profile-weekly-goal").value = user.weeklyGoal || 10;
  document.querySelector("#profile-focus-time").value = String(user.focusTime || 25);
  document.querySelector("#profile-role-label").textContent = roleLabel(user.role);
  document.querySelector("#profile-created-label").textContent = user.createdAt ? formatShortDate(user.createdAt) : "-";
  document.querySelector("#profile-projects-label").textContent = user.projects.length;
  profileSnapshot = getProfileFormSnapshot();
  updateProfileSaveState();
  setProfileEditMode(profileEditMode);
}

function setProfileEditMode(isEditing) {
  profileEditMode = isEditing;
  document.querySelector("#profile-view-card").classList.toggle("hidden", isEditing);
  document.querySelector("#profile-form").classList.toggle("hidden", !isEditing);
  if (isEditing) updateProfileSaveState();
}

function renderProfilePhoto(user) {
  const initials = getInitials(user.name, user.lastName);
  setProfilePhoto("#profile-view-avatar", "#profile-view-initials", user.avatarUrl || "", initials);
  setProfilePhoto("#profile-edit-avatar", "#profile-edit-initials", pendingProfileAvatarUrl, initials);
  document.querySelector("#btn-remove-avatar").disabled = !pendingProfileAvatarUrl;
}

function setProfilePhoto(imageSelector, fallbackSelector, avatarUrl, initials) {
  const image = document.querySelector(imageSelector);
  const fallback = document.querySelector(fallbackSelector);
  fallback.textContent = initials;
  image.classList.toggle("hidden", !avatarUrl);
  fallback.classList.toggle("hidden", Boolean(avatarUrl));
  if (avatarUrl) image.src = avatarUrl;
  else image.removeAttribute("src");
}

document.querySelector("#btn-edit-profile").addEventListener("click", () => setProfileEditMode(true));
document.querySelector("#btn-cancel-profile").addEventListener("click", () => {
  profileEditMode = false;
  renderProfile();
});

function getProfileFormSnapshot() {
  return JSON.stringify({
    career: document.querySelector("#profile-career").value.trim(),
    institution: document.querySelector("#profile-institution").value.trim(),
    goal: document.querySelector("#profile-goal").value.trim(),
    weeklyGoal: Number.parseInt(document.querySelector("#profile-weekly-goal").value, 10) || 10,
    focusTime: Number.parseInt(document.querySelector("#profile-focus-time").value, 10) || 25,
    avatarUrl: pendingProfileAvatarUrl,
  });
}

function updateProfileSaveState() {
  const saveButton = document.querySelector("#btn-save-profile");
  saveButton.disabled = getProfileFormSnapshot() === profileSnapshot;
}

["#profile-career", "#profile-institution", "#profile-goal", "#profile-weekly-goal", "#profile-focus-time"].forEach((selector) => {
  document.querySelector(selector).addEventListener("input", updateProfileSaveState);
  document.querySelector(selector).addEventListener("change", updateProfileSaveState);
});

document.querySelector("#profile-avatar-input").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    pendingProfileAvatarUrl = await prepareProfileAvatar(file);
    renderProfilePhoto(currentUser());
    updateProfileSaveState();
    showToast("Foto lista para guardar.");
  } catch (error) {
    showToast(error.message || "No se pudo cargar la foto.");
  } finally {
    event.target.value = "";
  }
});

document.querySelector("#btn-remove-avatar").addEventListener("click", () => {
  pendingProfileAvatarUrl = "";
  renderProfilePhoto(currentUser());
  updateProfileSaveState();
});

document.querySelector("#profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const user = currentUser();
  const nextCareer = document.querySelector("#profile-career").value.trim();
  const nextInstitution = document.querySelector("#profile-institution").value.trim();
  const nextGoal = document.querySelector("#profile-goal").value.trim();
  const nextWeeklyGoal = Number.parseInt(document.querySelector("#profile-weekly-goal").value, 10) || 10;
  const nextFocusTime = Number.parseInt(document.querySelector("#profile-focus-time").value, 10) || 25;
  const nextAvatarUrl = pendingProfileAvatarUrl;
  const avatarChanged = nextAvatarUrl !== (user.avatarUrl || "");
  let avatarPersistenceWarning = !avatarColumnAvailable && avatarChanged;

  try {
    const profilePayload = {
      career: nextCareer,
      institution: nextInstitution,
      goal: nextGoal,
      weekly_goal: nextWeeklyGoal,
      focus_time: nextFocusTime,
    };
    if (avatarColumnAvailable) profilePayload.avatar_url = nextAvatarUrl;

    let { error: profileError } = await cloud.from("profiles").update(profilePayload).eq("id", user.id);

    if (profileError && isMissingColumnError(profileError, "avatar_url")) {
      avatarColumnAvailable = false;
      avatarPersistenceWarning = avatarChanged;
      delete profilePayload.avatar_url;
      const retry = await cloud.from("profiles").update(profilePayload).eq("id", user.id);
      profileError = retry.error;
    }

    if (profileError) throw profileError;
    user.career = nextCareer;
    user.institution = nextInstitution;
    user.goal = nextGoal;
    user.weeklyGoal = nextWeeklyGoal;
    user.focusTime = nextFocusTime;
    user.avatarUrl = nextAvatarUrl;
    saveState();
    updateSessionUi();
    profileEditMode = false;
    renderProfile();
    showToast(
      avatarPersistenceWarning
        ? "Perfil actualizado. Para que la foto quede en Supabase, ejecuta el SQL actualizado."
        : "Perfil actualizado."
    );
  } catch (error) {
    showToast(error.message || "No se pudo actualizar el perfil.");
  }
});

document.querySelector("#btn-delete-account").addEventListener("click", () => setDeleteAccountModal(true));
document.querySelector("#btn-cancel-delete-account").addEventListener("click", () => setDeleteAccountModal(false));
document.querySelector("#delete-account-modal").addEventListener("click", (event) => {
  if (event.target.id === "delete-account-modal") setDeleteAccountModal(false);
});

["#delete-check-data", "#delete-check-final"].forEach((selector) => {
  document.querySelector(selector).addEventListener("change", updateDeleteAccountButton);
});

document.querySelector("#btn-confirm-delete-account").addEventListener("click", deleteCurrentAccount);

function setDeleteAccountModal(isOpen) {
  document.querySelector("#delete-account-modal").classList.toggle("hidden", !isOpen);
  if (!isOpen) {
    document.querySelector("#delete-check-data").checked = false;
    document.querySelector("#delete-check-final").checked = false;
    updateDeleteAccountButton();
  }
}

function updateDeleteAccountButton() {
  const checkedData = document.querySelector("#delete-check-data").checked;
  const checkedFinal = document.querySelector("#delete-check-final").checked;
  document.querySelector("#btn-confirm-delete-account").disabled = !(checkedData && checkedFinal);
}

async function deleteCurrentAccount() {
  const userId = state.currentUserId;
  if (!userId) return;
  const confirmButton = document.querySelector("#btn-confirm-delete-account");
  confirmButton.disabled = true;
  confirmButton.textContent = "Borrando...";

  try {
    await deleteAccountFromCloud(userId);
    stopTimer();
    state.users = state.users.filter((user) => user.id !== userId);
    state.currentUserId = "";
    state.activeProjectId = "";
    state.activeTimer = null;
    if (cloudReady()) {
      try {
        await cloud.auth.signOut();
      } catch (error) {
        console.warn("La sesión ya no estaba activa después del borrado.");
      }
    }
    saveState();
    setDeleteAccountModal(false);
    updateSessionUi();
    showScreen("login", { history: "replace" });
    showToast("Cuenta eliminada.");
  } catch (error) {
    showToast(error.message || "No se pudo borrar la cuenta.");
  } finally {
    confirmButton.textContent = "Borrar definitivamente";
    updateDeleteAccountButton();
  }
}

async function deleteAccountFromCloud(userId) {
  if (!cloudReady()) return;

  const { error } = await cloud.rpc("delete_own_account");
  if (!error) return;
  if (!isMissingFunctionError(error, "delete_own_account")) throw error;

  await deleteApplicationDataFromCloud(userId);
}

async function deleteApplicationDataFromCloud(userId) {
  const deletes = [
    cloud.from("weekly_reports").delete().eq("user_id", userId),
    cloud.from("task_history").delete().eq("user_id", userId),
    cloud.from("projects").delete().eq("user_id", userId),
    cloud.from("profiles").delete().eq("id", userId),
  ];
  const results = await Promise.all(deletes);
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
}

document.querySelector("#btn-refresh-admin").addEventListener("click", renderAdminPanel);

async function renderAdminPanel() {
  if (currentUser()?.role !== "admin") return;

  const usersList = document.querySelector("#admin-users-list");
  const projectsList = document.querySelector("#admin-projects-list");
  const reportsList = document.querySelector("#admin-reports-list");

  usersList.innerHTML = `<p class="muted-text">Cargando usuarios...</p>`;
  projectsList.innerHTML = `<p class="muted-text">Cargando proyectos...</p>`;
  reportsList.innerHTML = `<p class="muted-text">Cargando reportes...</p>`;

  try {
    const [{ data: profiles, error: profilesError }, { data: projects, error: projectsError }, { data: tasks, error: tasksError }, { data: history, error: historyError }, { data: reports, error: reportsError }] =
      await Promise.all([
        cloud.from("profiles").select("id, name, email, role, created_at").order("created_at", { ascending: false }),
        cloud.from("projects").select("id, user_id, title, tag, deadline, created_at").order("created_at", { ascending: false }),
        cloud.from("tasks").select("id, user_id, project_id, name, minutes, status, created_at").order("created_at", { ascending: false }),
        cloud.from("task_history").select("id, user_id, project_name, task_name, minutes, completed_at").order("completed_at", { ascending: false }),
        cloud.from("weekly_reports").select("id, user_id, tasks_count, minutes, created_at").order("created_at", { ascending: false }),
      ]);

    if (profilesError) throw profilesError;
    if (projectsError) throw projectsError;
    if (tasksError) throw tasksError;
    if (historyError) throw historyError;
    if (reportsError) throw reportsError;

    const completed = (history || []).length;
    const minutes = (history || []).reduce((sum, item) => sum + Number(item.minutes || 0), 0);

    document.querySelector("#admin-users-count").textContent = profiles?.length || 0;
    document.querySelector("#admin-projects-count").textContent = projects?.length || 0;
    document.querySelector("#admin-tasks-count").textContent = tasks?.length || 0;
    document.querySelector("#admin-completed-count").textContent = completed;
    document.querySelector("#admin-minutes-count").textContent = minutes;

    renderAdminUsers(profiles || []);
    renderAdminProjects(projects || [], profiles || [], tasks || []);
    renderAdminReports(reports || [], profiles || []);
  } catch (error) {
    const message = error.message || "No se pudo cargar el panel de administración.";
    usersList.innerHTML = `<p class="empty-state">${escapeHtml(message)}</p>`;
    projectsList.innerHTML = `<p class="empty-state">Revisa que el SQL actualizado esté ejecutado en Supabase.</p>`;
    reportsList.innerHTML = "";
  }
}

function renderAdminUsers(profiles) {
  const container = document.querySelector("#admin-users-list");
  if (!profiles.length) {
    container.innerHTML = `<p class="empty-state">No hay usuarios registrados.</p>`;
    return;
  }

  container.innerHTML = "";
  profiles.forEach((profile) => {
    const item = document.createElement("article");
    item.className = "admin-item";
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(profile.name || "Sin nombre")}</strong>
        <span>${escapeHtml(profile.email)}</span>
      </div>
      <label>
        Rol
        <select data-user-id="${profile.id}">
          <option value="student" ${profile.role === "student" ? "selected" : ""}>Usuario</option>
          <option value="admin" ${profile.role === "admin" ? "selected" : ""}>Admin</option>
        </select>
      </label>
    `;
    item.querySelector("select").addEventListener("change", (event) => updateUserRole(profile.id, event.target.value));
    container.appendChild(item);
  });
}

async function updateUserRole(userId, role) {
  try {
    const { error } = await cloud.from("profiles").update({ role }).eq("id", userId);
    if (error) throw error;
    if (userId === currentUser().id) {
      currentUser().role = role;
      saveState();
      updateSessionUi();
    }
    showToast("Rol actualizado.");
    renderAdminPanel();
  } catch (error) {
    showToast(error.message || "No se pudo actualizar el rol.");
  }
}

function renderAdminProjects(projects, profiles, tasks) {
  const container = document.querySelector("#admin-projects-list");
  if (!projects.length) {
    container.innerHTML = `<p class="empty-state">No hay proyectos creados.</p>`;
    return;
  }

  container.innerHTML = "";
  projects.forEach((project) => {
    const owner = profiles.find((profile) => profile.id === project.user_id);
    const ownerName = owner?.name || "Usuario no encontrado";
    const ownerEmail = owner?.email || "Correo no disponible";
    const projectTasks = tasks.filter((task) => task.project_id === project.id);
    const done = projectTasks.filter((task) => task.status === "done").length;
    const item = document.createElement("article");
    item.className = "admin-item";
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(project.title)}</strong>
        <span class="admin-project-owner">Dueño: ${escapeHtml(ownerName)}</span>
        <span>${escapeHtml(ownerEmail)} · ${escapeHtml(project.tag || "Sin etiqueta")}</span>
      </div>
      <div class="admin-actions">
        <small>${done}/${projectTasks.length} tareas · ${daysLeftLabel(project.deadline)}</small>
        <button class="secondary-action compact danger-soft" type="button">Eliminar</button>
      </div>
    `;
    item.querySelector("button").addEventListener("click", () => adminDeleteProject(project.id));
    container.appendChild(item);
  });
}

async function adminDeleteProject(projectId) {
  if (!confirm("¿Eliminar este proyecto y sus micro tareas?")) return;
  try {
    const { error } = await cloud.from("projects").delete().eq("id", projectId);
    if (error) throw error;
    showToast("Proyecto eliminado por administración.");
    await refreshCloudState();
    renderAdminPanel();
  } catch (error) {
    showToast(error.message || "No se pudo eliminar el proyecto.");
  }
}

function renderAdminReports(reports, profiles) {
  const container = document.querySelector("#admin-reports-list");
  if (!reports.length) {
    container.innerHTML = `<p class="empty-state">No hay reportes generados.</p>`;
    return;
  }

  container.innerHTML = "";
  reports.forEach((report) => {
    const owner = profiles.find((profile) => profile.id === report.user_id);
    const item = document.createElement("article");
    item.className = "admin-item";
    item.innerHTML = `
      <div>
        <strong>${report.tasks_count} tareas · ${report.minutes} min</strong>
        <span>${escapeHtml(owner?.email || "Usuario no encontrado")}</span>
      </div>
      <small>${formatDateTime(report.created_at)}</small>
    `;
    container.appendChild(item);
  });
}

const chatAnswers = [
  { keys: ["proyecto", "crear"], text: "Para crear un proyecto, ve al Dashboard, escribe el objetivo, agrega una fecha límite y presiona Crear proyecto." },
  { keys: ["micro", "tarea", "minuto"], text: "Las micro tareas deben durar entre 15 y 25 minutos según RN-01. Si algo toma más, divídelo en dos bloques." },
  { keys: ["temporizador", "zen", "pomodoro"], text: "El temporizador te ayuda a trabajar una micro tarea a la vez. Elige una tarea, presiona Iniciar y completa el bloque de concentración." },
  { keys: ["reporte", "correo", "semanal"], text: "Para generar el reporte semanal, entra a Historial y presiona Generar reporte semanal. La app preparará un resumen con tus tareas completadas y minutos trabajados." },
  { keys: ["privacidad", "datos", "cuenta"], text: "Tus proyectos, tareas e historial son privados. Solo tú puedes ver tu información al iniciar sesión con tu cuenta." },
];

document.querySelector("#chat-toggle").addEventListener("click", () => document.querySelector("#chatbot").classList.toggle("hidden"));
document.querySelector("#chat-close").addEventListener("click", () => document.querySelector("#chatbot").classList.add("hidden"));
document.querySelectorAll(".chat-suggestions button").forEach((button) => {
  button.addEventListener("click", () => sendChatQuestion(button.dataset.question));
});
document.querySelector("#chat-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = document.querySelector("#chat-input");
  const question = input.value.trim();
  if (!question) return;
  sendChatQuestion(question);
  input.value = "";
});

function sendChatQuestion(question) {
  addChatMessage(question, "user-msg");
  addChatMessage(answerQuestion(question), "bot-msg");
}

function addChatMessage(text, className) {
  const message = document.createElement("p");
  message.className = className;
  message.textContent = text;
  document.querySelector("#chat-messages").appendChild(message);
  message.scrollIntoView({ behavior: "smooth", block: "end" });
}

function answerQuestion(question) {
  const normalized = question.toLowerCase();
  const match = chatAnswers.find((answer) => answer.keys.some((key) => normalized.includes(key)));
  return match ? match.text : "Puedo orientarte sobre proyectos, micro tareas, temporizador, historial, reportes o privacidad.";
}

function calculateProjectMetrics(project) {
  if (!project?.tasks?.length) return { completed: 0, percent: 0 };
  const completed = project.tasks.filter((task) => task.status === "done").length;
  return { completed, percent: Math.round((completed / project.tasks.length) * 100) };
}

function calculateStreak(history) {
  const days = [...new Set(history.map((item) => item.completedAt.slice(0, 10)))].sort().reverse();
  if (!days.length) return 0;
  let streak = 0;
  const cursor = new Date();
  for (const day of days) {
    const expected = cursor.toISOString().slice(0, 10);
    if (day === expected) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else if (streak === 0) {
      cursor.setDate(cursor.getDate() - 1);
      if (day === cursor.toISOString().slice(0, 10)) streak += 1;
    } else {
      break;
    }
  }
  return streak;
}

function daysLeft(deadline) {
  const diff = Math.ceil((new Date(`${deadline}T23:59:59`) - new Date()) / 86400000);
  return Math.max(0, diff);
}

function daysLeftLabel(deadline) {
  const diff = daysLeft(deadline);
  if (diff === 0) return "vence hoy";
  if (diff === 1) return "queda 1 día";
  return `quedan ${diff} días`;
}

function isCurrentWeek(date) {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return date >= start && date < end;
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatShortDate(value) {
  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function getTodayInputValue() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function statusLabel(status) {
  if (status === "done") return "Completada";
  if (status === "current") return "Ahora en foco";
  return "Pendiente";
}

function roleLabel(role) {
  return role === "admin" ? "Admin" : "Usuario";
}

function getInitials(name = "", lastName = "") {
  const initials = [name, lastName]
    .filter(Boolean)
    .map((part) => part.trim().charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return initials || "P";
}

async function prepareProfileAvatar(file) {
  if (!file.type.startsWith("image/")) throw new Error("Selecciona una imagen válida.");
  if (file.size > 5 * 1024 * 1024) throw new Error("La imagen debe pesar menos de 5 MB.");

  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const maxSize = 420;
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo preparar la imagen.");

  canvas.width = width;
  canvas.height = height;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  return canvas.toDataURL("image/jpeg", 0.86);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(new Error("No se pudo leer la imagen.")));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => reject(new Error("La imagen no se pudo procesar.")));
    image.src = src;
  });
}

function isMissingColumnError(error, columnName) {
  const message = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();
  return error?.code === "42703" || message.includes(columnName.toLowerCase());
}

function isMissingFunctionError(error, functionName) {
  const message = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();
  return error?.code === "42883" || error?.code === "PGRST202" || message.includes(functionName.toLowerCase());
}

function createUuid() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (char) =>
    (Number(char) ^ (Math.random() * 16) >> (Number(char) / 4)).toString(16)
  );
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function boot() {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const queryParams = new URLSearchParams(window.location.search);
  const authLinkType = hashParams.get("type") || queryParams.get("type");
  passwordRecoveryMode = authLinkType === "recovery" && hasRecentPasswordRecoveryRequest();
  accountConfirmationMode = authLinkType === "signup" || authLinkType === "email_change";

  state.currentUserId = "";
  state.activeProjectId = "";
  state.activeTimer = null;
  saveState();
  if (cloudReady() && !passwordRecoveryMode) await cloud.auth.signOut();
  updateSessionUi();
  setAuthMode("login");
  if (passwordRecoveryMode) {
    document.body.classList.add("login-mode");
    showScreen("login", { history: "replace" });
    showAuthPanel("new-password");
    return;
  }
  showScreen("login", { history: "replace" });
  if (accountConfirmationMode || hashParams.has("access_token")) {
    showToast("Cuenta confirmada. Ya puedes iniciar sesión.");
    localStorage.removeItem(PASSWORD_RECOVERY_KEY);
    window.history.replaceState({ protask: true, screenId: "login" }, document.title, window.location.pathname);
  }
}

function hasRecentPasswordRecoveryRequest() {
  try {
    const saved = JSON.parse(localStorage.getItem(PASSWORD_RECOVERY_KEY));
    if (!saved?.requestedAt) return false;
    return Date.now() - saved.requestedAt < 1000 * 60 * 30;
  } catch (error) {
    return false;
  }
}

boot();
