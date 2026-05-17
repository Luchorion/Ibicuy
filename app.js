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
  version: 2
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

function checkWeekRotation() {
  const current = getIsoWeek();
  Object.keys(S.reunion_data).forEach(week => {
    if (week < current) {
      if (!S.historial_semanas[week]) S.historial_semanas[week] = S.reunion_data[week];
      delete S.reunion_data[week];
    }
  });
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
  checkWeekRotation();
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
async function loadData(authUser) {
  setSyncStatus('yellow');
  const localData = localStorage.getItem(STORE_KEY);
  if (localData) { try { S = { ...S, ...JSON.parse(localData) }; } catch(e) {} }

  try {
    const { data, error } = await supabaseClient.from('app_store').select('data').eq('id', 1).single();
    if (error && error.code !== 'PGRST116') throw error; 
    
    if (data && data.data) {
      S = { ...S, ...data.data }; 
      saveLocal(); 
    } else {
      triggerSync();
    }
    setSyncStatus('green');
  } catch(err) {
    setSyncStatus('red');
  }

  currentUser = S.usuarios.find(u => u.email === authUser.email);
  if (!currentUser && S.usuarios.length === 0) {
    currentUser = {
      id: authUser.id, email: authUser.email, nombre: 'Admin Inicial',
      rol: 'anciano', rol_especifico: 'coordinador', etiquetas: [],
      permisos: ['asignar_territorios', 'asignar_reunion_entre_semana', 'asignar_reunion_fin_semana', 'editar_hermanos', 'añadir_eventos', 'subir_anuncios', 'asignar_sonido', 'asignar_acomodadores', 'asignar_limpieza'],
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

function saveLocal() { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }

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
    } catch (err) { setSyncStatus('red'); }
  }, 1500);
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
  const dE = S.reunion_data[week]?.entre || {};
  const dF = S.reunion_data[week]?.fin || {};
  const dT = S.reunion_data[week]?.tareas || {};
  
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
  
  if (!S.reunion_data[activeWeek]) S.reunion_data[activeWeek] = { entre: {}, fin: {}, tareas: {}, asistencia: {} };
  const dE = S.reunion_data[activeWeek].entre || {};
  const dF = S.reunion_data[activeWeek].fin || {};
  const dT = S.reunion_data[activeWeek].tareas || {};

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
  const data = S.reunion_data[activeWeek][tipo] || {};
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
    html += getSelectHermanos('NVX - Asignado', 'nvx_asignado', data.nvx_asignado, ['anciano', 'siervo_min']);
    html += getSelectHermanos('Estudio - Conductor', 'estudio_conductor', data.estudio_conductor, ['anciano']);
    html += getSelectHermanos('Estudio - Lector', 'estudio_lector', data.estudio_lector);
    html += getSelectHermanos('Oración Final', 'oracion_final', data.oracion_final);
  } else if (tipo === 'fin') {
    html += getSelectHermanos('Presidente', 'presidente', data.presidente, ['anciano', 'siervo_min']);
    
    let orOptions = `<option value="">-- Ninguno --</option>`;
    S.oradores.forEach(o => orOptions += `<option value="${o.id}" ${data.orador === o.id ? 'selected' : ''}>${o.nombre} (${o.congregacion})</option>`);
    html += `<div class="input-group"><label>Orador Visitante</label><select id="orador">${orOptions}</select></div>`;
    
    html += getSelectHermanos('Atalaya - Conductor', 'atalaya_conductor', data.atalaya_conductor, ['anciano']);
    html += getSelectHermanos('Atalaya - Lector', 'atalaya_lector', data.atalaya_lector);
  } else if (tipo === 'tareas') {
    html += getSelectHermanos('Sonido / Mesa', 'sonido', data.sonido, null, 'Sonido');
    html += getSelectHermanos('Multimedia', 'multimedia', data.multimedia, null, 'Multimedia');
    html += getSelectHermanos('Micrófonos (Multi)', 'microfonos', data.microfonos || [], null, 'Micrófonos', true);
    html += getSelectHermanos('Acomodadores Entrada (Multi)', 'acomodadores_entrada', data.acomodadores_entrada || [], null, 'Acomodadores', true);
    html += getSelectHermanos('Acomodadores Auditorio (Multi)', 'acomodadores_auditorio', data.acomodadores_auditorio || [], null, 'Acomodadores', true);
    html += `<div class="input-group"><label>Limpieza (Grupo)</label><input type="number" id="limpieza" value="${data.limpieza||''}"></div>`;
    
    html += `<h3 style="margin-top:20px;">Asistencia</h3>`;
    const asis = S.reunion_data[activeWeek].asistencia || {};
    html += `<div class="input-group"><label>En Persona</label><input type="number" id="asis_fisica" value="${asis.fisica||0}"></div>`;
    html += `<div class="input-group"><label>En Línea</label><input type="number" id="asis_online" value="${asis.online||0}"></div>`;
  }
  
  html += `<button type="submit" class="btn btn-primary" style="margin-top:20px;">Guardar y Validar</button>`;
  html += `</form>`;
  openSheet(html);
};

window.saveReunion = (e, tipo) => {
  e.preventDefault();
  const form = e.target;
  const data = S.reunion_data[activeWeek][tipo] || {};
  let bloqueos = [];
  let advertencias = [];
  
  Array.from(form.elements).forEach(el => {
    if (el.id && el.tagName !== 'BUTTON') {
      let val = el.multiple ? Array.from(el.selectedOptions).map(o=>o.value) : el.value;
      
      if (tipo === 'tareas' && el.id.startsWith('asis_')) {
        if(!S.reunion_data[activeWeek].asistencia) S.reunion_data[activeWeek].asistencia = {};
        S.reunion_data[activeWeek].asistencia[el.id.split('_')[1]] = parseInt(val) || 0;
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
  
  const hMes = S.informes_mensuales.filter(i => i.userId === currentUser.id && new Date(i.fecha).getMonth() === ahora.getMonth()).reduce((a,b)=>a+b.horas, 0);
  const hAno = S.informes_mensuales.filter(i => i.userId === currentUser.id && new Date(i.fecha) >= new Date(startYear, 8, 1)).reduce((a,b)=>a+b.horas, 0);
  
  let view = document.getElementById('view-predicacion');
  view.innerHTML = `
    <h2>Mi Actividad</h2>
    <div class="card">
      <p>Horas este mes: <strong>${hMes}</strong></p>
      <p>Año de Servicio: <strong>${hAno}</strong> (Año ${startYear}-${startYear+1})</p>
      <button class="btn btn-secondary" style="margin-top:10px;" onclick="enviarInforme()">Enviar Informe Mensual</button>
    </div>
    
    <h2>Territorios</h2>
    ${canDo('asignar_territorios') ? `<button class="btn btn-secondary" onclick="crearTerritorio()" style="margin-bottom:16px;">Nuevo Territorio</button>` : ''}
  `;
  
  S.territorios.forEach(t => {
    // Si no tiene permiso, solo ve los que le asignaron a el.
    const isAssigned = t.asignado_a === currentUser.id;
    if (canDo('asignar_territorios') || currentUser.rol === 'anciano' || isAssigned) {
      view.innerHTML += `<div class="card" onclick="openTerritorio('${t.id}')">
        <h4>Territorio ${t.numero}</h4>
        <p>${t.descripcion || 'Sin descripción'}</p>
        <p style="font-size:0.8rem; color:var(--accent-primary);">Asignado a: ${getUserName(t.asignado_a)}</p>
      </div>`;
    }
  });
}

window.enviarInforme = () => {
  const horas = parseFloat(prompt("Horas predicadas este mes:"));
  if (isNaN(horas)) return;
  const estudios = parseInt(prompt("Cantidad de estudios:"));
  S.informes_mensuales.push({ userId: currentUser.id, fecha: new Date().toISOString(), horas, estudios: isNaN(estudios)?0:estudios });
  saveData();
  renderPredicacion();
  alert("Informe enviado con éxito.");
};

window.crearTerritorio = () => {
  const numero = prompt("Número del territorio:");
  if (!numero) return;
  const mCount = parseInt(prompt("Cantidad de manzanas:", "10"));
  let manzanas = [];
  for (let i=0; i<mCount; i++) manzanas.push({ index: i+1, completada: false });
  S.territorios.push({ id: 'T'+Date.now(), numero, descripcion: prompt("Descripción/Lugar:"), manzanas, notas: '', puntos_encuentro: '', asignado_a: null, historial: [] });
  saveData(); renderPredicacion();
};

window.openTerritorio = (id) => {
  const t = S.territorios.find(x => x.id === id);
  if (!t) return;
  const canEditInfo = canDo('asignar_territorios');
  
  let html = `<h2>Territorio ${t.numero}</h2>`;
  if (canEditInfo) {
    html += getSelectHermanos('Asignar A:', 't_asignado', t.asignado_a);
    html += `<div class="input-group"><label>Notas (No Tocar)</label><textarea id="t_notas">${t.notas||''}</textarea></div>`;
    html += `<div class="input-group"><label>Puntos de Encuentro</label><textarea id="t_puntos">${t.puntos_encuentro||''}</textarea></div>`;
    html += `<button class="btn btn-secondary" onclick="saveTerritorioInfo('${id}')">Guardar Info</button>`;
  } else {
    html += `<p><strong>Notas:</strong> ${t.notas||'Ninguna'}</p>`;
    html += `<p><strong>Encuentros:</strong> ${t.puntos_encuentro||'Ninguno'}</p>`;
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

window.saveTerritorioInfo = (id) => {
  const t = S.territorios.find(x => x.id === id);
  t.asignado_a = document.getElementById('t_asignado').value;
  t.notas = document.getElementById('t_notas').value;
  t.puntos_encuentro = document.getElementById('t_puntos').value;
  saveData(); renderPredicacion();
  notifyLocal('Territorio Actualizado', `Información de T-${t.numero} guardada.`);
};

window.toggleManzana = (tid, idx) => {
  const t = S.territorios.find(x => x.id === tid);
  t.manzanas[idx].completada = !t.manzanas[idx].completada;
  saveData(); openTerritorio(tid);
};

window.marcarTerritorioTerminado = (id) => {
  if(!confirm("¿Archivar este territorio como completado?")) return;
  const t = S.territorios.find(x => x.id === id);
  t.historial.push(new Date().toISOString());
  t.manzanas.forEach(m => m.completada = false);
  t.asignado_a = null;
  saveData(); openTerritorio(id);
};

// ==========================================
// ASIGNACIONES TIMELINE
// ==========================================
function renderAsignaciones() {
  const container = document.getElementById('mis-asignaciones-list');
  let partes = [];
  
  Object.keys(S.reunion_data).forEach(week => {
    const dE = S.reunion_data[week].entre || {};
    const dF = S.reunion_data[week].fin || {};
    const dT = S.reunion_data[week].tareas || {};
    
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
    
    if (dT.sonido === currentUser.id) partes.push({ week, titulo: 'Sonido / Mesa' });
    if (dT.multimedia === currentUser.id) partes.push({ week, titulo: 'Multimedia' });
    if (dT.microfonos && dT.microfonos.includes(currentUser.id)) partes.push({ week, titulo: 'Micrófonos' });
    if (dT.acomodadores_entrada && dT.acomodadores_entrada.includes(currentUser.id)) partes.push({ week, titulo: 'Acomodador (Entrada)' });
    if (dT.acomodadores_auditorio && dT.acomodadores_auditorio.includes(currentUser.id)) partes.push({ week, titulo: 'Acomodador (Auditorio)' });
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
  if (!canDo('añadir_eventos')) return alert("Sin permiso.");
  const nombre = prompt("Nombre del evento:");
  if (!nombre) return;
  const fecha = prompt("Fecha (YYYY-MM-DD):", new Date().toISOString().split('T')[0]);
  S.eventos.push({ nombre, fecha, descripcion: prompt("Descripción:") });
  saveData(); renderEventos();
});

window.borrarEvento = (idx) => { S.eventos.splice(idx, 1); saveData(); renderEventos(); }

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
  const isAnciano = currentUser.rol === 'anciano' || canDo('editar_hermanos');
  let adminHtml = '';
  if (isAnciano) {
    adminHtml = `
      <h3 style="margin-top:20px;">Administración</h3>
      <button class="btn btn-secondary" style="margin-bottom:10px;" onclick="openAdminHermanos()">Gestión de Hermanos</button>
      <button class="btn btn-secondary" style="margin-bottom:10px;" onclick="openAdminOradores()">Oradores Visitantes</button>
      <button class="btn btn-secondary" style="margin-bottom:10px;" onclick="openSolicitudesAdmin()">Aprobar Solicitudes (Exhibidores)</button>
    `;
  }
  
  document.getElementById('view-perfil').innerHTML = `
    <div class="card" style="text-align: center;">
      <div style="width: 60px; height: 60px; background: var(--accent-primary); border-radius: 50%; margin: 0 auto 10px auto; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; font-weight: bold; color: white;" id="perfil-avatar">${currentUser.nombre.charAt(0)}</div>
      <h3 id="perfil-nombre">${currentUser.nombre}</h3>
      <p id="perfil-rol" style="margin-bottom: 10px;">${currentUser.rol}</p>
      <button class="btn btn-secondary" id="btn-logout" style="margin-top: 10px;">Cerrar Sesión</button>
    </div>
    
    <h3 style="margin-top:20px;">Mis Solicitudes</h3>
    <button class="btn btn-secondary" onclick="crearSolicitudExhibidor()">Pedir Turno Exhibidor</button>
    
    ${adminHtml}
  `;
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    currentUser = null; showLogin();
  });
}

window.crearSolicitudExhibidor = () => {
  const dia = prompt("Día y Horario (Ej: Jueves 10 AM):");
  if (!dia) return;
  const lugar = prompt("Lugar:");
  S.solicitudes_exhibidores.push({ id: Date.now(), userId: currentUser.id, dia, lugar, estado: 'pendiente' });
  saveData();
  alert("Solicitud enviada.");
};

window.openSolicitudesAdmin = () => {
  let html = `<h2>Solicitudes Exhibidores</h2>`;
  const pendientes = S.solicitudes_exhibidores.filter(s => s.estado === 'pendiente');
  if (pendientes.length === 0) html += `<p>No hay solicitudes pendientes.</p>`;
  
  pendientes.forEach(s => {
    html += `<div class="card">
      <p><strong>${getUserName(s.userId)}</strong></p>
      <p>${s.dia} en ${s.lugar}</p>
      <button class="btn btn-primary" style="width:48%; margin-top:10px;" onclick="resolverSolicitud(${s.id}, 'aprobado')">Aprobar</button>
      <button class="btn btn-secondary" style="width:48%; margin-top:10px; float:right;" onclick="resolverSolicitud(${s.id}, 'rechazado')">Rechazar</button>
    </div>`;
  });
  html += `<button class="btn btn-secondary" style="margin-top:20px;" onclick="closeSheet()">Cerrar</button>`;
  openSheet(html);
};

window.resolverSolicitud = (id, estado) => {
  const s = S.solicitudes_exhibidores.find(x => x.id === id);
  if(s) s.estado = estado;
  saveData(); openSolicitudesAdmin();
};

window.openAdminOradores = () => {
  let html = `<h2>Oradores Visitantes</h2>`;
  html += `<button class="btn btn-primary" onclick="crearOrador()" style="margin-bottom:15px;">+ Nuevo Orador</button>`;
  S.oradores.forEach((o, i) => {
    html += `<div class="card">
      <strong>${o.nombre}</strong> (${o.congregacion})
      <p style="font-size:0.8rem;">Bosquejos: ${o.bosquejos || 'Ninguno'}</p>
      <button class="btn btn-secondary" style="padding:4px; margin-top:8px;" onclick="borrarOrador(${i})">Borrar</button>
    </div>`;
  });
  html += `<button class="btn btn-secondary" onclick="closeSheet()">Cerrar</button>`;
  openSheet(html);
};

window.crearOrador = () => {
  const nombre = prompt("Nombre del Orador:");
  if (!nombre) return;
  const congregacion = prompt("Congregación:");
  const bosquejos = prompt("Números de Bosquejo (ej. 13, 44):");
  S.oradores.push({ id: 'O'+Date.now(), nombre, congregacion, bosquejos });
  saveData(); openAdminOradores();
};
window.borrarOrador = (i) => { S.oradores.splice(i,1); saveData(); openAdminOradores(); };

window.openAdminHermanos = () => {
  let html = `<h2>Directorio</h2>`;
  S.usuarios.forEach(u => {
    html += `<div class="card" style="margin-bottom:8px;">
      <strong>${u.nombre}</strong> (${u.rol})
      <button class="btn btn-secondary" style="padding:4px; font-size:0.75rem; width:auto; float:right;" onclick="editHermano('${u.id}')">Editar</button>
    </div>`;
  });
  html += `<button class="btn btn-primary" style="margin-top:10px;" onclick="closeSheet()">Cerrar</button>`;
  openSheet(html);
};

window.editHermano = (id) => {
  const u = S.usuarios.find(x => x.id === id);
  if (!u) return;
  let html = `<h2>Editar ${u.nombre}</h2>
    <div class="input-group"><label>Rol Base</label>
      <select id="u_rol">
        <option value="publicador" ${u.rol==='publicador'?'selected':''}>Publicador</option>
        <option value="precursor" ${u.rol==='precursor'?'selected':''}>Precursor</option>
        <option value="siervo_min" ${u.rol==='siervo_min'?'selected':''}>Siervo Min.</option>
        <option value="anciano" ${u.rol==='anciano'?'selected':''}>Anciano</option>
      </select>
    </div>
    <div class="input-group"><label>Cargo Específico</label><input type="text" id="u_cargo" value="${u.rol_especifico||''}"></div>
    <div class="input-group"><label>Etiquetas (Separadas por coma: Sonido, Micrófonos, Plataforma)</label><input type="text" id="u_tags" value="${u.etiquetas?u.etiquetas.join(', '):''}"></div>
    
    <div class="card" style="background:var(--bg-main);">
      <h4>Permisos Especiales</h4>
      <label><input type="checkbox" id="p_terr" ${u.permisos.includes('asignar_territorios')?'checked':''}> Asignar Territorios</label><br>
      <label><input type="checkbox" id="p_reu" ${u.permisos.includes('asignar_reunion_entre_semana')?'checked':''}> Asignar Reuniones</label><br>
      <label><input type="checkbox" id="p_anu" ${u.permisos.includes('subir_anuncios')?'checked':''}> Subir Anuncios</label>
    </div>
    
    <div class="card" style="background:var(--bg-main);">
      <h4>Ausencias</h4>
      <p style="font-size:0.8rem; color:var(--text-muted);">Añadir un rango donde no podrá ser asignado.</p>
      <div style="display:flex; gap:10px;">
        <input type="date" id="a_inicio" style="padding:4px;"> 
        <input type="date" id="a_fin" style="padding:4px;">
      </div>
      <button class="btn btn-secondary" style="padding:4px; margin-top:5px;" onclick="addAusencia('${u.id}')">Agregar Ausencia</button>
      <div id="u_ausencias_list" style="margin-top:10px; font-size:0.85rem;">
        ${(u.ausencias||[]).map((a,i) => `${a.inicio} a ${a.fin} <button onclick="delAusencia('${u.id}', ${i})" style="color:var(--danger); background:none; border:none;">(x)</button><br>`).join('')}
      </div>
    </div>
    
    <button class="btn btn-primary" onclick="saveHermano('${u.id}')">Guardar Perfil</button>
  `;
  openSheet(html);
};

window.addAusencia = (id) => {
  const u = S.usuarios.find(x => x.id === id);
  const ini = document.getElementById('a_inicio').value;
  const fin = document.getElementById('a_fin').value;
  if (!ini || !fin) return;
  if (!u.ausencias) u.ausencias = [];
  u.ausencias.push({ inicio: ini, fin: fin });
  saveData(); editHermano(id);
};
window.delAusencia = (id, idx) => {
  const u = S.usuarios.find(x => x.id === id);
  u.ausencias.splice(idx, 1);
  saveData(); editHermano(id);
};

window.saveHermano = (id) => {
  const u = S.usuarios.find(x => x.id === id);
  u.rol = document.getElementById('u_rol').value;
  u.rol_especifico = document.getElementById('u_cargo').value;
  u.etiquetas = document.getElementById('u_tags').value.split(',').map(s=>s.trim()).filter(s=>s);
  
  let p = [];
  if (document.getElementById('p_terr').checked) p.push('asignar_territorios');
  if (document.getElementById('p_reu').checked) { p.push('asignar_reunion_entre_semana'); p.push('asignar_reunion_fin_semana'); }
  if (document.getElementById('p_anu').checked) p.push('subir_anuncios');
  u.permisos = p;
  
  saveData();
  notifyLocal("Usuario Guardado", `Se actualizó el perfil de ${u.nombre}`);
  openAdminHermanos();
};

window.closeSheet = () => {
  DOM.modalOverlay.classList.remove('active');
  DOM.bottomSheet.classList.remove('active');
  setTimeout(() => DOM.sheetContent.innerHTML = '', 300);
};

document.addEventListener('DOMContentLoaded', init);
