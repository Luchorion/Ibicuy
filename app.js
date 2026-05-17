// ==========================================
// CONFIGURACIÓN DE SUPABASE
// ==========================================
const SUPABASE_URL = 'https://hociaajjusqixmrbwwzh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhvY2lhYWpqdXNxaXhtcmJ3d3poIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMjk4NzIsImV4cCI6MjA5NDYwNTg3Mn0.aJ9sVZ6cW1IOm1BC6DKHe9Tf-5i8-qFgX2-e0Ddl6ak';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==========================================
// ESTADO GLOBAL (STORE)
// ==========================================
const STORE_KEY = 'congregacion_app_v2';

let S = {
  usuarios: [], 
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

let currentUser = null; 
let syncTimeout = null;

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
// UTILIDADES DE FECHA Y SEMANAS
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

window.changeWeek = (delta) => {
  const parts = activeWeek.split('-W');
  let y = parseInt(parts[0]);
  let w = parseInt(parts[1]) + delta;
  if (w < 1) { y--; w = 52; }
  if (w > 52) { y++; w = 1; }
  activeWeek = `${y}-W${w.toString().padStart(2, '0')}`;
  
  if (document.getElementById('current-week-label')) {
    document.getElementById('current-week-label').textContent = activeWeek;
  }
  renderReuniones();
};

function checkWeekRotation() {
  const current = getIsoWeek();
  // TODO: Archivar semanas viejas si es necesario
}

// ==========================================
// INICIALIZACIÓN Y AUTENTICACIÓN
// ==========================================
async function init() {
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }

  const { data: { session }, error } = await supabaseClient.auth.getSession();
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
  if (document.getElementById('current-week-label')) {
    document.getElementById('current-week-label').textContent = activeWeek;
  }
  updatePerfilUI();
  renderInicio();
  renderReuniones();
  renderPredicacion();
  renderAsignaciones();
  renderEventos();
  renderPerfil();
}

// ==========================================
// EVENT LISTENERS
// ==========================================
function setupEventListeners() {
  DOM.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('btn-login');
    
    btn.disabled = true;
    btn.textContent = 'Ingresando...';
    DOM.loginError.style.display = 'none';

    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

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

  DOM.btnLogout.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    currentUser = null;
    showLogin();
  });

  DOM.navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      DOM.navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      DOM.headerTitle.textContent = item.querySelector('span').textContent;
      const targetId = item.getAttribute('data-target');
      DOM.views.forEach(v => v.classList.remove('active'));
      document.getElementById(targetId).classList.add('active');
    });
  });

  DOM.modalOverlay.addEventListener('click', closeSheet);
  
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
  const localData = localStorage.getItem(STORE_KEY);
  if (localData) {
    try { S = JSON.parse(localData); } catch(e) {}
  }

  try {
    const { data, error } = await supabaseClient.from('app_store').select('data').eq('id', 1).single();
    if (error && error.code !== 'PGRST116') throw error; 
    
    if (data && data.data) {
      S = { ...S, ...data.data }; // Merge default with cloud
      saveLocal(); 
    } else {
      triggerSync();
    }
    setSyncStatus('green');
  } catch(err) {
    console.error('Error Sync:', err);
    setSyncStatus('red');
  }

  currentUser = S.usuarios.find(u => u.email === authUser.email);
  if (!currentUser && S.usuarios.length === 0) {
    currentUser = {
      id: authUser.id, email: authUser.email, nombre: 'Admin Inicial',
      rol: 'anciano', rol_especifico: 'coordinador', etiquetas: [],
      permisos: ['asignar_territorios', 'asignar_reunion_entre_semana', 'asignar_reunion_fin_semana', 'editar_hermanos', 'añadir_eventos', 'subir_anuncios'],
      ausencias: []
    };
    S.usuarios.push(currentUser);
    saveData();
  } else if (!currentUser) {
    alert("Cuenta no registrada en el sistema.");
    await supabaseClient.auth.signOut();
    return;
  }
  showApp();
}

function saveLocal() {
  localStorage.setItem(STORE_KEY, JSON.stringify(S));
}

function saveData() {
  saveLocal();
  setSyncStatus('yellow');
  triggerSync();
}

function triggerSync() {
  clearTimeout(syncTimeout);
  syncTimeout = setTimeout(async () => {
    try {
      const { error } = await supabaseClient.from('app_store').upsert({ id: 1, data: S, updated_at: new Date().toISOString() });
      if (error) throw error;
      setSyncStatus('green');
    } catch (err) {
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
  if (currentUser.permisos && currentUser.permisos.includes(permiso)) return true;
  if (currentUser.rol === 'anciano' && permiso === 'editar_hermanos') return true;
  const cargo = currentUser.rol_especifico;
  if (cargo === 'coordinador') return true; 
  if (cargo === 'superintendente_servicio' && ['asignar_territorios', 'asignar_grupo'].includes(permiso)) return true;
  return false;
}

function getUserName(id) {
  const u = S.usuarios.find(u => u.id === id);
  return u ? u.nombre : 'Sin asignar';
}

function notifyLocal(title, body) {
  if (Notification.permission === 'granted') {
    new Notification(title, { body, icon: 'icon-192.png' });
  }
}

// ==========================================
// RENDERIZADO: INICIO
// ==========================================
function renderInicio() {
  const resumenContainer = document.getElementById('inicio-resumen');
  const eventosProximos = S.eventos.filter(e => new Date(e.fecha) >= new Date()).slice(0, 2);
  
  let html = `<p><strong>Semana Actual:</strong> ${activeWeek}</p>`;
  if (eventosProximos.length > 0) {
    html += `<div style="margin-top: 10px; border-top: 1px solid var(--border-color); padding-top: 10px;">
      <p style="font-size: 0.85rem; color: var(--text-muted);">Próximos eventos:</p>
      ${eventosProximos.map(e => `<p>• ${e.nombre} (${e.fecha})</p>`).join('')}
    </div>`;
  }
  resumenContainer.innerHTML = html;

  const anunciosContainer = document.getElementById('inicio-anuncios');
  let anunciosHtml = '';
  if (canDo('subir_anuncios')) {
    anunciosHtml += `<button class="btn btn-secondary" style="margin-bottom: 16px; padding: 8px;" onclick="promptNewAnuncio()"><i class="fa-solid fa-plus"></i> Nuevo Anuncio</button>`;
  }
  
  if (S.tablero.length === 0) {
    anunciosHtml += `<p style="color: var(--text-muted); text-align: center;">No hay anuncios recientes.</p>`;
  } else {
    S.tablero.slice().reverse().forEach((anuncio, idx) => {
      anunciosHtml += `
        <div class="card" style="border-left: 3px solid var(--accent-primary);">
          <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 4px;">${new Date(anuncio.fecha).toLocaleDateString()}</p>
          <p>${anuncio.texto}</p>
          ${anuncio.imagen ? `<img src="${anuncio.imagen}" style="max-width: 100%; border-radius: 4px; margin-top: 10px;" />` : ''}
          ${canDo('subir_anuncios') ? `<button class="btn btn-secondary" style="padding: 4px; font-size: 0.75rem; margin-top: 8px; width: auto;" onclick="deleteAnuncio(${S.tablero.length - 1 - idx})"><i class="fa-solid fa-trash"></i></button>` : ''}
        </div>`;
    });
  }
  anunciosContainer.innerHTML = anunciosHtml;
}

window.promptNewAnuncio = () => {
  const texto = prompt("Texto del anuncio:");
  if (!texto) return;
  S.tablero.push({ texto, imagen: prompt("URL de imagen (opcional):"), fecha: new Date().toISOString() });
  saveData(); renderInicio();
};

window.deleteAnuncio = (index) => {
  if (confirm("¿Borrar anuncio?")) { S.tablero.splice(index, 1); saveData(); renderInicio(); }
};

// ==========================================
// REUNIONES Y ASIGNACIONES
// ==========================================
function renderReuniones() {
  const entreSemanaContainer = document.getElementById('reunion-entre-semana');
  const finSemanaContainer = document.getElementById('reunion-fin-semana');
  
  if (!S.reunion_data[activeWeek]) S.reunion_data[activeWeek] = { entre: {}, fin: {} };
  const dE = S.reunion_data[activeWeek].entre;
  const dF = S.reunion_data[activeWeek].fin;

  entreSemanaContainer.innerHTML = `
    <p><strong>Presidente:</strong> ${getUserName(dE.presidente)}</p>
    <p><strong>Tesoros:</strong> ${getUserName(dE.tesoros_discurso)}</p>
    <p><strong>NVX:</strong> ${getUserName(dE.nvx_asignado)}</p>
    ${canDo('asignar_reunion_entre_semana') ? `<button class="btn btn-secondary" style="margin-top: 10px;" onclick="openAsignacionModal('entre')">Editar Vida y Ministerio</button>` : ''}
  `;
  
  finSemanaContainer.innerHTML = `
    <p><strong>Presidente:</strong> ${getUserName(dF.presidente)}</p>
    <p><strong>Atalaya:</strong> ${getUserName(dF.atalaya_conductor)}</p>
    ${canDo('asignar_reunion_fin_semana') ? `<button class="btn btn-secondary" style="margin-top: 10px;" onclick="openAsignacionModal('fin')">Editar Fin de Semana</button>` : ''}
  `;
}

function getSelectHermanos(label, fieldId, selectedId, roleFilter = null) {
  let options = `<option value="">-- Sin asignar --</option>`;
  S.usuarios.forEach(u => {
    if (roleFilter && !roleFilter.includes(u.rol)) return;
    options += `<option value="${u.id}" ${selectedId === u.id ? 'selected' : ''}>${u.nombre}</option>`;
  });
  return `<div class="input-group"><label>${label}</label><select id="${fieldId}">${options}</select></div>`;
}

window.openAsignacionModal = (tipo) => {
  const data = S.reunion_data[activeWeek][tipo] || {};
  let html = `<h2>${tipo === 'entre' ? 'Vida y Ministerio' : 'Fin de Semana'}</h2>`;
  html += `<form id="form-reunion-${tipo}" onsubmit="saveReunion(event, '${tipo}')">`;
  
  if (tipo === 'entre') {
    html += getSelectHermanos('Presidente', 'presidente', data.presidente, ['anciano', 'siervo_min']);
    html += `<div class="input-group"><label>Canción Inicial</label><input type="number" id="cancion_1" value="${data.cancion_1||''}"></div>`;
    
    html += `<h3 style="margin-top:20px;">Tesoros</h3>`;
    html += getSelectHermanos('Discurso', 'tesoros_discurso', data.tesoros_discurso, ['anciano', 'siervo_min']);
    html += getSelectHermanos('Perlas Escondidas', 'tesoros_perlas', data.tesoros_perlas, ['anciano', 'siervo_min']);
    html += getSelectHermanos('Lectura Bíblica', 'tesoros_lectura', data.tesoros_lectura);
    
    html += `<h3 style="margin-top:20px;">Ministerio</h3>`;
    html += `<div class="input-group"><label>SMM 1 - Título</label><input type="text" id="smm1_titulo" value="${data.smm1_titulo||''}"></div>`;
    html += getSelectHermanos('SMM 1 - Asignado', 'smm1_asignado', data.smm1_asignado);
    html += `<div class="input-group"><label>SMM 2 - Título</label><input type="text" id="smm2_titulo" value="${data.smm2_titulo||''}"></div>`;
    html += getSelectHermanos('SMM 2 - Asignado', 'smm2_asignado', data.smm2_asignado);
    
    html += `<h3 style="margin-top:20px;">Nuestra Vida Cristiana</h3>`;
    html += getSelectHermanos('NVX - Asignado', 'nvx_asignado', data.nvx_asignado, ['anciano', 'siervo_min']);
    html += getSelectHermanos('Estudio - Conductor', 'estudio_conductor', data.estudio_conductor, ['anciano']);
    html += getSelectHermanos('Estudio - Lector', 'estudio_lector', data.estudio_lector);
    html += getSelectHermanos('Oración Final', 'oracion_final', data.oracion_final);
  } else {
    html += getSelectHermanos('Presidente', 'presidente', data.presidente, ['anciano', 'siervo_min']);
    html += `<div class="input-group"><label>Orador Visitante</label><input type="text" id="orador" value="${data.orador||''}"></div>`;
    html += getSelectHermanos('Atalaya - Conductor', 'atalaya_conductor', data.atalaya_conductor, ['anciano']);
    html += getSelectHermanos('Atalaya - Lector', 'atalaya_lector', data.atalaya_lector);
  }
  
  html += `<button type="submit" class="btn btn-primary" style="margin-top:20px;">Guardar</button>`;
  html += `</form>`;
  openSheet(html);
};

window.saveReunion = (e, tipo) => {
  e.preventDefault();
  const form = e.target;
  const data = S.reunion_data[activeWeek][tipo] || {};
  
  Array.from(form.elements).forEach(el => {
    if (el.id && el.tagName !== 'BUTTON') {
      data[el.id] = el.value;
    }
  });
  
  S.reunion_data[activeWeek][tipo] = data;
  saveData();
  notifyLocal('Asignaciones Guardadas', `Se actualizaron las asignaciones de la semana ${activeWeek}`);
  closeSheet();
  renderReuniones();
  renderAsignaciones();
};

// ==========================================
// PREDICACIÓN Y TERRITORIOS
// ==========================================
function renderPredicacion() {
  const ahora = new Date();
  const startYear = ahora.getMonth() >= 8 ? ahora.getFullYear() : ahora.getFullYear() - 1;
  document.getElementById('actividad-horas-mes').textContent = "0 (Demo)";
  document.getElementById('actividad-horas-ano').textContent = `0 (Año ${startYear}-${startYear+1})`;
  
  let tHtml = ``;
  if (canDo('asignar_territorios') || currentUser.rol === 'anciano') {
    tHtml += `<button class="btn btn-secondary" onclick="crearTerritorio()" style="margin-bottom:16px;">Nuevo Territorio</button>`;
    S.territorios.forEach(t => {
      tHtml += `<div class="card" onclick="openTerritorio('${t.id}')">
        <h4>Territorio ${t.numero}</h4>
        <p>${t.descripcion || 'Sin descripción'}</p>
        <p style="font-size:0.8rem; color:var(--text-muted);">Manzanas: ${t.manzanas?t.manzanas.length:0}</p>
      </div>`;
    });
  } else {
    tHtml += `<p>Solo los ancianos y encargados pueden ver el listado de territorios.</p>`;
  }
  // append territory list to view-predicacion, replacing previous demo
  let view = document.getElementById('view-predicacion');
  view.innerHTML = `
    <h2>Mi Actividad</h2>
    <div class="card">
      <p>Horas este mes: <strong id="actividad-horas-mes">0</strong></p>
      <p>Año de Servicio: <strong id="actividad-horas-ano">0</strong></p>
    </div>
    <h2>Territorios</h2>
    ${tHtml}
  `;
}

window.crearTerritorio = () => {
  const numero = prompt("Número del territorio:");
  if (!numero) return;
  const descripcion = prompt("Descripción/Lugar:");
  const mCount = parseInt(prompt("Cantidad de manzanas:", "10"));
  
  let manzanas = [];
  for (let i=0; i<mCount; i++) manzanas.push({ index: i+1, completada: false });
  
  S.territorios.push({ id: 'T'+Date.now(), numero, descripcion, manzanas, historial: [] });
  saveData();
  renderPredicacion();
};

window.openTerritorio = (id) => {
  const t = S.territorios.find(x => x.id === id);
  if (!t) return;
  
  let html = `<h2>Territorio ${t.numero}</h2><p>${t.descripcion}</p>`;
  html += `<div style="display:grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top:20px;">`;
  
  t.manzanas.forEach((m, idx) => {
    const bg = m.completada ? 'var(--success)' : 'var(--bg-main)';
    html += `<div onclick="toggleManzana('${id}', ${idx})" style="background:${bg}; border:1px solid var(--border-color); text-align:center; padding:10px; border-radius:4px; font-weight:bold;">${m.index}</div>`;
  });
  
  html += `</div>`;
  html += `<button class="btn btn-primary" style="margin-top:20px;" onclick="closeSheet()">Cerrar</button>`;
  openSheet(html);
};

window.toggleManzana = (tid, idx) => {
  const t = S.territorios.find(x => x.id === tid);
  t.manzanas[idx].completada = !t.manzanas[idx].completada;
  saveData();
  openTerritorio(tid); // re-render
};

// ==========================================
// ASIGNACIONES TIMELINE
// ==========================================
function renderAsignaciones() {
  const container = document.getElementById('mis-asignaciones-list');
  let partes = [];
  
  Object.keys(S.reunion_data).forEach(week => {
    const dE = S.reunion_data[week].entre;
    const dF = S.reunion_data[week].fin;
    
    // Check if current user is assigned to anything
    if (dE.presidente === currentUser.id) partes.push({ week, titulo: 'Presidente - Vida y Ministerio' });
    if (dE.tesoros_discurso === currentUser.id) partes.push({ week, titulo: 'Discurso de Tesoros' });
    if (dE.tesoros_perlas === currentUser.id) partes.push({ week, titulo: 'Perlas Escondidas' });
    if (dE.tesoros_lectura === currentUser.id) partes.push({ week, titulo: 'Lectura Bíblica' });
    if (dE.smm1_asignado === currentUser.id) partes.push({ week, titulo: `SMM 1 (${dE.smm1_titulo||''})` });
    if (dE.smm2_asignado === currentUser.id) partes.push({ week, titulo: `SMM 2 (${dE.smm2_titulo||''})` });
    if (dE.nvx_asignado === currentUser.id) partes.push({ week, titulo: 'Nuestra Vida Cristiana' });
    if (dE.estudio_conductor === currentUser.id) partes.push({ week, titulo: 'Conductor - Estudio Bíblico' });
    if (dE.estudio_lector === currentUser.id) partes.push({ week, titulo: 'Lector - Estudio Bíblico' });
    if (dE.oracion_final === currentUser.id) partes.push({ week, titulo: 'Oración Final' });
    
    if (dF.presidente === currentUser.id) partes.push({ week, titulo: 'Presidente - Fin de Semana' });
    if (dF.atalaya_conductor === currentUser.id) partes.push({ week, titulo: 'Conductor - Atalaya' });
    if (dF.atalaya_lector === currentUser.id) partes.push({ week, titulo: 'Lector - Atalaya' });
  });
  
  partes.sort((a,b) => a.week.localeCompare(b.week));
  
  if (partes.length === 0) {
    container.innerHTML = `<p style="color: var(--text-muted);">No tienes asignaciones registradas.</p>`;
  } else {
    container.innerHTML = partes.map(p => `
      <div style="border-left: 2px solid var(--accent-primary); padding-left: 15px; margin-bottom: 15px; position: relative;">
        <div style="position:absolute; left:-6px; top:5px; width:10px; height:10px; border-radius:50%; background:var(--accent-primary);"></div>
        <p style="font-size: 0.8rem; color: var(--text-muted);">${p.week}</p>
        <p style="font-weight: 500;">${p.titulo}</p>
      </div>
    `).join('');
  }
}

// ==========================================
// EVENTOS
// ==========================================
function renderEventos() {
  const container = document.getElementById('eventos-list');
  if (S.eventos.length === 0) {
    container.innerHTML = `<p style="color: var(--text-muted); text-align: center; margin-top: 20px;">No hay eventos agendados.</p>`;
  } else {
    container.innerHTML = S.eventos.map((e, i) => `
      <div class="card">
        <h3 style="font-size: 1rem;">${e.nombre}</h3>
        <p style="font-size: 0.8rem; color: var(--accent-primary);">${new Date(e.fecha).toLocaleDateString()}</p>
        <p style="margin-top: 8px;">${e.descripcion || ''}</p>
        ${canDo('añadir_eventos') ? `<button class="btn btn-secondary" style="padding:4px; font-size:0.75rem; margin-top:8px; width:auto;" onclick="borrarEvento(${i})"><i class="fa-solid fa-trash"></i></button>` : ''}
      </div>
    `).join('');
  }
}

document.getElementById('btn-add-evento').addEventListener('click', () => {
  if (!canDo('añadir_eventos')) { alert("Sin permiso."); return; }
  const nombre = prompt("Nombre del evento:");
  if (!nombre) return;
  const fecha = prompt("Fecha (YYYY-MM-DD):", new Date().toISOString().split('T')[0]);
  S.eventos.push({ nombre, fecha, descripcion: prompt("Descripción:") });
  saveData(); renderEventos();
});

window.borrarEvento = (idx) => {
  S.eventos.splice(idx, 1);
  saveData(); renderEventos();
}

// ==========================================
// PERFIL Y ADMIN
// ==========================================
function updatePerfilUI() {
  if (!currentUser) return;
  document.getElementById('perfil-nombre').textContent = currentUser.nombre;
  document.getElementById('perfil-rol').textContent = `${currentUser.rol.toUpperCase()} ${currentUser.rol_especifico ? '- ' + currentUser.rol_especifico : ''}`;
  document.getElementById('perfil-avatar').textContent = currentUser.nombre.charAt(0).toUpperCase();
}

function renderPerfil() {
  const adminHtml = canDo('editar_hermanos') ? `
    <button class="btn btn-secondary" style="margin-top:20px;" onclick="openAdminHermanos()">Gestión de Hermanos</button>
  ` : '';
  
  let view = document.getElementById('view-perfil');
  view.innerHTML = `
    <div class="card" style="text-align: center;">
      <div style="width: 60px; height: 60px; background: var(--accent-primary); border-radius: 50%; margin: 0 auto 10px auto; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; font-weight: bold; color: white;" id="perfil-avatar">${currentUser.nombre.charAt(0)}</div>
      <h3 id="perfil-nombre">${currentUser.nombre}</h3>
      <p id="perfil-rol" style="margin-bottom: 10px;">${currentUser.rol}</p>
      <button class="btn btn-secondary" id="btn-logout" style="margin-top: 10px;">Cerrar Sesión</button>
    </div>
    ${adminHtml}
  `;
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    currentUser = null; showLogin();
  });
}

window.openAdminHermanos = () => {
  let html = `<h2>Hermanos</h2>`;
  S.usuarios.forEach(u => {
    html += `<div class="card" style="margin-bottom:8px;">
      <strong>${u.nombre}</strong> (${u.rol})
      <button class="btn btn-secondary" style="padding:4px; font-size:0.75rem; width:auto; float:right;" onclick="alert('Funcionalidad de edición de perfil profundo en construcción')">Editar</button>
    </div>`;
  });
  html += `<button class="btn btn-primary" onclick="closeSheet()">Cerrar</button>`;
  openSheet(html);
};

window.closeSheet = () => {
  DOM.modalOverlay.classList.remove('active');
  DOM.bottomSheet.classList.remove('active');
  setTimeout(() => DOM.sheetContent.innerHTML = '', 300);
};

document.addEventListener('DOMContentLoaded', init);
