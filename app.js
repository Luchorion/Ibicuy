// ==========================================
// CONFIGURACIÓN DE SUPABASE
// ==========================================
const SUPABASE_URL = 'https://hociaajjusqixmrbwwzh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhvY2lhYWpqdXNxaXhtcmJ3d3poIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMjk4NzIsImV4cCI6MjA5NDYwNTg3Mn0.aJ9sVZ6cW1IOm1BC6DKHe9Tf-5i8-qFgX2-e0Ddl6ak';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==========================================
// ESTADO GLOBAL (Caché Local)
// ==========================================
let S = {
  usuarios: [], 
  territorios: [],
  eventos: [],
  tablero: [],
  solicitudes_exhibidores: [],
  informes_mensuales: [],
  reuniones: [],
  oradores: [],
  asignaciones_semana: [],
  grupos: [],
  funciones_equipos: [],
  actividad_diaria: []
};

let currentUser = null; 

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

function getWeekStartDate(isoWeek) {
  const [yearStr, weekStr] = isoWeek.split('-W');
  const year = parseInt(yearStr);
  const week = parseInt(weekStr);
  const d = new Date(year, 0, 1 + (week - 1) * 7);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1)); // Lunes
  return d;
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

function getReunion(weekId) {
  return S.reuniones.find(r => r.id === weekId) || { id: weekId, entre: {}, fin: {}, tareas: {}, asistencia: {} };
}

// ==========================================
// INICIALIZACIÓN Y AUTENTICACIÓN
// ==========================================
async function init() {
  setupEventListeners();
  if (Notification.permission === 'default') Notification.requestPermission();
  const { data: { session }, error } = await supabaseClient.auth.getSession();
  if (session) await loadData(session.user);
  else showLogin();
  
  // Suscripción a cambios en vivo (Realtime en todas las tablas)
  supabaseClient.channel('schema-db-changes')
    .on('postgres_changes', { event: '*', schema: 'public' }, async (payload) => {
      if (currentUser) {
        // Recargar datos silenciosamente
        await loadData(null, true);
      }
    })
    .subscribe();
}

function showLogin() {
  DOM.loginView.style.display = 'flex';
  DOM.appUi.classList.remove('visible');
}

function showApp() {
  DOM.loginView.style.display = 'none';
  DOM.appUi.classList.add('visible');
  
  // Redirigir siempre al dashboard/home al loguear
  DOM.navItems.forEach(n => n.classList.remove('active'));
  const inicioNav = document.querySelector('.nav-item[data-target="view-inicio"]');
  if (inicioNav) inicioNav.classList.add('active');
  
  DOM.views.forEach(v => v.classList.remove('active'));
  const inicioView = document.getElementById('view-inicio');
  if (inicioView) inicioView.classList.add('active');
  
  DOM.headerTitle.textContent = 'Inicio';

  if (document.getElementById('current-week-label')) {
    document.getElementById('current-week-label').textContent = activeWeek;
  }
  
  const renders = [
    { name: 'updatePerfilUI', fn: updatePerfilUI },
    { name: 'renderInicio', fn: renderInicio },
    { name: 'renderReuniones', fn: renderReuniones },
    { name: 'renderPredicacion', fn: renderPredicacion },
    { name: 'renderAsignaciones', fn: renderAsignaciones },
    { name: 'renderEventos', fn: renderEventos },
    { name: 'renderPerfil', fn: renderPerfil }
  ];

  renders.forEach(r => {
    try {
      if (typeof r.fn === 'function') r.fn();
    } catch (e) {
      console.error(`Error rendering ${r.name}:`, e);
    }
  });
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
      try {
        await loadData(data.user);
        // Si loadData termina con éxito, la UI cambia a showApp(),
        // pero igual reseteamos el botón por si cierran sesión y vuelven a la pantalla
        btn.disabled = false;
        btn.textContent = 'Ingresar';
      } catch (err) {
        DOM.loginError.textContent = err.message || "Error al cargar tu perfil.";
        DOM.loginError.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Ingresar';
      }
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
      DOM.views.forEach(v => v.classList.remove('active'));
      document.getElementById(item.getAttribute('data-target')).classList.add('active');
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
    if (currentY - startY > 50 && DOM.bottomSheet.scrollTop === 0) {
      closeSheet();
      startY = null;
    }
  }, {passive: true});
}

// ==========================================
// GESTIÓN DE DATOS Y SINCRONIZACIÓN
// ==========================================
async function loadData(authUser, silent = false) {
  if (!silent) setSyncStatus('yellow');

  try {
    const [
      { data: usuarios },
      { data: territorios },
      { data: eventos },
      { data: tablero },
      { data: solicitudes },
      { data: informes },
      { data: reuniones },
      { data: oradores },
      { data: asignaciones },
      { data: grupos },
      { data: funciones },
      { data: actividad }
    ] = await Promise.all([
      supabaseClient.from('usuarios').select('*'),
      supabaseClient.from('territorios').select('*'),
      supabaseClient.from('eventos').select('*'),
      supabaseClient.from('anuncios').select('*'),
      supabaseClient.from('solicitudes_exhibidores').select('*'),
      supabaseClient.from('informes_mensuales').select('*'),
      supabaseClient.from('reuniones').select('*'),
      supabaseClient.from('oradores').select('*'),
      supabaseClient.from('asignaciones_territorios').select('*'),
      supabaseClient.from('grupos').select('*'),
      supabaseClient.from('funciones_equipos').select('*'),
      supabaseClient.from('actividad_diaria').select('*')
    ]);

    S.usuarios = usuarios || [];
    S.territorios = territorios || [];
    S.eventos = eventos || [];
    S.tablero = tablero || [];
    S.solicitudes_exhibidores = solicitudes || [];
    S.informes_mensuales = informes || [];
    S.reuniones = reuniones || [];
    S.oradores = oradores || [];
    S.asignaciones_semana = asignaciones || [];
    S.grupos = grupos || [];
    S.funciones_equipos = funciones || [];
    S.actividad_diaria = actividad || [];

    if (authUser) {
      // Buscar al usuario que coincide con el ID de Auth o el email
      currentUser = S.usuarios.find(u => u.id === authUser.id || u.auth_id === authUser.id || u.email === authUser.email);
      
      if (!currentUser) {
        // En lugar de hacer prompt() que bloquea la app y causa "loading infinito",
        // intentamos crearlo de forma silenciosa (por si el trigger falló)
        const nombrePorDefecto = authUser.email.split('@')[0];
        
        try {
          const { data: newUser, error: insertErr } = await supabaseClient.from('usuarios').insert({
            id: authUser.id,
            email: authUser.email,
            nombre: nombrePorDefecto,
            rol: S.usuarios.length === 0 ? 'anciano' : 'hermano',
            rol_especifico: S.usuarios.length === 0 ? 'coordinador' : '',
            permisos: S.usuarios.length === 0 ? ['asignar_territorios', 'asignar_reunion_entre_semana', 'asignar_reunion_fin_semana', 'editar_hermanos', 'añadir_eventos', 'subir_anuncios', 'asignar_sonido', 'asignar_acomodadores', 'asignar_limpieza', 'asignar_hospitalidad'] : [],
            etiquetas: [],
            ausencias: []
          }).select().single();
          
          if (insertErr) throw insertErr;
          
          if (newUser) {
            currentUser = newUser;
            S.usuarios.push(currentUser);
          }
        } catch (fallbackErr) {
          console.error("Error en fallback insert:", fallbackErr);
          throw new Error("Tu cuenta fue creada en Auth pero no se pudo generar el perfil. El administrador debe revisar la base de datos.");
        }
      } else {
        // Sincronizar ID de auth si no estaba vinculado
        if (currentUser.id !== authUser.id && !currentUser.auth_id) {
          await supabaseClient.from('usuarios').update({ id: authUser.id, email: authUser.email }).eq('id', currentUser.id);
          currentUser.id = authUser.id;
          currentUser.email = authUser.email;
        }
      }
    } else if (currentUser) {
       currentUser = S.usuarios.find(u => u.id === currentUser.id);
    }
    
    if (!silent) setSyncStatus('green');
    if (!silent) showApp();
    else {
      // Re-render si se cargó silenciosamente
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
  } catch(err) {
    if (!silent) setSyncStatus('red');
    console.error("Error en loadData:", err);
    if (!silent) throw err; // Importante para evitar loading infinito en el login
  }
}

function setSyncStatus(color) { DOM.syncIndicator.className = `sync-status ${color}`; }

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
  if (Array.isArray(id)) return id.map(i => getUserName(i)).join(', ');
  const u = S.usuarios.find(u => u.id === id);
  return u ? u.nombre : 'Sin asignar';
}

function notifyLocal(title, body) {
  if (Notification.permission === 'granted') {
    new Notification(title, { body, icon: 'icon-192.png' });
  }
}

function validateAsignacion(uid, week) {
  if (!uid) return null;
  const u = S.usuarios.find(x => x.id === uid);
  if (!u) return null;
  
  const wDate = getWeekStartDate(week);
  
  // check ausencias
  const isAbsent = u.ausencias && u.ausencias.some(a => {
    const start = new Date(a.inicio);
    const end = new Date(a.fin);
    return wDate >= start && wDate <= end;
  });
  if (isAbsent) return { status: 'bloqueo', msg: `${u.nombre} está ausente en la semana ${week}.` };
  
  // check duplicados
  let count = 0;
  const r = getReunion(week);
  const dE = r.entre || {};
  const dF = r.fin || {};
  const dT = r.tareas || {};
  
  const allFields = [
    ...Object.values(dE), 
    ...Object.values(dF), 
    ...(dT.microfonos || []), 
    ...(dT.acomodadores_entrada || []), 
    ...(dT.acomodadores_auditorio || []), 
    ...(dT.hospitalidad || []),
    dT.sonido, dT.multimedia, dT.limpieza
  ];
  
  if (allFields.includes(uid)) count++;
  
  if (count > 0) return { status: 'advertencia', msg: `${u.nombre} ya tiene otra asignación.` };
  return null;
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
    // S.tablero is already from DB, we order it by desc
    [...S.tablero].sort((a,b)=>new Date(b.fecha)-new Date(a.fecha)).forEach((anuncio) => {
      anunciosHtml += `
        <div class="card" style="border-left: 3px solid var(--accent-primary);">
          <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 4px;">${new Date(anuncio.fecha).toLocaleDateString()}</p>
          <p>${anuncio.texto}</p>
          ${anuncio.imagen ? `<img src="${anuncio.imagen}" style="max-width: 100%; border-radius: 4px; margin-top: 10px;" />` : ''}
          ${canDo('subir_anuncios') ? `<button class="btn btn-secondary" style="padding: 4px; font-size: 0.75rem; margin-top: 8px; width: auto;" onclick="deleteAnuncio('${anuncio.id}')"><i class="fa-solid fa-trash"></i></button>` : ''}
        </div>`;
    });
  }
  anunciosContainer.innerHTML = anunciosHtml;
}

window.promptNewAnuncio = async () => {
  const texto = prompt("Texto del anuncio:");
  if (!texto) return;
  const imagen = prompt("URL de imagen (opcional):");
  await supabaseClient.from('anuncios').insert({ texto, imagen });
  await loadData(null, true);
};

window.deleteAnuncio = async (id) => {
  if (confirm("¿Borrar anuncio?")) { 
    await supabaseClient.from('anuncios').delete().eq('id', id);
    await loadData(null, true);
  }
};

// ==========================================
// REUNIONES Y ASIGNACIONES
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const btnPrev = document.getElementById('btn-prev-week');
    const btnNext = document.getElementById('btn-next-week');
    const btnThis = document.getElementById('btn-this-week');
    
    if(btnPrev) btnPrev.onclick = () => {
      let parts = activeWeek.split('-W');
      let y = parseInt(parts[0]), w = parseInt(parts[1]);
      if(w > 1) w--; else { y--; w = 52; }
      activeWeek = `${y}-W${w.toString().padStart(2, '0')}`;
      renderReuniones();
    };
    
    if(btnNext) btnNext.onclick = () => {
  }, 1000);
});

function renderReuniones() {
  const lbl = document.getElementById('current-week-label');
  if(lbl) lbl.textContent = "Semana " + activeWeek;

  const entreSemanaContainer = document.getElementById('reunion-entre-semana');
  const finSemanaContainer = document.getElementById('reunion-fin-semana');
  
  const r = getReunion(activeWeek);
  const dE = r.entre || {};
  const dF = r.fin || {};
  const dT = r.tareas || {};

  entreSemanaContainer.innerHTML = `
    <p><strong>Presidente:</strong> ${getUserName(dE.presidente)}</p>
    <p><strong>Canción Inicial:</strong> ${dE.cancion_1 || '---'}</p>
    <p><strong>Tesoros:</strong> ${getUserName(dE.tesoros_discurso)}</p>
    <p><strong>Canción Intermedia:</strong> ${dE.cancion_2 || '---'}</p>
    <p><strong>NVX:</strong> ${getUserName(dE.nvx_asignado)}</p>
    <p><strong>Canción Final:</strong> ${dE.cancion_3 || '---'}</p>
    ${canDo('asignar_reunion_entre_semana') ? `<button class="btn btn-secondary" style="margin-top: 10px;" onclick="openAsignacionModal('entre')">Editar Vida y Ministerio</button>` : ''}
  `;
  
  finSemanaContainer.innerHTML = `
    <p><strong>Presidente:</strong> ${getUserName(dF.presidente)}</p>
    <p><strong>Canción Inicial:</strong> ${dF.cancion_1 || '---'}</p>
    <p><strong>Atalaya:</strong> ${getUserName(dF.atalaya_conductor)}</p>
    <p><strong>Canción Intermedia:</strong> ${dF.cancion_2 || '---'}</p>
    <p><strong>Canción Final:</strong> ${dF.cancion_3 || '---'}</p>
    ${canDo('asignar_reunion_fin_semana') ? `<button class="btn btn-secondary" style="margin-top: 10px;" onclick="openAsignacionModal('fin')">Editar Fin de Semana</button>` : ''}
  `;
  
  const tareasContainer = document.getElementById('reunion-tareas');
  if (!tareasContainer) {
    const tc = document.createElement('div');
    tc.className = 'card';
    tc.innerHTML = `<h3>Tareas y Asistencia</h3><div id="reunion-tareas"></div>`;
    document.getElementById('view-reuniones').appendChild(tc);
  }
  
  document.getElementById('reunion-tareas').innerHTML = `
    <p><strong>Sonido:</strong> ${getUserName(dT.sonido)}</p>
    <p><strong>Micrófonos:</strong> ${getUserName(dT.microfonos || [])}</p>
    <p><strong>Limpieza:</strong> Grupo ${dT.limpieza || 'Sin asignar'}</p>
    <button class="btn btn-secondary" style="margin-top: 10px;" onclick="openAsignacionModal('tareas')">Editar Tareas y Asistencia</button>
  `;
}

function getSelectHermanos(label, fieldId, selectedId, roleFilter = null, etiquetaFilter = null, multiple = false) {
  let options = multiple ? '' : `<option value="">-- Sin asignar --</option>`;
  S.usuarios.forEach(u => {
    if (roleFilter && !roleFilter.includes(u.rol)) return;
    if (etiquetaFilter && (!u.etiquetas || !u.etiquetas.includes(etiquetaFilter))) return;
    
    const isSelected = multiple ? (selectedId && selectedId.includes(u.id)) : (selectedId === u.id);
    options += `<option value="${u.id}" ${isSelected ? 'selected' : ''}>${u.nombre}</option>`;
  });
  return `<div class="input-group"><label>${label}</label><select id="${fieldId}" ${multiple?'multiple':''}>${options}</select></div>`;
}

window.openAsignacionModal = (tipo) => {
  const r = getReunion(activeWeek);
  const data = r[tipo] || {};
  let html = `<h2>${tipo === 'entre' ? 'Vida y Ministerio' : tipo === 'fin' ? 'Fin de Semana' : 'Tareas y Asistencia'}</h2>`;
  html += `<form id="form-reunion-${tipo}" onsubmit="saveReunion(event, '${tipo}')">`;
  
  if (tipo === 'entre') {
    html += getSelectHermanos('Presidente', 'presidente', data.presidente, ['anciano', 'siervo_min']);
    html += `<div class="input-group"><label>Canción Inicial</label><input type="number" id="cancion_1" value="${data.cancion_1||''}"></div>`;
    html += `<h3>Tesoros</h3>`;
    html += getSelectHermanos('Discurso', 'tesoros_discurso', data.tesoros_discurso, ['anciano', 'siervo_min']);
    html += getSelectHermanos('Perlas Escondidas', 'tesoros_perlas', data.tesoros_perlas, ['anciano', 'siervo_min']);
    html += getSelectHermanos('Lectura Bíblica', 'tesoros_lectura', data.tesoros_lectura);
    html += `<h3>Ministerio</h3>`;
    html += `<div class="input-group"><label>SMM 1 - Título</label><input type="text" id="smm1_titulo" value="${data.smm1_titulo||''}"></div>`;
    html += getSelectHermanos('SMM 1 - Asignado', 'smm1_asignado', data.smm1_asignado);
    html += `<div class="input-group"><label>SMM 2 - Título</label><input type="text" id="smm2_titulo" value="${data.smm2_titulo||''}"></div>`;
    html += getSelectHermanos('SMM 2 - Asignado', 'smm2_asignado', data.smm2_asignado);
    html += `<h3>Nuestra Vida Cristiana</h3>`;
    html += `<div class="input-group"><label>Canción Intermedia</label><input type="number" id="cancion_2" value="${data.cancion_2||''}"></div>`;
    html += getSelectHermanos('NVX - Asignado', 'nvx_asignado', data.nvx_asignado, ['anciano', 'siervo_min']);
    html += getSelectHermanos('Estudio - Conductor', 'estudio_conductor', data.estudio_conductor, ['anciano']);
    html += getSelectHermanos('Estudio - Lector', 'estudio_lector', data.estudio_lector);
    html += getSelectHermanos('Oración Final', 'oracion_final', data.oracion_final);
    html += `<div class="input-group"><label>Canción Final</label><input type="number" id="cancion_3" value="${data.cancion_3||''}"></div>`;
  } else if (tipo === 'fin') {
    html += getSelectHermanos('Presidente', 'presidente', data.presidente, ['anciano', 'siervo_min']);
    html += `<div class="input-group"><label>Canción Inicial</label><input type="number" id="cancion_1" value="${data.cancion_1||''}"></div>`;
    
    let orOptions = `<option value="">-- Ninguno --</option>`;
    S.oradores.forEach(o => orOptions += `<option value="${o.id}" ${data.orador === o.id ? 'selected' : ''}>${o.nombre} (${o.congregacion})</option>`);
    html += `<div class="input-group"><label>Orador Visitante</label><select id="orador">${orOptions}</select></div>`;
    
    html += `<div class="input-group"><label>Canción Intermedia</label><input type="number" id="cancion_2" value="${data.cancion_2||''}"></div>`;
    html += getSelectHermanos('Atalaya - Conductor', 'atalaya_conductor', data.atalaya_conductor, ['anciano']);
    html += getSelectHermanos('Atalaya - Lector', 'atalaya_lector', data.atalaya_lector);
    html += `<div class="input-group"><label>Canción Final</label><input type="number" id="cancion_3" value="${data.cancion_3||''}"></div>`;
  } else if (tipo === 'tareas') {
    html += getSelectHermanos('Sonido / Mesa', 'sonido', data.sonido, null, 'Sonido');
    html += getSelectHermanos('Multimedia', 'multimedia', data.multimedia, null, 'Multimedia');
    html += getSelectHermanos('Micrófonos (Multi)', 'microfonos', data.microfonos || [], null, 'Micrófonos', true);
    html += getSelectHermanos('Acomodadores Entrada (Multi)', 'acomodadores_entrada', data.acomodadores_entrada || [], null, 'Acomodadores', true);
    html += getSelectHermanos('Acomodadores Auditorio (Multi)', 'acomodadores_auditorio', data.acomodadores_auditorio || [], null, 'Acomodadores', true);
    html += `<div class="input-group"><label>Limpieza (Grupo)</label><input type="number" id="limpieza" value="${data.limpieza||''}"></div>`;
    
    html += `<h3 style="margin-top:20px;">Asistencia</h3>`;
    const asis = r.asistencia || {};
    html += `<div class="input-group"><label>En Persona</label><input type="number" id="asis_fisica" value="${asis.fisica||0}"></div>`;
    html += `<div class="input-group"><label>En Línea</label><input type="number" id="asis_online" value="${asis.online||0}"></div>`;
  }
  
  html += `<button type="submit" class="btn btn-primary" style="margin-top:20px;">Guardar y Validar</button>`;
  html += `</form>`;
  openSheet(html);
};

window.saveReunion = async (e, tipo) => {
  e.preventDefault();
  const form = e.target;
  const r = getReunion(activeWeek);
  const data = r[tipo] || {};
  let bloqueos = [];
  let advertencias = [];
  
  Array.from(form.elements).forEach(el => {
    if (el.id && el.tagName !== 'BUTTON') {
      let val = el.multiple ? Array.from(el.selectedOptions).map(o=>o.value) : el.value;
      
      if (tipo === 'tareas' && el.id.startsWith('asis_')) {
        if(!r.asistencia) r.asistencia = {};
        r.asistencia[el.id.split('_')[1]] = parseInt(val) || 0;
      } else {
        data[el.id] = val;
        
        // Validación
        let toVal = Array.isArray(val) ? val : [val];
        toVal.forEach(v => {
          const res = validateAsignacion(v, activeWeek);
          if (res) {
            if (res.status === 'bloqueo') bloqueos.push(res.msg);
            if (res.status === 'advertencia') advertencias.push(res.msg);
          }
        });
      }
    }
  });

  if (bloqueos.length > 0) {
    alert("ERRORES:\n" + bloqueos.join('\n') + "\n\nNo se pudo guardar la asignación.");
    return;
  }
  if (advertencias.length > 0) {
    if (!confirm("ADVERTENCIAS:\n" + advertencias.join('\n') + "\n\n¿Guardar de todos modos?")) return;
  }
  
  r[tipo] = data;
  
  await supabaseClient.from('reuniones').upsert({
    id: activeWeek,
    entre: r.entre,
    fin: r.fin,
    tareas: r.tareas,
    asistencia: r.asistencia
  });
  
  notifyLocal('Asignaciones Guardadas', `Se actualizaron las asignaciones de la semana ${activeWeek}`);
  closeSheet();
  await loadData(null, true);
};

// ==========================================
// PREDICACIÓN Y TERRITORIOS
// ==========================================
let predSubtab = 'actividad';

function setPredSubtab(tab) {
  predSubtab = tab;
  renderPredicacion();
}

function renderPredicacion() {
  let view = document.getElementById('view-predicacion');
  
  let tabsHtml = `
    <div style="display:flex; overflow-x:auto; gap:10px; margin-bottom:20px; padding-bottom:5px; border-bottom:1px solid var(--border-color);">
      <button class="btn ${predSubtab==='actividad'?'btn-primary':'btn-secondary'}" style="flex:none; padding:8px 12px; font-size:0.85rem; width:auto;" onclick="setPredSubtab('actividad')">Mi Actividad</button>
      <button class="btn ${predSubtab==='esta_semana'?'btn-primary':'btn-secondary'}" style="flex:none; padding:8px 12px; font-size:0.85rem; width:auto;" onclick="setPredSubtab('esta_semana')">Esta Semana</button>
      <button class="btn ${predSubtab==='proxima_semana'?'btn-primary':'btn-secondary'}" style="flex:none; padding:8px 12px; font-size:0.85rem; width:auto;" onclick="setPredSubtab('proxima_semana')">Próxima Semana</button>
      ${canDo('asignar_territorios') ? `<button class="btn ${predSubtab==='territorios'?'btn-primary':'btn-secondary'}" style="flex:none; padding:8px 12px; font-size:0.85rem; width:auto;" onclick="setPredSubtab('territorios')">Territorios</button>` : ''}
    </div>
  `;

  if (predSubtab === 'actividad') {
    const ahora = new Date();
    const startYear = ahora.getMonth() >= 8 ? ahora.getFullYear() : ahora.getFullYear() - 1;
    // Sumar minutos de actividad_diaria del mes actual
    const minutosMes = (S.actividad_diaria || []).filter(a => a.user_id === currentUser.id && new Date(a.fecha).getMonth() === ahora.getMonth() && new Date(a.fecha).getFullYear() === ahora.getFullYear()).reduce((acc, a) => acc + (a.minutos || 0), 0);
    const hMes = Math.floor(minutosMes / 60);
    const mMes = minutosMes % 60;
    const hAno = S.informes_mensuales.filter(i => i.user_id === currentUser.id && new Date(i.fecha) >= new Date(startYear, 8, 1)).reduce((a,b)=>a+parseFloat(b.horas), 0);
    
    view.innerHTML = tabsHtml + `
      <div class="card">
        <h3 style="font-size:1.1rem;">Resumen de Servicio</h3>
        <div style="display:flex; justify-content:space-between; margin-top:15px; text-align:center;">
          <div><p style="font-size:1.8rem; font-weight:800; color:var(--accent-primary);">${hMes}h ${mMes}m</p><p style="font-size:0.75rem; text-transform:uppercase;">Este Mes</p></div>
          <div><p style="font-size:1.8rem; font-weight:800; color:var(--success);">${hAno}h</p><p style="font-size:0.75rem; text-transform:uppercase;">Año de Servicio</p></div>
        </div>
        <button class="btn btn-primary" style="margin-top:18px;" onclick="agregarActividad()"><i class="fa-solid fa-plus" style="margin-right:8px;"></i>Agregar Tiempo</button>
        <button class="btn btn-secondary" style="margin-top:10px;" onclick="enviarInforme()"><i class="fa-solid fa-paper-plane" style="margin-right:8px;"></i>Enviar Informe</button>
        <button class="btn btn-secondary" style="margin-top:10px;" onclick="verHistorialInformes()"><i class="fa-solid fa-clock-rotate-left" style="margin-right:8px;"></i>Historial</button>
      </div>
    `;
  } 
  else if (predSubtab === 'esta_semana' || predSubtab === 'proxima_semana') {
    const targetWeek = predSubtab === 'esta_semana' ? activeWeek : window.nextWeek(activeWeek);
    // Calcular lunes y domingo de la semana target
    const [yr, wk] = targetWeek.split('-W').map(Number);
    const janFirst = new Date(yr, 0, 1);
    const weekStart = new Date(janFirst.getTime() + (wk - 1) * 7 * 86400000);
    weekStart.setDate(weekStart.getDate() - (weekStart.getDay() || 7) + 1);
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
    const startStr = weekStart.toISOString().split('T')[0];
    const endStr = weekEnd.toISOString().split('T')[0];

    const asigs = (S.asignaciones_semana || []).filter(a => a.fecha >= startStr && a.fecha <= endStr);
    asigs.sort((a,b) => (a.fecha + a.horario).localeCompare(b.fecha + b.horario));
    const canManage = canDo('asignar_territorios');
    const DIAS = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
    
    let html = tabsHtml;
    if (canManage) html += `<button class="btn btn-secondary" onclick="openAsignarTerritorio()" style="margin-bottom:15px;">+ Asignar Salida</button>`;
    
    if (asigs.length === 0) {
      html += `<p style="color:var(--text-muted); text-align:center;">No hay salidas asignadas esta semana.</p>`;
    } else {
      let lastDay = null;
      asigs.forEach(a => {
        const d = new Date(a.fecha + 'T00:00:00');
        const dayName = DIAS[d.getDay()];
        if (dayName !== lastDay) {
          html += `<h3 style="font-size:0.9rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.08em; margin:20px 0 8px;">${dayName} ${d.getDate()}/${d.getMonth()+1}</h3>`;
          lastDay = dayName;
        }
        const t = S.territorios.find(x => x.id === a.territorio_id);
        const isMine = a.usuario_id === currentUser.id;
        html += `<div class="card" ${isMine ? 'style="border-color:var(--accent-primary);"' : ''}>
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div>
              <h4 style="color:var(--accent-primary); margin-bottom:4px;">Territorio ${t?t.numero:'?'}</h4>
              <p style="font-size:0.85rem; font-weight:600;">${a.horario}hs</p>
              <p style="font-size:0.8rem;">Encuentro: ${a.punto_encuentro||'—'}</p>
              <p style="font-size:0.8rem; color:var(--text-muted);">Conductor: <strong>${getUserName(a.usuario_id)}</strong></p>
            </div>
            <div style="display:flex; flex-direction:column; gap:5px;">
              ${canManage ? `<button class="btn btn-secondary" style="padding:4px 8px; font-size:0.75rem; width:auto; color:var(--danger);" onclick="borrarAsignacion('${a.id}')">Borrar</button>` : ''}
            </div>
          </div>
        </div>`;
      });
    }
    view.innerHTML = html;
  }
  else if (predSubtab === 'territorios') {
    let html = tabsHtml;
    if (canDo('asignar_territorios')) {
      html += `<button class="btn btn-primary" onclick="crearTerritorio()" style="margin-bottom:12px;">+ Nuevo Territorio</button>`;
    }
    // Filtros de orden
    const orden = window._terrOrden || 'numero';
    html += `<div style="display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap;">
      <button class="btn ${orden==='numero'?'btn-primary':'btn-secondary'}" style="flex:none;padding:6px 10px;font-size:0.8rem;width:auto;" onclick="window._terrOrden='numero';renderPredicacion()">Por Número</button>
      <button class="btn ${orden==='grupo'?'btn-primary':'btn-secondary'}" style="flex:none;padding:6px 10px;font-size:0.8rem;width:auto;" onclick="window._terrOrden='grupo';renderPredicacion()">Por Grupo</button>
      <button class="btn ${orden==='fecha'?'btn-primary':'btn-secondary'}" style="flex:none;padding:6px 10px;font-size:0.8rem;width:auto;" onclick="window._terrOrden='fecha';renderPredicacion()">Ult. Trabajado</button>
    </div>`;
    
    let lista = [...S.territorios];
    if (orden === 'numero') lista.sort((a,b) => parseInt(a.numero) - parseInt(b.numero));
    else if (orden === 'grupo') {
      lista.sort((a,b) => {
        const gA = S.grupos.find(g => g.id === a.grupo_id)?.nombre || 'zzz';
        const gB = S.grupos.find(g => g.id === b.grupo_id)?.nombre || 'zzz';
        return gA.localeCompare(gB);
      });
    } else if (orden === 'fecha') {
      lista.sort((a,b) => {
        const fa = a.historial && a.historial.length ? a.historial[a.historial.length-1] : '0';
        const fb = b.historial && b.historial.length ? b.historial[b.historial.length-1] : '0';
        return fa.localeCompare(fb); // más antiguo primero
      });
    }

    let lastGrupo = null;
    lista.forEach(t => {
      if (orden === 'grupo') {
        const gNombre = S.grupos.find(g => g.id === t.grupo_id)?.nombre || 'Sin Grupo';
        if (gNombre !== lastGrupo) {
          html += `<h3 style="font-size:0.85rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.08em; margin:20px 0 8px;">${gNombre}</h3>`;
          lastGrupo = gNombre;
        }
      }
      const ultimaVez = t.historial && t.historial.length ? new Date(t.historial[t.historial.length-1]).toLocaleDateString('es-ES') : 'Nunca';
      const grupo = S.grupos.find(g => g.id === t.grupo_id);
      html += `<div class="card" onclick="openTerritorio('${t.id}')" style="cursor:pointer;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <h4 style="margin-bottom:4px;">Territorio ${t.numero}</h4>
            <p style="font-size:0.85rem;">${t.descripcion || 'Sin descripción'}</p>
          </div>
          <div style="text-align:right; flex-shrink:0; margin-left:10px;">
            ${grupo ? `<span style="font-size:0.75rem; background:rgba(139,92,246,0.15); color:var(--accent-primary); border-radius:6px; padding:3px 8px;">${grupo.nombre}</span>` : ''}
            <p style="font-size:0.72rem; color:var(--text-muted); margin-top:4px;">Hecho: ${ultimaVez}</p>
          </div>
        </div>
      </div>`;
    });
    view.innerHTML = html;
  }
}

// Helpers missing
window.nextWeek = (weekStr) => {
  const parts = weekStr.split('-W');
  let y = parseInt(parts[0]), w = parseInt(parts[1]) + 1;
  if (w > 52) { y++; w = 1; }
  return `${y}-W${w.toString().padStart(2, '0')}`;
};

window.openAsignarTerritorio = (week) => {
  let uOpts = S.usuarios.map(u => `<option value="${u.id}">${u.nombre}</option>`).join('');
  let tOpts = S.territorios.map(t => `<option value="${t.id}" data-puntos="${encodeURIComponent(JSON.stringify(t.puntos_encuentro||[]))}">T-${t.numero} ${t.descripcion||''}</option>`).join('');
  
  let html = `<h2>Asignar Grupo de Salida</h2>
    <div class="input-group"><label>Hermano Encargado</label><select id="a_user">${uOpts}</select></div>
    <div class="input-group"><label>Territorio</label><select id="a_terr" onchange="actualizarPuntos()">${tOpts}</select></div>
    <div class="input-group"><label>Fecha</label><input type="date" id="a_fecha"></div>
    <div class="input-group"><label>Horario (Ej: 10:00)</label><input type="time" id="a_hora"></div>
    <div class="input-group"><label>Punto de Encuentro</label><select id="a_punto"><option value="">-- Seleccionar --</option></select></div>
    <button class="btn btn-primary" onclick="saveAsignacionTerritorio()">Guardar</button>
  `;
  openSheet(html);
  setTimeout(() => actualizarPuntos(), 200);
};

window.actualizarPuntos = () => {
  const sel = document.getElementById('a_terr');
  if (!sel) return;
  const tid = sel.value;
  const t = S.territorios.find(x => x.id === tid);
  const puntosSel = document.getElementById('a_punto');
  if (!puntosSel) return;
  let puntos = [];
  if (t && Array.isArray(t.puntos_encuentro)) puntos = t.puntos_encuentro;
  else if (t && typeof t.puntos_encuentro === 'string' && t.puntos_encuentro) puntos = t.puntos_encuentro.split(',').map(p=>p.trim());
  puntosSel.innerHTML = `<option value="">-- Seleccionar --</option>` + puntos.map(p => `<option value="${p}">${p}</option>`).join('');
};

window.saveAsignacionTerritorio = async () => {
  const fecha = document.getElementById('a_fecha').value;
  if (!fecha) { alert('Ingresá una fecha'); return; }
  // Calcular semana ISO de la fecha elegida
  const d = new Date(fecha + 'T00:00:00');
  const startOfWeek = new Date(d);
  const day = d.getDay() || 7;
  startOfWeek.setDate(d.getDate() - day + 1);
  const firstJan = new Date(startOfWeek.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((startOfWeek - firstJan) / 86400000 + firstJan.getDay() + 1) / 7);
  const semana = `${startOfWeek.getFullYear()}-W${weekNum.toString().padStart(2,'0')}`;

  await supabaseClient.from('asignaciones_territorios').insert({
    semana,
    fecha,
    usuario_id: document.getElementById('a_user').value,
    territorio_id: document.getElementById('a_terr').value,
    horario: document.getElementById('a_hora').value,
    punto_encuentro: document.getElementById('a_punto').value
  });
  await loadData(null, true);
  closeSheet();
};

window.borrarAsignacion = async (id) => {
  if(!confirm("¿Borrar esta asignación?")) return;
  await supabaseClient.from('asignaciones_territorios').delete().eq('id', id);
  await loadData(null, true);
};

window.enviarInforme = () => {
  const ahora = new Date();
  // Calcular total acumulado del mes actual desde actividad_diaria
  const minutosMes = (S.actividad_diaria || []).filter(a =>
    a.user_id === currentUser.id &&
    new Date(a.fecha).getMonth() === ahora.getMonth() &&
    new Date(a.fecha).getFullYear() === ahora.getFullYear()
  ).reduce((acc, a) => acc + (a.minutos || 0), 0);
  const horasTotales = (minutosMes / 60).toFixed(1);
  const hDisplay = Math.floor(minutosMes / 60);
  const mDisplay = minutosMes % 60;

  const html = `
    <h2>Enviar Informe Mensual</h2>
    <p style="color:var(--text-muted); margin-bottom:20px;">Revisá y confirmá tu actividad de <strong>${ahora.toLocaleString('es-ES',{month:'long'})}</strong>.</p>
    <div class="card" style="text-align:center; margin-bottom:20px;">
      <p style="font-size:0.75rem; text-transform:uppercase; color:var(--text-muted);">Total acumulado este mes</p>
      <p style="font-size:2.5rem; font-weight:800; color:var(--accent-primary); margin:8px 0;">${hDisplay}h ${mDisplay}m</p>
      <p style="font-size:0.8rem; color:var(--text-muted);">= ${horasTotales} horas</p>
    </div>
    <div class="input-group"><label>Horas a Reportar (editable)</label><input type="number" id="inf_horas" value="${horasTotales}" step="0.5"></div>
    <div class="input-group"><label>Estudios Bíblicos</label><input type="number" id="inf_estudios" value="0" min="0"></div>
    <button class="btn btn-primary" onclick="confirmarEnvioInforme()"><i class="fa-solid fa-paper-plane" style="margin-right:8px;"></i>Confirmar y Enviar</button>
    <button class="btn btn-secondary" style="margin-top:10px;" onclick="closeSheet()">Cancelar</button>
  `;
  openSheet(html);
};

window.confirmarEnvioInforme = async () => {
  const horas = parseFloat(document.getElementById('inf_horas').value);
  const estudios = parseInt(document.getElementById('inf_estudios').value) || 0;
  if (isNaN(horas) || horas < 0) return alert('Ingresá un valor válido de horas.');
  await supabaseClient.from('informes_mensuales').insert({
    user_id: currentUser.id,
    fecha: new Date().toISOString(),
    horas,
    estudios
  });
  closeSheet();
  notifyLocal('Informe enviado', `${horas} horas reportadas correctamente.`);
  await loadData(null, true);
  renderPredicacion();
};

window.verHistorialInformes = () => {
  const misInformes = S.informes_mensuales.filter(i => i.user_id === currentUser.id).sort((a,b) => new Date(b.fecha) - new Date(a.fecha));
  let html = `<h2>Mi Historial de Informes</h2>`;
  if (misInformes.length === 0) {
    html += `<p style="color:var(--text-muted); text-align:center; padding:20px;">No has enviado ningún informe todavía.</p>`;
  } else {
    misInformes.forEach(i => {
      const mes = new Date(i.fecha).toLocaleString('es-ES', { month: 'long', year: 'numeric' });
      html += `<div class="card" style="display:flex; justify-content:space-between; align-items:center;">
        <div><h4 style="text-transform:capitalize;">${mes}</h4><p style="font-size:0.8rem;">Estudios: <strong>${i.estudios||0}</strong></p></div>
        <div style="text-align:right;"><p style="font-size:1.5rem; font-weight:800; color:var(--accent-primary);">${i.horas}</p><p style="font-size:0.7rem;">Horas</p></div>
      </div>`;
    });
  }
  html += `<button class="btn btn-primary" onclick="closeSheet()" style="margin-top:10px;">Cerrar</button>`;
  openSheet(html);
};

window.agregarActividad = () => {
  const html = `<h2>Agregar Tiempo de Predicación</h2>
    <p style="color:var(--text-muted); margin-bottom:20px;">El tiempo se va sumando. Al finalizar el mes, podés enviar el total como informe.</p>
    <div class="input-group"><label>Fecha</label><input type="date" id="act_fecha" value="${new Date().toISOString().split('T')[0]}"></div>
    <div style="display:flex; gap:12px;">
      <div class="input-group" style="flex:1;"><label>Horas</label><input type="number" id="act_horas" min="0" max="23" value="0"></div>
      <div class="input-group" style="flex:1;"><label>Minutos</label><input type="number" id="act_min" min="0" max="59" value="0"></div>
    </div>
    <button class="btn btn-primary" onclick="guardarActividad()">Guardar</button>
  `;
  openSheet(html);
};

window.guardarActividad = async () => {
  const fecha = document.getElementById('act_fecha').value;
  const horas = parseInt(document.getElementById('act_horas').value) || 0;
  const minutos = parseInt(document.getElementById('act_min').value) || 0;
  const totalMin = horas * 60 + minutos;
  if (totalMin <= 0) { alert('Ingresá un tiempo válido'); return; }
  await supabaseClient.from('actividad_diaria').insert({ user_id: currentUser.id, fecha, minutos: totalMin });
  closeSheet();
  await loadData(null, true);
  renderPredicacion();
};

window.crearTerritorio = async () => {
  const numero = prompt("Número del territorio:");
  if (!numero) return;
  const mCount = parseInt(prompt("Cantidad de manzanas:", "10"));
  let manzanas = [];
  for (let i=0; i<mCount; i++) manzanas.push({ index: i+1, completada: false });
  
  await supabaseClient.from('territorios').insert({
    id: 'T' + Date.now(),
    numero: numero,
    descripcion: prompt("Descripción/Lugar:"),
    manzanas: manzanas,
    notas: '',
    puntos_encuentro: '',
    asignado_a: null,
    historial: []
  });
  await loadData(null, true);
};

window.openTerritorio = (id) => {
  const t = S.territorios.find(x => x.id === id);
  if (!t) return;
  const canEditInfo = canDo('asignar_territorios');
  
  let html = `<h2>Territorio ${t.numero}</h2>`;
  if (canEditInfo) {
    const grupoOpts = `<option value="">Sin Grupo</option>` + S.grupos.map(g => `<option value="${g.id}" ${t.grupo_id === g.id ? 'selected' : ''}>${g.nombre}</option>`).join('');
    html += getSelectHermanos('Asignar A:', 't_asignado', t.asignado_a);
    html += `<div class="input-group"><label>Grupo</label><select id="t_grupo">${grupoOpts}</select></div>`;
    html += `<div class="input-group"><label>Notas (No Tocar)</label><textarea id="t_notas">${t.notas||''}</textarea></div>`;
    html += `<div class="input-group"><label>Puntos de Encuentro (uno por línea o separado por comas)</label><textarea id="t_puntos">${Array.isArray(t.puntos_encuentro) ? t.puntos_encuentro.join('\n') : (t.puntos_encuentro||'')}</textarea></div>`;
    html += `<button class="btn btn-secondary" onclick="saveTerritorioInfo('${id}')">Guardar Info</button>`;
  } else {
    html += `<p><strong>Notas:</strong> ${t.notas||'Ninguna'}</p>`;
    html += `<p><strong>Encuentros:</strong> ${Array.isArray(t.puntos_encuentro) ? t.puntos_encuentro.join(', ') : (t.puntos_encuentro||'Ninguno')}</p>`;
  }
  
  html += `<h3 style="margin-top:20px;">Manzanas</h3>`;
  html += `<div style="display:grid; grid-template-columns: repeat(4, 1fr); gap: 8px;">`;
  
  t.manzanas.forEach((m, idx) => {
    const bg = m.completada ? 'var(--success)' : 'var(--bg-card-hover)';
    html += `<div onclick="toggleManzana('${id}', ${idx})" style="background:${bg}; border:1px solid var(--border-color); text-align:center; padding:15px; border-radius:4px; font-weight:bold; cursor:pointer;">${m.index}</div>`;
  });
  html += `</div>`;
  
  if (canEditInfo) {
    html += `<button class="btn btn-secondary" style="margin-top:20px;" onclick="marcarTerritorioTerminado('${id}')">Marcar Terminado y Archivar</button>`;
  }
  
  html += `<button class="btn btn-primary" style="margin-top:20px;" onclick="closeSheet()">Cerrar</button>`;
  openSheet(html);
};

window.saveTerritorioInfo = async (id) => {
  const asignado_a = document.getElementById('t_asignado').value;
  const notas = document.getElementById('t_notas').value;
  const grupo_id = document.getElementById('t_grupo')?.value || null;
  const puntosRaw = document.getElementById('t_puntos').value;
  // Guardar puntos como array (separados por coma o salto de línea)
  const puntos_encuentro = puntosRaw.split(/[\n,]+/).map(p => p.trim()).filter(Boolean);
  
  await supabaseClient.from('territorios').update({
    asignado_a: asignado_a || null,
    notas,
    puntos_encuentro,
    grupo_id: grupo_id || null
  }).eq('id', id);
  
  notifyLocal('Territorio Actualizado', 'Información guardada.');
  await loadData(null, true);
};

window.toggleManzana = async (tid, idx) => {
  const t = S.territorios.find(x => x.id === tid);
  t.manzanas[idx].completada = !t.manzanas[idx].completada;
  
  await supabaseClient.from('territorios').update({ manzanas: t.manzanas }).eq('id', tid);
  await loadData(null, true);
  openTerritorio(tid);
};

window.marcarTerritorioTerminado = async (id) => {
  if(!confirm("¿Archivar este territorio como completado?")) return;
  const t = S.territorios.find(x => x.id === id);
  t.historial.push(new Date().toISOString());
  t.manzanas.forEach(m => m.completada = false);
  
  await supabaseClient.from('territorios').update({
    historial: t.historial,
    manzanas: t.manzanas,
    asignado_a: null
  }).eq('id', id);
  
  await loadData(null, true);
  openTerritorio(id);
};

// ==========================================
// ASIGNACIONES TIMELINE
// ==========================================
function renderAsignaciones() {
  const container = document.getElementById('mis-asignaciones-list');
  if (!container) return;
  let items = [];

  // 1. Partes de Reuniones (solo semanas actuales y futuras)
  const currentWeekStr = getIsoWeek();
  S.reuniones.filter(r => r.id >= currentWeekStr).forEach(r => {
    const dE = r.entre || {}, dF = r.fin || {}, dT = r.tareas || {};
    const roles = [
      [dE.presidente, 'Presidente - Vida y Ministerio'],
      [dE.tesoros_discurso, 'Discurso de Tesoros'],
      [dE.tesoros_perlas, 'Perlas Escondidas'],
      [dE.tesoros_lectura, 'Lectura Bíblica'],
      [dE.smm1_asignado, `Ministerio (${dE.smm1_titulo||'SMM 1'})`],
      [dE.smm2_asignado, `Ministerio (${dE.smm2_titulo||'SMM 2'})`],
      [dE.nvx_asignado, 'Nuestra Vida Cristiana'],
      [dE.estudio_conductor, 'Conductor - Estudio'],
      [dE.estudio_lector, 'Lector - Estudio'],
      [dE.oracion_final, 'Oración Final - Entre Semana'],
      [dF.presidente, 'Presidente - Fin de Semana'],
      [dF.atalaya_conductor, 'Conductor - Atalaya'],
      [dF.atalaya_lector, 'Lector - Atalaya'],
      [dT.sonido, 'Sonido / Mesa'],
      [dT.multimedia, 'Multimedia'],
      [dT.microfono1, 'Micrófono 1'],
      [dT.microfono2, 'Micrófono 2'],
      [dT.acomodador1, 'Acomodador 1'],
      [dT.acomodador2, 'Acomodador 2'],
      [dT.limpieza_grupo, 'Limpieza'],
    ];
    roles.forEach(([uid, titulo]) => {
      if (uid === currentUser.id) {
        items.push({ sortKey: r.id, color: 'var(--accent-primary)', titulo, sub: `Semana ${r.id}` });
      }
    });
  });

  // 2. Salidas al Territorio
  const hoyStr = new Date().toISOString().split('T')[0];
  S.asignaciones_semana.filter(a => a.usuario_id === currentUser.id && (a.fecha || '') >= hoyStr).forEach(s => {
    const t = S.territorios.find(x => x.id === s.territorio_id);
    const dStr = s.fecha ? new Date(s.fecha + 'T00:00:00').toLocaleDateString('es-ES', {weekday:'long', day:'numeric', month:'long'}) : s.semana;
    items.push({
      sortKey: s.fecha || s.semana,
      color: 'var(--success)',
      titulo: 'Predicación Pública',
      sub: `${dStr} ${s.horario ? '- ' + s.horario + 'hs' : ''} | Territorio ${t ? t.numero : '?'} | ${s.punto_encuentro || ''}`
    });
  });

  // 3. Carritos Aprobados
  S.solicitudes_exhibidores.filter(c => c.user_id === currentUser.id && (c.estado === 'aprobado' || c.estado === 'aprobada') && (c.fecha || '') >= hoyStr).forEach(c => {
    const dStr = c.fecha ? new Date(c.fecha + 'T00:00:00').toLocaleDateString('es-ES', {weekday:'long', day:'numeric', month:'long'}) : '';
    const companeroText = c.companero ? ` | Con: ${c.companero}` : '';
    items.push({
      sortKey: c.fecha || '',
      color: 'var(--warning)',
      titulo: 'Exhibidor',
      sub: `${dStr} ${c.horario ? '- ' + c.horario + 'hs' : ''} | ${c.lugar || ''}${companeroText}`
    });
  });

  items.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  if (items.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted); text-align:center; padding:20px 0;">No tenés asignaciones futuras registradas.</p>`;
  } else {
    container.innerHTML = items.map(p => `
      <div style="border-left: 3px solid ${p.color}; padding:12px 16px; margin-bottom:12px; background:var(--bg-card); border-radius:0 12px 12px 0; position:relative;">
        <p style="font-weight:700; color:${p.color}; margin-bottom:4px;">${p.titulo}</p>
        <p style="font-size:0.82rem; color:var(--text-muted);">${p.sub}</p>
      </div>
    `).join('');
  }
}


// ==========================================
// EVENTOS
// ==========================================
function renderEventos() {
  const container = document.getElementById('eventos-list');
  const canEdit = canDo('añadir_eventos') || canDo('editar_eventos');
  if (S.eventos.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted); text-align:center; margin-top:20px;">No hay eventos agendados.</p>`;
  } else {
    const sorted = [...S.eventos].sort((a,b) => new Date(a.fecha) - new Date(b.fecha));
    container.innerHTML = sorted.map((e) => `
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div>
            <h3 style="font-size:1rem; margin-bottom:4px;">${e.nombre}</h3>
            <p style="font-size:0.8rem; color:var(--accent-secondary); font-weight:600;">${new Date(e.fecha + 'T00:00:00').toLocaleDateString('es-ES', {weekday:'long', day:'numeric', month:'long', year:'numeric'})}</p>
            <p style="margin-top:8px; font-size:0.9rem;">${e.descripcion || ''}</p>
          </div>
          ${canEdit ? `
          <div style="display:flex; flex-direction:column; gap:6px; margin-left:10px; flex-shrink:0;">
            <button class="btn btn-secondary" style="padding:6px 10px; font-size:0.75rem; width:auto;" onclick="editarEvento('${e.id}')">
              <i class="fa-solid fa-pen"></i>
            </button>
            <button class="btn btn-secondary" style="padding:6px 10px; font-size:0.75rem; width:auto; color:var(--danger); border-color:var(--danger);" onclick="borrarEvento('${e.id}')">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>` : ''}
        </div>
      </div>
    `).join('');
  }
}

document.getElementById('btn-add-evento').addEventListener('click', () => {
  if (!canDo('añadir_eventos') && !canDo('editar_eventos')) return alert('Sin permiso.');
  abrirFormEvento(null);
});

window.editarEvento = (id) => {
  const e = S.eventos.find(x => x.id === id);
  if (e) abrirFormEvento(e);
};

window.abrirFormEvento = (e) => {
  const esNuevo = !e;
  const html = `
    <h2>${esNuevo ? 'Nuevo Evento' : 'Editar Evento'}</h2>
    <div class="input-group"><label>Nombre</label><input type="text" id="ev_nombre" value="${e ? e.nombre : ''}"></div>
    <div class="input-group"><label>Fecha</label><input type="date" id="ev_fecha" value="${e ? e.fecha : new Date().toISOString().split('T')[0]}"></div>
    <div class="input-group"><label>Descripción</label><textarea id="ev_desc">${e ? (e.descripcion || '') : ''}</textarea></div>
    <button class="btn btn-primary" onclick="guardarEvento(${e ? `'${e.id}'` : 'null'})">Guardar</button>
  `;
  openSheet(html);
};

window.guardarEvento = async (id) => {
  const nombre = document.getElementById('ev_nombre').value.trim();
  const fecha = document.getElementById('ev_fecha').value;
  const descripcion = document.getElementById('ev_desc').value.trim();
  if (!nombre || !fecha) return alert('Compléta nombre y fecha.');
  if (id) {
    await supabaseClient.from('eventos').update({ nombre, fecha, descripcion }).eq('id', id);
  } else {
    await supabaseClient.from('eventos').insert({ nombre, fecha, descripcion });
  }
  closeSheet();
  await loadData(null, true);
};

window.borrarEvento = async (id) => {
  if (!confirm('¿Eliminar este evento?')) return;
  await supabaseClient.from('eventos').delete().eq('id', id);
  await loadData(null, true);
};

// ==========================================
// PERFIL Y ADMIN (HERMANOS, ORADORES, SOLICITUDES)
// ==========================================
function updatePerfilUI() {
  if (!currentUser) return;
  document.getElementById('perfil-nombre').textContent = currentUser.nombre;
  document.getElementById('perfil-rol').textContent = `${currentUser.rol.toUpperCase()} ${currentUser.rol_especifico ? '- ' + currentUser.rol_especifico : ''}`;
  document.getElementById('perfil-avatar').textContent = currentUser.nombre.charAt(0).toUpperCase();
}

function renderPerfil() {
  const esAdmin = currentUser.rol === 'anciano' || canDo('editar_hermanos');
  
  // Funciones del usuario actual
  const misFunciones = (currentUser.permisos || []).filter(p => S.funciones_equipos.some(f => f.nombre === p));
  const funcionesOpts = S.funciones_equipos.map(f =>
    `<label style="display:flex;align-items:center;gap:10px;margin-bottom:10px;font-size:0.95rem;">
      <input type="checkbox" id="func_${f.id}" ${(currentUser.permisos||[]).includes(f.nombre) ? 'checked' : ''}>
      ${f.nombre}
    </label>`
  ).join('');

  let adminHtml = '';
  if (esAdmin) {
    adminHtml = `
      <h3 style="margin-top:24px;">Administración</h3>
      <button class="btn btn-secondary" style="margin-bottom:10px;" onclick="openAdminHermanos()">Gestión de Hermanos</button>
      <button class="btn btn-secondary" style="margin-bottom:10px;" onclick="openAdminOradores()">Oradores Visitantes</button>
      <button class="btn btn-secondary" style="margin-bottom:10px;" onclick="openSolicitudesAdmin()">Aprobar Solicitudes (Exhibidores)</button>
      <button class="btn btn-secondary" style="margin-bottom:10px;" onclick="openAdminGrupos()">Gestionar Grupos</button>
      <button class="btn btn-secondary" style="margin-bottom:10px;" onclick="openAdminFunciones()">Gestionar Funciones/Equipos</button>
    `;
  }

  document.getElementById('view-perfil').innerHTML = `
    <div class="card" style="text-align:center;">
      <div style="width:72px;height:72px;background:var(--accent-gradient);border-radius:50%;margin:0 auto 12px;display:flex;align-items:center;justify-content:center;font-size:1.8rem;font-weight:800;color:white;">${currentUser.nombre.charAt(0)}</div>
      <h3 id="perfil-nombre">${currentUser.nombre}</h3>
      <p id="perfil-rol" style="color:var(--accent-secondary);font-weight:600;margin-bottom:16px;">${currentUser.rol_especifico || currentUser.rol}</p>
      <button class="btn btn-secondary" id="btn-logout">Cerrar Sesión</button>
    </div>

    ${S.funciones_equipos.length > 0 ? `
    <h3 style="margin-top:20px;">Funciones / Equipos</h3>
    <div class="card">
      ${funcionesOpts}
      <button class="btn btn-primary" style="margin-top:12px;" onclick="guardarFuncionesUsuario()">Guardar</button>
    </div>` : ''}

    <h3 style="margin-top:20px;">Mis Solicitudes</h3>
    <button class="btn btn-secondary" onclick="crearSolicitudExhibidor()">Pedir Turno Exhibidor</button>
    
    ${adminHtml}
  `;
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    currentUser = null; showLogin();
  });
}

window.guardarFuncionesUsuario = async () => {
  const funciones_sel = S.funciones_equipos.filter(f => document.getElementById(`func_${f.id}`)?.checked).map(f => f.nombre);
  // Mantener permisos que no sean funciones y agregar los nuevos
  const otrosPermisos = (currentUser.permisos || []).filter(p => !S.funciones_equipos.some(f => f.nombre === p));
  const nuevosPermisos = [...otrosPermisos, ...funciones_sel];
  await supabaseClient.from('usuarios').update({ permisos: nuevosPermisos }).eq('id', currentUser.id);
  currentUser.permisos = nuevosPermisos;
  alert('Funciones guardadas.');
};

window.openAdminGrupos = () => {
  let html = `<h2>Gestionar Grupos</h2>`;
  S.grupos.forEach(g => {
    html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <span>${g.nombre}</span>
      <button class="btn btn-secondary" style="padding:4px 10px;font-size:0.8rem;width:auto;color:var(--danger);" onclick="borrarGrupo('${g.id}')">Borrar</button>
    </div>`;
  });
  html += `<div style="display:flex;gap:8px;margin-top:16px;">
    <input type="text" id="nuevo_grupo" placeholder="Nombre del grupo" style="flex:1;">
    <button class="btn btn-primary" style="width:auto;padding:10px 16px;" onclick="agregarGrupo()">+</button>
  </div>
  <button class="btn btn-secondary" onclick="closeSheet()" style="margin-top:10px;">Cerrar</button>`;
  openSheet(html);
};

window.agregarGrupo = async () => {
  const nombre = document.getElementById('nuevo_grupo').value.trim();
  if (!nombre) return;
  await supabaseClient.from('grupos').insert({ nombre });
  await loadData(null, true);
  openAdminGrupos();
};

window.borrarGrupo = async (id) => {
  if (!confirm('¿Borrar este grupo?')) return;
  await supabaseClient.from('grupos').delete().eq('id', id);
  await loadData(null, true);
  openAdminGrupos();
};

window.openAdminFunciones = () => {
  let html = `<h2>Gestionar Funciones / Equipos</h2>`;
  S.funciones_equipos.forEach(f => {
    html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <span>${f.nombre}</span>
      <button class="btn btn-secondary" style="padding:4px 10px;font-size:0.8rem;width:auto;color:var(--danger);" onclick="borrarFuncion('${f.id}')">Borrar</button>
    </div>`;
  });
  html += `<div style="display:flex;gap:8px;margin-top:16px;">
    <input type="text" id="nueva_funcion" placeholder="Ej: Sonido, Acomodador..." style="flex:1;">
    <button class="btn btn-primary" style="width:auto;padding:10px 16px;" onclick="agregarFuncion()">+</button>
  </div>
  <button class="btn btn-secondary" onclick="closeSheet()" style="margin-top:10px;">Cerrar</button>`;
  openSheet(html);
};

window.agregarFuncion = async () => {
  const nombre = document.getElementById('nueva_funcion').value.trim();
  if (!nombre) return;
  await supabaseClient.from('funciones_equipos').insert({ nombre });
  await loadData(null, true);
  openAdminFunciones();
};

window.borrarFuncion = async (id) => {
  if (!confirm('¿Borrar esta función?')) return;
  await supabaseClient.from('funciones_equipos').delete().eq('id', id);
  await loadData(null, true);
  openAdminFunciones();
};

window.crearSolicitudExhibidor = async () => {
  const dia = prompt("Día y Horario (Ej: Jueves 10 AM):");
  if (!dia) return;
  const lugar = prompt("Lugar:");
  
  await supabaseClient.from('solicitudes_exhibidores').insert({
    user_id: currentUser.id,
    dia: dia,
    lugar: lugar,
    estado: 'pendiente'
  });
  alert("Solicitud enviada.");
  await loadData(null, true);
};

window.openSolicitudesAdmin = () => {
  let html = `<h2>Solicitudes Exhibidores</h2>`;
  const pendientes = S.solicitudes_exhibidores.filter(s => s.estado === 'pendiente');
  if (pendientes.length === 0) html += `<p>No hay solicitudes pendientes.</p>`;
  
  pendientes.forEach(s => {
    html += `<div class="card">
      <p><strong>${getUserName(s.user_id)}</strong></p>
      <p>${s.dia} en ${s.lugar}</p>
      <button class="btn btn-primary" style="width:48%; margin-top:10px;" onclick="resolverSolicitud('${s.id}', 'aprobado')">Aprobar</button>
      <button class="btn btn-secondary" style="width:48%; margin-top:10px; float:right;" onclick="resolverSolicitud('${s.id}', 'rechazado')">Rechazar</button>
    </div>`;
  });
  html += `<button class="btn btn-secondary" style="margin-top:20px;" onclick="closeSheet()">Cerrar</button>`;
  openSheet(html);
};

window.resolverSolicitud = async (id, estado) => {
  await supabaseClient.from('solicitudes_exhibidores').update({ estado: estado }).eq('id', id);
  await loadData(null, true);
  openSolicitudesAdmin();
};

window.openAdminOradores = () => {
  let html = `<h2>Oradores Visitantes</h2>`;
  html += `<button class="btn btn-primary" onclick="crearOrador()" style="margin-bottom:15px;">+ Nuevo Orador</button>`;
  S.oradores.forEach((o) => {
    html += `<div class="card">
      <strong>${o.nombre}</strong> (${o.congregacion})
      <p style="font-size:0.8rem;">Bosquejos: ${o.bosquejos || 'Ninguno'}</p>
      <button class="btn btn-secondary" style="padding:4px; margin-top:8px;" onclick="borrarOrador('${o.id}')">Borrar</button>
    </div>`;
  });
  html += `<button class="btn btn-secondary" onclick="closeSheet()">Cerrar</button>`;
  openSheet(html);
};

window.crearOrador = async () => {
  const nombre = prompt("Nombre del Orador:");
  if (!nombre) return;
  const congregacion = prompt("Congregación:");
  const bosquejosRaw = prompt("Números de Bosquejo (ej. 13, 44):");
  const bosquejos = bosquejosRaw ? bosquejosRaw.split(',').map(s=>s.trim()) : [];
  
  await supabaseClient.from('oradores').insert({
    nombre: nombre,
    congregacion: congregacion,
    bosquejos: bosquejos
  });
  await loadData(null, true);
  openAdminOradores();
};

window.borrarOrador = async (id) => {
  await supabaseClient.from('oradores').delete().eq('id', id);
  await loadData(null, true);
  openAdminOradores();
};

window.openAdminHermanos = () => {
  let html = `<h2>Directorio de Publicadores</h2>`;
  html += `<button class="btn btn-primary" onclick="crearHermano()" style="margin-bottom:15px;">+ Nuevo Hermano (Manual)</button>`;
  S.usuarios.forEach(u => {
    html += `<div class="card" style="margin-bottom:8px;">
      <strong>${u.nombre}</strong> (${u.rol})
      <p style="font-size:0.8rem; color:var(--text-muted); margin-top:4px;">${u.grupo ? u.grupo : 'Sin grupo asignado'}</p>
      <button class="btn btn-secondary" style="padding:4px; font-size:0.75rem; width:auto; float:right; margin-top:-25px;" onclick="editHermano('${u.id}')">Editar</button>
    </div>`;
  });
  html += `<button class="btn btn-primary" style="margin-top:10px;" onclick="closeSheet()">Cerrar</button>`;
  openSheet(html);
};

window.crearHermano = async () => {
  const nombre = prompt("Nombre completo del hermano:");
  if (!nombre) return;
  const grupo = prompt("Grupo de predicación (Ej: Grupo 1):");
  
  await supabaseClient.from('usuarios').insert({
    nombre: nombre,
    grupo: grupo || '',
    rol: 'hermano',
    bautizado: false,
    tipo_precursor: '',
    etiquetas: [],
    permisos: [],
    ausencias: []
  });
  await loadData(null, true);
  openAdminHermanos();
};

window.editHermano = (id) => {
  const u = S.usuarios.find(x => x.id === id);
  if (!u) return;
  
  const perm = u.permisos || [];
  
  let html = `<h2>Editar ${u.nombre}</h2>
    <div class="input-group"><label>Nombre</label><input type="text" id="u_nombre" value="${u.nombre}"></div>
    <div class="input-group"><label>Grupo de Predicación</label>
      <select id="u_grupo">
        <option value="" ${!u.grupo?'selected':''}>Sin Grupo</option>
        <option value="Grupo 1" ${u.grupo==='Grupo 1'?'selected':''}>Grupo 1</option>
        <option value="Grupo 2" ${u.grupo==='Grupo 2'?'selected':''}>Grupo 2</option>
        <option value="Grupo 3" ${u.grupo==='Grupo 3'?'selected':''}>Grupo 3</option>
        <option value="Grupo 4" ${u.grupo==='Grupo 4'?'selected':''}>Grupo 4</option>
        <option value="Grupo 5" ${u.grupo==='Grupo 5'?'selected':''}>Grupo 5</option>
      </select>
    </div>
    
    <div style="display:flex; align-items:center; gap:10px; margin-bottom:15px;">
      <input type="checkbox" id="u_bautizado" ${u.bautizado?'checked':''} style="width:18px; height:18px;">
      <label for="u_bautizado">Hermano Bautizado</label>
    </div>
    
    <div class="input-group"><label>Rol Espiritual</label>
      <select id="u_rol">
        <option value="hermano" ${u.rol==='hermano'?'selected':''}>Hermano</option>
        <option value="precursor" ${u.rol==='precursor'?'selected':''}>Precursor</option>
        <option value="siervo_min" ${u.rol==='siervo_min'?'selected':''}>Siervo Ministerial</option>
        <option value="anciano" ${u.rol==='anciano'?'selected':''}>Anciano</option>
      </select>
    </div>
    
    <div class="input-group"><label>Tipo de Precursor</label>
      <select id="u_precursor">
        <option value="" ${!u.tipo_precursor?'selected':''}>Ninguno</option>
        <option value="auxiliar" ${u.tipo_precursor==='auxiliar'?'selected':''}>Auxiliar</option>
        <option value="auxiliar_continuo" ${u.tipo_precursor==='auxiliar_continuo'?'selected':''}>Auxiliar Continuo</option>
        <option value="regular" ${u.tipo_precursor==='regular'?'selected':''}>Regular</option>
      </select>
    </div>
    
    <div class="input-group"><label>Cargo Específico</label>
      <select id="u_cargo">
        <option value="" ${!u.rol_especifico?'selected':''}>Ninguno</option>
        <option value="coordinador" ${u.rol_especifico==='coordinador'?'selected':''}>Coordinador</option>
        <option value="superintendente_servicio" ${u.rol_especifico==='superintendente_servicio'?'selected':''}>Superintendente de Servicio</option>
        <option value="secretario" ${u.rol_especifico==='secretario'?'selected':''}>Secretario</option>
      </select>
    </div>
    
    <div class="input-group"><label>Funciones / Equipos</label>
      <div id="u_tags_container" style="display:flex; flex-wrap:wrap; gap:8px;">
        ${['Sonido', 'Micrófonos', 'Acomodadores', 'Plataforma', 'Limpieza', 'Hospitalidad', 'Audio/video', 'Traducción', 'Seguridad'].map(f => {
          const isActive = u.etiquetas?.includes(f);
          return `<div class="chip ${isActive ? 'active' : ''}" onclick="this.classList.toggle('active'); this.innerText = this.classList.contains('active') ? '✓ ' + this.dataset.value : this.dataset.value;" data-value="${f}">${isActive ? '✓ ' : ''}${f}</div>`;
        }).join('')}
      </div>
    </div>
    
    <div class="card" style="background:var(--bg-main);">
      <h4>Permisos Adicionales</h4>
      <div style="display:grid; grid-template-columns: 1fr; gap: 8px; margin-top:10px; font-size:0.9rem;">
        <label><input type="checkbox" id="p_terr" ${perm.includes('asignar_territorios')?'checked':''}> Asignar Territorios</label>
        <label><input type="checkbox" id="p_reu_e" ${perm.includes('asignar_reunion_entre_semana')?'checked':''}> Asignar Entre Semana</label>
        <label><input type="checkbox" id="p_reu_f" ${perm.includes('asignar_reunion_fin_semana')?'checked':''}> Asignar Fin de Semana</label>
        <label><input type="checkbox" id="p_grup" ${perm.includes('asignar_grupo')?'checked':''}> Asignar Grupo</label>
        <label><input type="checkbox" id="p_edit" ${perm.includes('editar_hermanos')?'checked':''}> Editar Hermanos</label>
        <label><input type="checkbox" id="p_soni" ${perm.includes('asignar_sonido')?'checked':''}> Asignar Sonido</label>
        <label><input type="checkbox" id="p_acom" ${perm.includes('asignar_acomodadores')?'checked':''}> Asignar Acomodadores</label>
        <label><input type="checkbox" id="p_limp" ${perm.includes('asignar_limpieza')?'checked':''}> Asignar Limpieza</label>
        <label><input type="checkbox" id="p_hosp" ${perm.includes('asignar_hospitalidad')?'checked':''}> Asignar Hospitalidad</label>
        <label><input type="checkbox" id="p_even" ${perm.includes('añadir_eventos')?'checked':''}> Añadir Eventos</label>
        <label><input type="checkbox" id="p_anun" ${perm.includes('subir_anuncios')?'checked':''}> Subir Anuncios</label>
      </div>
    </div>
    
    <div class="card" style="background:var(--bg-main);">
      <h4>Ausencias</h4>
      <p style="font-size:0.8rem; color:var(--text-muted);">Añadir un rango donde no podrá ser asignado.</p>
      <div style="display:flex; gap:10px;">
        <input type="date" id="a_inicio" style="padding:4px; flex:1;"> 
        <input type="date" id="a_fin" style="padding:4px; flex:1;">
      </div>
      <button class="btn btn-secondary" style="padding:4px; margin-top:5px; width:100%;" onclick="addAusencia('${u.id}')">Agregar Ausencia</button>
      <div id="u_ausencias_list" style="margin-top:10px; font-size:0.85rem;">
        ${(u.ausencias||[]).map((a,i) => `<div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-color); padding:4px 0;"><span>${a.inicio} a ${a.fin}</span> <button onclick="delAusencia('${u.id}', ${i})" style="color:var(--danger); background:none; border:none; padding:0 5px;"><i class="fa-solid fa-trash"></i></button></div>`).join('')}
      </div>
    </div>
    
    <button class="btn btn-primary" onclick="saveHermano('${u.id}')">Guardar Perfil</button>
    <button class="btn btn-secondary" style="margin-top:10px;" onclick="if(confirm('¿Borrar hermano permanentemente?')) borrarHermano('${u.id}')">Borrar Hermano</button>
  `;
  openSheet(html);
};

window.openSheet = (html) => {
  DOM.sheetContent.innerHTML = html;
  DOM.modalOverlay.classList.add('active');
  DOM.bottomSheet.classList.add('active');
}

window.addAusencia = async (id) => {
  const u = S.usuarios.find(x => x.id === id);
  const ini = document.getElementById('a_inicio').value;
  const fin = document.getElementById('a_fin').value;
  if (!ini || !fin) return;
  if (!u.ausencias) u.ausencias = [];
  u.ausencias.push({ inicio: ini, fin: fin });
  
  await supabaseClient.from('usuarios').update({ ausencias: u.ausencias }).eq('id', id);
  await loadData(null, true);
  editHermano(id);
};

window.delAusencia = async (id, idx) => {
  const u = S.usuarios.find(x => x.id === id);
  u.ausencias.splice(idx, 1);
  await supabaseClient.from('usuarios').update({ ausencias: u.ausencias }).eq('id', id);
  await loadData(null, true);
  editHermano(id);
};

window.borrarHermano = async (id) => {
  await supabaseClient.from('usuarios').delete().eq('id', id);
  await loadData(null, true);
  openAdminHermanos();
};

window.saveHermano = async (id) => {
  const nombre = document.getElementById('u_nombre').value;
  const grupo = document.getElementById('u_grupo').value;
  const bautizado = document.getElementById('u_bautizado').checked;
  const rol = document.getElementById('u_rol').value;
  const tipo_precursor = document.getElementById('u_precursor').value;
  const rol_especifico = document.getElementById('u_cargo').value;
  const etiquetas = Array.from(document.querySelectorAll('#u_tags_container .chip.active')).map(el => el.dataset.value);
  
  let p = [];
  if (document.getElementById('p_terr').checked) p.push('asignar_territorios');
  if (document.getElementById('p_reu_e').checked) p.push('asignar_reunion_entre_semana');
  if (document.getElementById('p_reu_f').checked) p.push('asignar_reunion_fin_semana');
  if (document.getElementById('p_grup').checked) p.push('asignar_grupo');
  if (document.getElementById('p_edit').checked) p.push('editar_hermanos');
  if (document.getElementById('p_soni').checked) p.push('asignar_sonido');
  if (document.getElementById('p_acom').checked) p.push('asignar_acomodadores');
  if (document.getElementById('p_limp').checked) p.push('asignar_limpieza');
  if (document.getElementById('p_hosp').checked) p.push('asignar_hospitalidad');
  if (document.getElementById('p_even').checked) p.push('añadir_eventos');
  if (document.getElementById('p_anun').checked) p.push('subir_anuncios');
  
  await supabaseClient.from('usuarios').update({
    nombre: nombre,
    grupo: grupo,
    bautizado: bautizado,
    rol: rol,
    tipo_precursor: tipo_precursor,
    rol_especifico: rol_especifico,
    etiquetas: etiquetas,
    permisos: p
  }).eq('id', id);
  
  notifyLocal("Usuario Guardado", `Se actualizó el perfil.`);
  await loadData(null, true);
  openAdminHermanos();
};

window.closeSheet = () => {
  DOM.modalOverlay.classList.remove('active');
  DOM.bottomSheet.classList.remove('active');
  setTimeout(() => DOM.sheetContent.innerHTML = '', 300);
};

document.addEventListener('DOMContentLoaded', init);
