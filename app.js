// ==========================================
// CONFIGURACIÓN DE SUPABASE
// ==========================================
const SUPABASE_URL = 'https://hociaajjusqixmrbwwzh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhvY2lhYWpqdXNxaXhtcmJ3d3poIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMjk4NzIsImV4cCI6MjA5NDYwNTg3Mn0.aJ9sVZ6cW1IOm1BC6DKHe9Tf-5i8-qFgX2-e0Ddl6ak';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==========================================
// ESTADO GLOBAL (STORE)
// ==========================================
const STORE_KEY = 'congregacion_app_v2';

let S = {
  usuarios: [], // { id, email, nombre, rol, rol_especifico, etiquetas: [], permisos: [], ausencias: [] }
  territorios: [],
  asignaciones_semana: {},
  historial_semanas: {},
  eventos: [],
  tablero: [],
  solicitudes_publicaciones: [],
  solicitudes_exhibidores: [],
  informes_mensuales: [],
  reunion_data: {},
  oradores: [],
  actividad: [],
  estudios: [],
  version: 1
};

let currentUser = null; // Información completa del usuario en S.usuarios
let syncTimeout = null;

// Referencias UI Globales
const DOM = {
  loginView: document.getElementById('login-view'),
  appUi: document.getElementById('app-ui'),
  loginForm: document.getElementById('login-form'),
  loginError: document.getElementById('login-error'),
  syncIndicator: document.getElementById('sync-status'),
  navItems: document.querySelectorAll('.nav-item'),
  views: document.querySelectorAll('.view:not(#login-view)'),
  headerTitle: document.getElementById('header-title'),
  btnLogout: document.getElementById('btn-logout'),
  modalOverlay: document.getElementById('modal-overlay'),
  bottomSheet: document.getElementById('bottom-sheet'),
  sheetContent: document.getElementById('sheet-content')
};

// ==========================================
// INICIALIZACIÓN Y AUTENTICACIÓN
// ==========================================

async function init() {
  // Comprobar si hay sesión activa
  const { data: { session }, error } = await supabase.auth.getSession();
  
  if (session) {
    await loadData(session.user);
  } else {
    showLogin();
  }

  setupEventListeners();
}

function showLogin() {
  DOM.loginView.style.display = 'flex';
  DOM.appUi.classList.remove('visible');
}

function showApp() {
  DOM.loginView.style.display = 'none';
  DOM.appUi.classList.add('visible');
  updatePerfilUI();
}

// ==========================================
// EVENT LISTENERS
// ==========================================
function setupEventListeners() {
  // Login form
  DOM.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('btn-login');
    
    btn.disabled = true;
    btn.textContent = 'Ingresando...';
    DOM.loginError.style.display = 'none';

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      DOM.loginError.textContent = error.message;
      DOM.loginError.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Ingresar';
    } else {
      await loadData(data.user);
      btn.disabled = false;
      btn.textContent = 'Ingresar';
    }
  });

  // Logout
  DOM.btnLogout.addEventListener('click', async () => {
    await supabase.auth.signOut();
    currentUser = null;
    showLogin();
  });

  // Navigation
  DOM.navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      
      // Update active nav
      DOM.navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      
      // Update header title
      DOM.headerTitle.textContent = item.querySelector('span').textContent;
      
      // Show target view
      const targetId = item.getAttribute('data-target');
      DOM.views.forEach(v => v.classList.remove('active'));
      document.getElementById(targetId).classList.add('active');
    });
  });

  // Modals / Bottom Sheets
  DOM.modalOverlay.addEventListener('click', closeSheet);
  
  // Swipe down to close sheet (basic implementation)
  let startY;
  DOM.bottomSheet.addEventListener('touchstart', (e) => {
    if (e.target.closest('#sheet-content') && DOM.bottomSheet.scrollTop > 0) return;
    startY = e.touches[0].clientY;
  }, {passive: true});
  
  DOM.bottomSheet.addEventListener('touchmove', (e) => {
    if (!startY) return;
    const currentY = e.touches[0].clientY;
    const diff = currentY - startY;
    if (diff > 50 && DOM.bottomSheet.scrollTop === 0) {
      closeSheet();
      startY = null;
    }
  }, {passive: true});
}

// ==========================================
// GESTIÓN DE DATOS Y SINCRONIZACIÓN
// ==========================================

async function loadData(authUser) {
  setSyncStatus('yellow');
  
  // Intentar cargar localmente primero para respuesta rápida
  const localData = localStorage.getItem(STORE_KEY);
  if (localData) {
    try {
      S = JSON.parse(localData);
    } catch(e) { console.error('Error parseando localStorage', e); }
  }

  // Cargar de Supabase
  try {
    // Asumimos una tabla "store" con una columna "data" tipo jsonb
    // (Ajustar según la estructura final en Supabase)
    const { data, error } = await supabase
      .from('app_store')
      .select('data')
      .eq('id', 1)
      .single();
      
    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = No rows found
    
    if (data && data.data) {
      S = data.data;
      saveLocal(); // Actualiza local cache
    } else {
      // No existe en supabase, creamos con S por defecto
      triggerSync();
    }
    setSyncStatus('green');
  } catch(err) {
    console.error('Error cargando de Supabase, usando local.', err);
    setSyncStatus('red');
  }

  // Buscar el currentUser en la lista de usuarios
  currentUser = S.usuarios.find(u => u.email === authUser.email);
  
  // Si es la primera vez que se loguea alguien, crearle un usuario "admin"
  if (!currentUser && S.usuarios.length === 0) {
    currentUser = {
      id: authUser.id,
      email: authUser.email,
      nombre: 'Administrador Inicial',
      rol: 'anciano',
      rol_especifico: 'coordinador',
      etiquetas: [],
      permisos: ['asignar_territorios', 'asignar_reunion_entre_semana', 'asignar_reunion_fin_semana', 'editar_hermanos', 'añadir_eventos', 'subir_anuncios'],
      ausencias: []
    };
    S.usuarios.push(currentUser);
    saveData();
  } else if (!currentUser) {
    alert("Tu cuenta no está registrada en el sistema de la congregación.");
    await supabase.auth.signOut();
    return;
  }

  showApp();
}

function saveLocal() {
  localStorage.setItem(STORE_KEY, JSON.stringify(S));
}

// Llama a esto cada vez que modifiques S
function saveData() {
  saveLocal();
  setSyncStatus('yellow');
  triggerSync();
}

function triggerSync() {
  clearTimeout(syncTimeout);
  syncTimeout = setTimeout(async () => {
    try {
      const { error } = await supabase
        .from('app_store')
        .upsert({ id: 1, data: S, updated_at: new Date().toISOString() });
        
      if (error) throw error;
      setSyncStatus('green');
    } catch (err) {
      console.error('Sync error:', err);
      setSyncStatus('red');
    }
  }, 1500);
}

function setSyncStatus(color) {
  DOM.syncIndicator.className = `sync-status ${color}`;
}

// ==========================================
// ROLES Y PERMISOS
// ==========================================

function canDo(permiso) {
  if (!currentUser) return false;
  
  // Permiso explícito
  if (currentUser.permisos && currentUser.permisos.includes(permiso)) return true;
  
  // Ancianos implícitos
  if (currentUser.rol === 'anciano' && permiso === 'editar_hermanos') return true;
  
  // Roles específicos
  const cargo = currentUser.rol_especifico;
  if (cargo === 'coordinador') return true; // Coordinador tiene todos
  
  if (cargo === 'superintendente_servicio') {
    if (['asignar_territorios', 'asignar_grupo'].includes(permiso)) return true;
  }
  
  return false;
}

// ==========================================
// UTILIDADES DE FECHA
// ==========================================

function getIsoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1)/7);
  return `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, '0')}`;
}

let activeWeek = getIsoWeek();

// ==========================================
// RENDERIZADO: INICIO
// ==========================================

function renderInicio() {
  // Resumen
  const resumenContainer = document.getElementById('inicio-resumen');
  const eventosProximos = S.eventos.filter(e => new Date(e.fecha) >= new Date()).slice(0, 2);
  
  let html = `<p><strong>Semana Actual:</strong> ${activeWeek}</p>`;
  if (eventosProximos.length > 0) {
    html += `<div style="margin-top: 10px; border-top: 1px solid var(--border-color); padding-top: 10px;">
      <p style="font-size: 0.85rem; color: var(--text-muted);">Próximos eventos:</p>
      ${eventosProximos.map(e => `<p>• ${e.nombre} (${e.fecha})</p>`).join('')}
    </div>`;
  } else {
    html += `<p style="margin-top:10px; color: var(--text-muted); font-size: 0.9rem;">Sin eventos próximos.</p>`;
  }
  resumenContainer.innerHTML = html;

  // Anuncios
  const anunciosContainer = document.getElementById('inicio-anuncios');
  let anunciosHtml = '';
  if (canDo('subir_anuncios')) {
    anunciosHtml += `<button class="btn btn-secondary" style="margin-bottom: 16px; padding: 8px;" onclick="promptNewAnuncio()"><i class="fa-solid fa-plus"></i> Nuevo Anuncio</button>`;
  }
  
  if (S.tablero.length === 0) {
    anunciosHtml += `<p style="color: var(--text-muted); text-align: center; margin-top: 20px;">No hay anuncios recientes.</p>`;
  } else {
    S.tablero.slice().reverse().forEach((anuncio, idx) => {
      anunciosHtml += `
        <div class="card" style="border-left: 3px solid var(--accent-primary);">
          <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 4px;">${new Date(anuncio.fecha).toLocaleDateString()}</p>
          <p>${anuncio.texto}</p>
          ${anuncio.imagen ? `<img src="${anuncio.imagen}" style="max-width: 100%; border-radius: 4px; margin-top: 10px;" />` : ''}
          ${canDo('subir_anuncios') ? `<button class="btn btn-secondary" style="padding: 4px; font-size: 0.75rem; margin-top: 8px; width: auto;" onclick="deleteAnuncio(${S.tablero.length - 1 - idx})"><i class="fa-solid fa-trash"></i></button>` : ''}
        </div>
      `;
    });
  }
  anunciosContainer.innerHTML = anunciosHtml;
}

window.promptNewAnuncio = () => {
  const texto = prompt("Texto del anuncio:");
  if (!texto) return;
  const imagen = prompt("URL de imagen (opcional):");
  S.tablero.push({
    texto,
    imagen,
    fecha: new Date().toISOString()
  });
  saveData();
  renderInicio();
};

window.deleteAnuncio = (index) => {
  if (confirm("¿Borrar anuncio?")) {
    S.tablero.splice(index, 1);
    saveData();
    renderInicio();
  }
};

// ==========================================
// UI HELPERS
// ==========================================

function showApp() {
  DOM.loginView.style.display = 'none';
  DOM.appUi.classList.add('visible');
  updatePerfilUI();
  renderInicio();
  renderReuniones();
  renderPredicacion();
  renderAsignaciones();
  renderEventos();
  renderPerfil();
}

function updatePerfilUI() {
  if (!currentUser) return;
  document.getElementById('perfil-nombre').textContent = currentUser.nombre;
  document.getElementById('perfil-rol').textContent = `${currentUser.rol.toUpperCase()} ${currentUser.rol_especifico ? '- ' + currentUser.rol_especifico : ''}`;
  document.getElementById('perfil-avatar').textContent = currentUser.nombre.charAt(0).toUpperCase();
}

function openSheet(contentHTML) {
  DOM.sheetContent.innerHTML = contentHTML;
  DOM.modalOverlay.classList.add('active');
  DOM.bottomSheet.classList.add('active');
}

function closeSheet() {
  DOM.modalOverlay.classList.remove('active');
  DOM.bottomSheet.classList.remove('active');
  setTimeout(() => DOM.sheetContent.innerHTML = '', 300);
}

window.closeSheet = closeSheet; // Hacerlo global para botones onlick

// ==========================================
// RENDERIZADO DE OTROS TABS
// ==========================================

function renderReuniones() {
  const entreSemanaContainer = document.getElementById('reunion-entre-semana');
  const finSemanaContainer = document.getElementById('reunion-fin-semana');
  
  if (!S.reunion_data[activeWeek]) {
    S.reunion_data[activeWeek] = { entre: {}, fin: {} };
  }
  
  entreSemanaContainer.innerHTML = `
    <p style="color: var(--text-muted); font-size: 0.85rem;">Presidente, Discursos y Tareas.</p>
    <button class="btn btn-secondary" style="margin-top: 10px;" onclick="openAsignacionModal('entre')">Gestionar Asignaciones</button>
  `;
  
  finSemanaContainer.innerHTML = `
    <p style="color: var(--text-muted); font-size: 0.85rem;">Discurso Público y Estudio de la Atalaya.</p>
    <button class="btn btn-secondary" style="margin-top: 10px;" onclick="openAsignacionModal('fin')">Gestionar Asignaciones</button>
  `;
}

window.openAsignacionModal = (tipo) => {
  openSheet(`
    <h2>Asignaciones (${tipo === 'entre' ? 'Entre Semana' : 'Fin de Semana'})</h2>
    <p>Semana: ${activeWeek}</p>
    <p style="color: var(--warning); margin-top: 10px;">Funcionalidad en construcción.</p>
    <button class="btn btn-primary" style="margin-top: 20px;" onclick="closeSheet()">Cerrar</button>
  `);
};

function renderPredicacion() {
  // Horas del mes (mock base en año de servicio septiembre-agosto)
  const ahora = new Date();
  const esSeptiembreOMas = ahora.getMonth() >= 8;
  const startYear = esSeptiembreOMas ? ahora.getFullYear() : ahora.getFullYear() - 1;
  const yearString = `${startYear}-${startYear + 1}`;
  
  document.getElementById('actividad-horas-mes').textContent = "0 (Demo)";
  document.getElementById('actividad-horas-ano').textContent = `0 (Año ${yearString})`;
}

function renderAsignaciones() {
  const container = document.getElementById('mis-asignaciones-list');
  container.innerHTML = `<p style="color: var(--text-muted);">No tienes asignaciones próximas registradas en esta demostración.</p>`;
}

function renderEventos() {
  const container = document.getElementById('eventos-list');
  if (S.eventos.length === 0) {
    container.innerHTML = `<p style="color: var(--text-muted); text-align: center; margin-top: 20px;">No hay eventos agendados.</p>`;
  } else {
    container.innerHTML = S.eventos.map(e => `
      <div class="card">
        <h3 style="font-size: 1rem;">${e.nombre}</h3>
        <p style="font-size: 0.8rem; color: var(--accent-primary);">${new Date(e.fecha).toLocaleDateString()}</p>
        <p style="margin-top: 8px;">${e.descripcion || ''}</p>
      </div>
    `).join('');
  }
}

document.getElementById('btn-add-evento').addEventListener('click', () => {
  if (!canDo('añadir_eventos')) {
    alert("No tienes permiso para añadir eventos.");
    return;
  }
  const nombre = prompt("Nombre del evento:");
  if (!nombre) return;
  const fecha = prompt("Fecha (YYYY-MM-DD):", new Date().toISOString().split('T')[0]);
  if (!fecha) return;
  
  S.eventos.push({ nombre, fecha, descripcion: '' });
  saveData();
  renderEventos();
});

function renderPerfil() {
  // Ya manejado parcialmente en updatePerfilUI
  // Aquí podemos agregar cosas como listas de hermanos si es anciano, etc.
}

// Inicializar la app
document.addEventListener('DOMContentLoaded', init);
