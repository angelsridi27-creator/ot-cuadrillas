// Interfaz de la app: cuadrilla (celular) y panel del supervisor.
import * as db from './db.js';
import {
  agruparPorCategoria, jornadasDeOT, jornadaDeFecha, hoyISO, fechaAR, fondoPrioridad,
  avanceOT, categoriaOT, textoInicialOT, compararPiquetes, CATEGORIAS_OT, MAX_JORNADAS,
  COLORES_DEFECTO, secuenciaDeNro, estadoMarca, MOTIVOS_PROCESO
} from './logica.js';
import { VERSION_APP } from './config.js';

// ---------------- Estado y utilidades ----------------

const S = {
  user: null, perfil: null, config: { colores: COLORES_DEFECTO, ultimaSecuencia: 0, codigosLinea: {} },
  subs: [], filtro: 'todos', seleccion: null, ot: null, otMeta: null,
  reclamos: null, lineaElegida: '', usuarios: null, instalar: null
};
const app = document.getElementById('app');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const esSup = () => S.perfil && S.perfil.rol === 'supervisor';

function limpiarSubs() { S.subs.forEach(u => { try { u(); } catch (_) { /* nada */ } }); S.subs = []; }

function toast(msg, tipo = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast-${tipo}`;
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('fuera'), 3200);
  setTimeout(() => t.remove(), 3700);
}

function render(html) {
  app.innerHTML = html;
}

function conservarScroll(fn) {
  const m = app.querySelector('.scroll');
  const top = m ? m.scrollTop : 0;
  fn();
  const m2 = app.querySelector('.scroll');
  if (m2) m2.scrollTop = top;
}

// Marcas guardadas en el teléfono que todavía no llegaron al servidor
const pend = {
  clave: id => 'pend:' + id,
  leer(id) { try { return JSON.parse(localStorage.getItem(this.clave(id)) || '[]'); } catch (_) { return []; } },
  agregar(id, rid) { const s = new Set(this.leer(id)); s.add(rid); try { localStorage.setItem(this.clave(id), JSON.stringify([...s])); } catch (_) { /* nada */ } },
  limpiar(id) { try { localStorage.removeItem(this.clave(id)); } catch (_) { /* nada */ } },
  total() {
    let n = 0;
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('pend:')) n += JSON.parse(localStorage.getItem(k) || '[]').length; } } catch (_) { /* nada */ }
    return n;
  }
};

const icono = {
  volver: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  salir: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
  sinSenal: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8a15 15 0 0 0-9.6-3.6M5 12.6a10 10 0 0 1 3-1.8M19 12.6a10 10 0 0 0-4.3-2.2M8.5 16.4a5 5 0 0 1 7 0M12 20h.01M3 3l18 18"/></svg>',
  bandera: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></svg>',
  ok: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>'
};

function avisoConexion() {
  const n = pend.total();
  if (!navigator.onLine) {
    return `<div class="aviso aviso-ambar" role="status">${icono.sinSenal}<div><strong>Sin señal</strong><span>${n ? `${n} cambio${n > 1 ? 's' : ''} guardado${n > 1 ? 's' : ''} en el teléfono. ` : ''}Se envían solos al volver la conexión con la app abierta.</span></div></div>`;
  }
  if (n) {
    return `<div class="aviso aviso-ambar" role="status">${icono.sinSenal}<div><strong>Enviando cambios…</strong><span>${n} pendiente${n > 1 ? 's' : ''}. Mantené la app abierta.</span></div></div>`;
  }
  return '';
}

function avisoInstalar() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (standalone) return '';
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (ios) {
    return `<div class="aviso aviso-azul"><div><strong>Instalá la app en el iPhone</strong><span>En Safari tocá Compartir y después "Agregar a pantalla de inicio". Instalada funciona sin señal y no pierde los datos.</span></div></div>`;
  }
  if (S.instalar) {
    return `<div class="aviso aviso-azul"><div><strong>Instalá la app</strong><span>Así funciona sin señal y se abre desde la pantalla de inicio.</span></div><button class="btn btn-chico" data-accion="instalar">Instalar</button></div>`;
  }
  return '';
}

// ---------------- Router ----------------

function ruta() {
  const h = location.hash.replace(/^#\/?/, '');
  const [a, b, c] = h.split('/');
  return { a: a || '', b: b || '', c: c || '' };
}

function navegar(h) { if (location.hash !== h) location.hash = h; else enrutar(); }

function enrutar() {
  limpiarSubs();
  S.seleccion = null;
  if (!S.user) return vistaLogin();
  if (!S.perfil) return vistaSinPerfil();
  if (S.perfil.activo === false) return vistaSinPerfil(true);
  if (S.perfil.rol === 'inspector') return vistaInspector();
  const r = ruta();
  if (r.a === 'ot' && r.b) return r.c === 'cierre' ? vistaCierre(r.b) : vistaOt(r.b);
  if (r.a === 'sup' && esSup()) return vistaSupervisor(r.b || 'ots');
  if (esSup() && r.a === '') return navegar('#/sup/ots');
  return vistaMisOts();
}

window.addEventListener('hashchange', enrutar);
window.addEventListener('online', () => refrescarAvisos());
window.addEventListener('offline', () => refrescarAvisos());
function refrescarAvisos() {
  const el = app.querySelector('[data-avisos]');
  if (el) el.innerHTML = avisoConexion() + avisoInstalar();
}

// ---------------- Vistas: acceso ----------------

function vistaCargando(msg = 'Cargando…') {
  render(`<div class="centro"><div class="spinner" aria-hidden="true"></div><p>${esc(msg)}</p></div>`);
}

function vistaLogin(error = '') {
  render(`
  <div class="login">
    <div class="login-marca"><span class="marca-chica">EPEC · Redes de Alta Tensión</span><h1>Cuadrillas · OT</h1></div>
    <form class="tarjeta login-form" data-form="login" novalidate>
      <label>Usuario<input name="usuario" autocomplete="username" autocapitalize="none" spellcheck="false" required placeholder="ej.: rojo.g"></label>
      <label>Contraseña<input name="clave" type="password" autocomplete="current-password" required></label>
      ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
      <button class="btn btn-primario btn-grande" type="submit">Ingresar</button>
      <p class="nota">La primera vez necesitás señal para ingresar. Después la app funciona sin conexión.</p>
    </form>
    <p class="version">v${VERSION_APP}</p>
  </div>`);
}

function vistaInspector() {
  render(`
  <div class="centro">
    <h1>Usuario de inspección de poda</h1>
    <p>Este usuario es para la app de certificación de poda, no para las OT de cuadrillas.</p>
    <button class="btn" data-accion="salir">${icono.salir} Salir</button>
  </div>`);
}

function vistaSinPerfil(inactivo = false) {
  render(`
  <div class="centro">
    <h1>${inactivo ? 'Usuario desactivado' : 'Usuario sin permisos'}</h1>
    <p>${inactivo ? 'Tu usuario fue desactivado.' : 'Tu usuario todavía no tiene una cuadrilla asignada.'} Pedile al supervisor que lo revise.</p>
    <button class="btn" data-accion="salir">${icono.salir} Salir</button>
  </div>`);
}

// ---------------- Vistas: cuadrilla ----------------

function encabezado({ titulo, sub = '', volver = '', extra = '' }) {
  return `
  <header class="barra">
    ${volver ? `<a class="btn-icono" href="${volver}" aria-label="Volver">${icono.volver}</a>` : ''}
    <div class="barra-titulo">${sub ? `<span class="barra-sub">${esc(sub)}</span>` : ''}<strong>${esc(titulo)}</strong></div>
    ${extra}
  </header>`;
}

function chipsJornadas(ot) {
  const js = jornadasDeOT(ot.marcas, S.config.colores);
  const cuenta = {};
  Object.values(ot.marcas || {}).forEach(m => { if (m) cuenta[m.fecha] = (cuenta[m.fecha] || 0) + 1; });
  return js.map(j => `<span class="chip-j"><span class="cuadro" style="background:${esc(j.color)}"></span>${fechaAR(j.fecha).slice(0, 5)} · ${cuenta[j.fecha] || 0}</span>`).join('');
}

function barraAvance(ot) {
  const { total } = avanceOT(ot);
  const js = jornadasDeOT(ot.marcas, S.config.colores);
  const cuenta = {};
  Object.values(ot.marcas || {}).forEach(m => { if (m && estadoMarca(m) === 'realizado') cuenta[m.fecha] = (cuenta[m.fecha] || 0) + 1; });
  return `<div class="avance" aria-hidden="true">${js.map(j => `<span style="width:${total ? (cuenta[j.fecha] || 0) / total * 100 : 0}%;background:${esc(j.color)}"></span>`).join('')}</div>`;
}

function vistaMisOts() {
  const p = S.perfil;
  const pintar = (ots, cargando = false) => {
    const abiertas = (ots || []).filter(o => o.estado !== 'cerrada');
    render(`
    <div class="pantalla">
      ${encabezado({
        titulo: 'Mis órdenes de trabajo',
        sub: p.cuadrilla ? `${p.cuadrilla} · ${p.nombre || ''}` : (p.nombre || ''),
        extra: `${esSup() ? '<a class="btn-icono texto" href="#/sup/ots">Panel</a>' : ''}<button class="btn-icono" data-accion="salir" aria-label="Salir">${icono.salir}</button>`
      })}
      <div data-avisos>${avisoConexion()}${avisoInstalar()}</div>
      <main class="scroll contenido">
        ${cargando ? '<p class="nota">Cargando órdenes…</p>' : ''}
        ${!cargando && !abiertas.length ? '<div class="vacio"><strong>No tenés órdenes asignadas</strong><span>Cuando el supervisor emita una OT para tu cuadrilla, aparece acá.</span></div>' : ''}
        ${abiertas.map(ot => {
          const a = avanceOT(ot);
          return `
          <a class="tarjeta tarjeta-ot" href="#/ot/${esc(ot.id)}">
            <div class="fila-esp"><span class="mono verde">OT ${esc(ot.nro)}</span><span class="estado ${a.hechos || a.enProceso ? 'estado-curso' : ''}">${a.hechos || a.enProceso ? 'En curso' : 'Sin empezar'}</span></div>
            <strong class="tarjeta-titulo">${esc(ot.linea)}</strong>
            <span class="gris">${ot.codigoLinea ? `Línea ${esc(ot.codigoLinea)} · ` : ''}Emitida ${fechaAR(ot.fechaEmision)}</span>
            <div class="fila-esp chico"><span>${a.hechos} de ${a.total} realizados${a.enProceso ? ` · ${a.enProceso} en proceso` : ''}</span><span class="gris">${a.pct}%</span></div>
            ${a.prioPendientes ? `<span class="marca-prio">${icono.bandera}${a.prioPendientes} prioritario${a.prioPendientes > 1 ? 's' : ''} sin terminar</span>` : ''}
            ${barraAvance(ot)}
            <div class="chips">${chipsJornadas(ot)}</div>
          </a>`;
        }).join('')}
      </main>
    </div>`);
  };
  pintar([], true);
  if (!p.cuadrilla && !esSup()) return;
  let llego = false;
  const recibir = ots => { llego = true; pintar(ots); };
  const un = esSup()
    ? db.escucharTodasLasOts(recibir, errorDeCarga)
    : db.escucharOtsDeCuadrilla(p.cuadrilla, recibir, errorDeCarga);
  S.subs.push(un);
  const t = setTimeout(() => {
    if (llego) return;
    const m = app.querySelector('main');
    if (m) m.insertAdjacentHTML('beforeend', `<div class="aviso aviso-ambar"><div><strong>Está tardando más de lo normal</strong><span>Si no carga, tocá Reintentar.</span></div><button class="btn btn-chico" data-accion="reiniciar">Reintentar</button></div>`);
  }, 10000);
  S.subs.push(() => clearTimeout(t));
}

function errorDeCarga(err) {
  console.error(err);
  const m = app.querySelector('main') || app;
  m.insertAdjacentHTML('afterbegin', `<div class="aviso aviso-rojo"><div><strong>No se pudieron cargar los datos</strong><span>${esc(err && err.message || err)}</span></div><button class="btn btn-chico" data-accion="reiniciar">Reintentar</button></div>`);
}

function vistaOt(id) {
  vistaCargando('Abriendo la OT…');
  const un = db.escucharOt(id, (ot, meta) => {
    if (!ot) { render(`<div class="centro"><h1>OT no encontrada</h1><a class="btn" href="#/">Volver</a></div>`); return; }
    S.ot = ot; S.otMeta = meta;
    if (!meta.pendiente && !meta.desdeCache) pend.limpiar(id);
    conservarScroll(pintarOt);
  }, err => {
    render(`<div class="centro"><h1>No se pudo abrir la OT</h1><p>${esc(err.message)}</p><a class="btn" href="#/">Volver</a></div>`);
  });
  S.subs.push(un);
}

function datosHoy(ot) {
  const hoy = hoyISO();
  const js = jornadasDeOT(ot.marcas, S.config.colores, hoy);
  return { hoy, js, jHoy: jornadaDeFecha(js, hoy) };
}

function pintarOt() {
  const ot = S.ot;
  const { hoy, jHoy } = datosHoy(ot);
  const jsReales = jornadasDeOT(ot.marcas, S.config.colores);
  const colorDe = Object.fromEntries(jsReales.map(j => [j.fecha, j.color]));
  const marcas = ot.marcas || {};
  const prio = ot.prioritarios || {};
  const cerrada = ot.estado === 'cerrada';
  const hechosHoy = Object.values(marcas).filter(m => m && m.fecha === hoy && estadoMarca(m) === 'realizado').length;
  const procesoHoy = Object.values(marcas).filter(m => m && m.fecha === hoy && estadoMarca(m) === 'proceso').length;
  const pendientes = pend.leer(ot.id).length;
  const av = avanceOT(ot);
  const f = S.filtro;
  const pasa = it => {
    const e = estadoMarca(marcas[it.rid]);
    return f === 'todos' || (f === 'prio' && prio[it.rid]) || (f === 'pend' && e === 'pendiente') ||
      (f === 'proceso' && e === 'proceso') || (f === 'hechos' && e === 'realizado');
  };
  const grupos = agruparPorCategoria(ot.items).map(g => ({
    ...g,
    // dentro de cada categoría, los prioritarios primero
    items: g.items.filter(pasa).sort((x, y) => (prio[y.rid] ? 1 : 0) - (prio[x.rid] ? 1 : 0))
  })).filter(g => g.items.length);

  const filtros = [['todos', 'Todos'], ['prio', `Prioritarios${av.prioPendientes ? ' · ' + av.prioPendientes : ''}`], ['pend', 'Pendientes'], ['proceso', 'En proceso'], ['hechos', 'Realizados']];
  render(`
  <div class="pantalla">
    ${encabezado({ titulo: ot.linea, sub: `OT ${ot.nro}${ot.codigoLinea ? ' · ' + ot.codigoLinea : ''}`, volver: esSup() ? '#/sup/ots' : '#/' })}
    <div class="jornada-hoy">
      ${cerrada
        ? '<div class="aviso aviso-gris"><div><strong>OT cerrada</strong><span>Solo se puede consultar.</span></div></div>'
        : jHoy && !jHoy.excedida
          ? `<span class="cuadro grande" style="background:${esc(jHoy.color)}"></span><div><strong>Jornada ${jHoy.n} · hoy ${fechaAR(hoy)}</strong><span class="gris">Lo que marques hoy se tacha en este color</span></div>`
          : `<div class="aviso aviso-rojo"><div><strong>La OT ya tiene ${MAX_JORNADAS} fechas de ejecución</strong><span>No entran más fechas en el formulario. Pedile al supervisor una OT nueva.</span></div></div>`}
    </div>
    ${av.prioPendientes && !cerrada ? `<button class="aviso aviso-prio" data-accion="filtro" data-valor="prio">${icono.bandera}<div><strong>${av.prioPendientes} trabajo${av.prioPendientes > 1 ? 's' : ''} prioritario${av.prioPendientes > 1 ? 's' : ''} sin terminar</strong><span>Hacelos primero. Tocá para verlos.</span></div></button>` : ''}
    <div data-avisos>${avisoConexion()}</div>
    <nav class="filtros" aria-label="Filtro">
      ${filtros.map(([k, t]) => `<button class="pill ${f === k ? 'activo' : ''}" data-accion="filtro" data-valor="${k}" aria-pressed="${f === k}">${t}</button>`).join('')}
    </nav>
    <main class="scroll contenido">
      ${grupos.length ? '' : '<p class="nota">No hay trabajos en este filtro.</p>'}
      ${grupos.map(g => `
        <section class="grupo">
          <h2>${esc(g.nombre)} · ${g.items.length}</h2>
          <div class="grilla">
            ${g.items.map(it => {
              const m = marcas[it.rid];
              const e = estadoMarca(m);
              const color = m ? colorDe[m.fecha] : '';
              const esPrio = !!prio[it.rid];
              const textoEstado = e === 'realizado' ? 'realizado el ' + fechaAR(m.fecha) : e === 'proceso' ? 'en proceso desde el ' + fechaAR(m.fecha) : 'pendiente';
              return `<button class="celda ${esPrio ? 'celda-prio' : ''} ${e === 'proceso' ? 'celda-proceso' : ''}" style="--fp:${fondoPrioridad(it.prio)};--c:${esc(color || 'transparent')}" data-accion="abrir" data-rid="${esc(it.rid)}"
                aria-label="${esc(it.pq)}, ${esc(it.txt)}, ${esPrio ? 'prioritario, ' : ''}${textoEstado}">
                ${esPrio ? `<span class="marca-prio">${icono.bandera}Prioritario</span>` : ''}
                <strong>${esc(it.pq)}</strong><span>${esc(it.txt)}</span>
                ${e === 'proceso' ? '<span class="marca-proceso">En proceso</span>' : ''}
                ${e === 'realizado' ? '<i class="tachado" aria-hidden="true"></i>' : ''}
                ${e === 'proceso' ? '<i class="tachado-medio" aria-hidden="true"></i>' : ''}
              </button>`;
            }).join('')}
          </div>
        </section>`).join('')}
    </main>
    <footer class="pie">
      <div class="pie-texto"><strong>${hechosHoy} realizado${hechosHoy === 1 ? '' : 's'} hoy${procesoHoy ? ` · ${procesoHoy} en proceso` : ''}</strong>
        <span class="${pendientes ? 'ambar' : 'verde'}">${pendientes ? `${pendientes} sin enviar · se envían al volver la señal` : (S.otMeta && S.otMeta.desdeCache && !navigator.onLine ? 'Sin señal · nada pendiente' : 'Todo enviado')}</span></div>
      <a class="btn btn-primario" href="#/ot/${esc(ot.id)}/cierre">Cerrar jornada</a>
    </footer>
    ${S.seleccion ? hojaDetalle(ot, S.seleccion, { hoy, jHoy, cerrada }) : ''}
  </div>`);
}

function hojaDetalle(ot, rid, { hoy, jHoy, cerrada }) {
  const it = (ot.items || []).find(x => x.rid === rid);
  if (!it) return '';
  const m = (ot.marcas || {})[rid];
  const e = estadoMarca(m);
  const esPrio = !!(ot.prioritarios || {})[rid];
  const hayJornada = jHoy && !jHoy.excedida;
  const puedeRealizar = !cerrada && hayJornada && e !== 'realizado';
  const puedeProceso = !cerrada && hayJornada && e === 'pendiente';
  const puedeDeshacer = !cerrada && m && (m.fecha === hoy || esSup());
  const coord = String(it.coord || '').replace(/\s/g, '');

  if (S.modoProceso && puedeProceso) {
    return `
    <div class="velo" data-accion="cerrar-hoja">
      <div class="hoja" role="dialog" aria-modal="true" aria-label="Marcar en proceso" data-accion="nada">
        <div><span class="etiqueta">Marcar en proceso</span><strong class="hoja-pq">${esc(it.pq)}</strong></div>
        <p class="gris">¿Por qué no se pudo terminar?</p>
        <div class="chips-motivo">${MOTIVOS_PROCESO.map(mo => `<button class="pill" data-accion="motivo" data-valor="${esc(mo)}">${esc(mo)}</button>`).join('')}</div>
        <label>Motivo<textarea rows="2" data-motivo placeholder="Ej.: falta grúa alta para la copa del álamo">${esc(S.motivo || '')}</textarea></label>
        <button class="btn btn-proceso btn-grande" data-accion="confirmar-proceso" data-rid="${esc(rid)}">Guardar como en proceso</button>
        <button class="btn btn-secundario" data-accion="cancelar-proceso">Volver</button>
      </div>
    </div>`;
  }

  return `
  <div class="velo" data-accion="cerrar-hoja">
    <div class="hoja" role="dialog" aria-modal="true" aria-label="Detalle del trabajo" data-accion="nada">
      <div class="fila-esp arriba">
        <div><span class="etiqueta">${esc(it.fila || categoriaOT(it.categoria))} · piquete</span><strong class="hoja-pq">${esc(it.pq)}</strong></div>
        <span class="prio" style="background:${fondoPrioridad(it.prio)}">${esc(it.prio && it.prio !== 'N/A' ? it.prio : 'Sin color')}</span>
      </div>
      ${esPrio ? `<p class="marca-prio grande">${icono.bandera}Trabajo prioritario</p>` : ''}
      <p class="hoja-texto">${esc(it.txt)}</p>
      ${e === 'proceso' ? `<div class="aviso aviso-proceso"><div><strong>En proceso desde el ${fechaAR(m.fecha)}</strong><span>${esc(m.motivo || '')}${m.nombre ? ' · ' + esc(m.nombre) : ''}</span></div></div>` : ''}
      ${e === 'realizado' ? `<p class="${m.fecha === hoy ? 'verde' : 'gris'} negrita">Realizado el ${fechaAR(m.fecha)}${m.nombre ? ' · ' + esc(m.nombre) : ''}</p>${m.proceso ? `<p class="gris chico">Estuvo en proceso el ${fechaAR(m.proceso.fecha)}: ${esc(m.proceso.motivo || '')}</p>` : ''}` : ''}
      ${puedeRealizar ? `<button class="btn btn-primario btn-grande" data-accion="marcar" data-rid="${esc(rid)}"><span class="cuadro" style="background:${esc(jHoy.color)}"></span>${e === 'proceso' ? 'Terminado hoy' : 'Marcar realizado hoy'}</button>` : ''}
      ${puedeProceso ? `<button class="btn btn-proceso btn-grande" data-accion="proceso" data-rid="${esc(rid)}">Quedó en proceso (a medias)</button>` : ''}
      ${puedeDeshacer ? `<button class="btn btn-peligro btn-grande" data-accion="desmarcar" data-rid="${esc(rid)}">${m.fecha === hoy ? 'Deshacer' : 'Quitar marca (supervisor)'}</button>` : ''}
      ${m && !puedeDeshacer && !cerrada && e === 'realizado' ? '<p class="gris">Es de una jornada anterior. Solo el supervisor puede corregirlo.</p>' : ''}
      ${esSup() && !cerrada ? `<button class="btn btn-secundario" data-accion="prioritario" data-rid="${esc(rid)}" data-valor="${esPrio ? '0' : '1'}">${icono.bandera}${esPrio ? 'Quitar prioridad' : 'Marcar como prioritario'}</button>` : ''}
      ${coord ? `<a class="btn btn-secundario" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coord)}" target="_blank" rel="noopener">Ver ubicación del piquete</a>` : ''}
      <button class="btn btn-secundario" data-accion="cerrar-hoja">Cerrar</button>
    </div>
  </div>`;
}

function vistaCierre(id) {
  vistaCargando();
  const un = db.escucharOt(id, (ot, meta) => {
    if (!ot) return navegar('#/');
    S.ot = ot; S.otMeta = meta;
    if (!meta.pendiente && !meta.desdeCache) pend.limpiar(id);
    if (app.querySelector('[data-vista="cierre"]')) actualizarCierre();
    else pintarCierre();
  }, err => errorDeCarga(err));
  S.subs.push(un);
}

function zonaListaCierre(ot, hoy) {
  const marcas = ot.marcas || {};
  const deHoy = (ot.items || []).filter(it => marcas[it.rid] && marcas[it.rid].fecha === hoy);
  return `<ul class="lista">${deHoy.map(it => {
    const m = marcas[it.rid];
    return estadoMarca(m) === 'proceso'
      ? `<li class="li-proceso"><strong>${esc(it.pq)}</strong><span><b>En proceso:</b> ${esc(m.motivo || '')}</span></li>`
      : `<li><strong>${esc(it.pq)}</strong><span class="gris">${esc(it.txt)}</span></li>`;
  }).join('') || '<li class="gris">Todavía no marcaste trabajos hoy.</li>'}</ul>`;
}

function zonaEnvioCierre(ot) {
  const pendientes = pend.leer(ot.id).length;
  return pendientes
    ? `<div class="aviso aviso-ambar" role="status">${icono.sinSenal}<div><strong>${pendientes} cambio${pendientes > 1 ? 's' : ''} todavía sin enviar</strong><span>Están guardados en el teléfono. Mantené la app abierta en un lugar con señal y se envían solos.</span></div></div>`
    : `<div class="aviso aviso-verde" role="status">${icono.ok}<div><strong>Todo enviado</strong><span>La OT está actualizada para el supervisor.</span></div></div>`;
}

function actualizarCierre() {
  const ot = S.ot; const hoy = hoyISO();
  const l = app.querySelector('[data-zona="lista"]'); if (l) l.innerHTML = zonaListaCierre(ot, hoy);
  const e = app.querySelector('[data-zona="envio"]'); if (e) e.innerHTML = zonaEnvioCierre(ot);
}

function pintarCierre() {
  const ot = S.ot;
  const { hoy, jHoy } = datosHoy(ot);
  const nHoy = Object.values(ot.marcas || {}).filter(m => m && m.fecha === hoy && estadoMarca(m) === 'realizado').length;
  render(`
  <div class="pantalla" data-vista="cierre">
    ${encabezado({ titulo: 'Cierre de jornada', sub: `OT ${ot.nro}`, volver: `#/ot/${esc(ot.id)}` })}
    <main class="scroll contenido">
      <section class="tarjeta">
        <div class="fila"><span class="cuadro grande" style="background:${esc(jHoy ? jHoy.color : '#999')}"></span>
          <div><strong class="tarjeta-titulo">Jornada ${jHoy ? jHoy.n : '-'} · ${fechaAR(hoy)}</strong><span class="gris">${nHoy} trabajo${nHoy === 1 ? '' : 's'} realizado${nHoy === 1 ? '' : 's'} hoy</span></div></div>
        <div data-zona="lista">${zonaListaCierre(ot, hoy)}</div>
        <label>Observaciones de la jornada (opcional)
          <textarea name="obs" rows="3" data-escribir="obs" placeholder="Ej.: 220RT-224 sin acceso por camino anegado">${esc((ot.obsJornadas || {})[hoy] || '')}</textarea>
        </label>
        <span class="nota" data-zona="obs-estado"></span>
      </section>
      <div data-zona="envio">${zonaEnvioCierre(ot)}</div>
      ${esSup() ? `<button class="btn btn-secundario btn-grande" data-accion="pdf" data-id="${esc(ot.id)}">Descargar PDF de la OT</button>` : ''}
      <a class="btn btn-primario btn-grande" href="#/">Terminar</a>
    </main>
  </div>`);
}

// ---------------- Vistas: supervisor ----------------

function vistaSupervisor(seccion) {
  const secciones = [['ots', 'OT emitidas'], ['emitir', 'Emitir OT'], ['usuarios', 'Usuarios'], ['colores', 'Colores']];
  render(`
  <div class="panel">
    <nav class="panel-nav" aria-label="Secciones">
      <span class="marca-chica">Cuadrillas · OT</span>
      ${secciones.map(([k, t]) => `<a href="#/sup/${k}" ${k === seccion ? 'aria-current="page"' : ''}>${t}</a>`).join('')}
      <a href="#/mis">Vista cuadrilla</a>
      <button class="panel-salir" data-accion="salir">${icono.salir} Salir</button>
    </nav>
    <main class="panel-main" id="panel-main"><p class="nota">Cargando…</p></main>
  </div>`);
  if (seccion === 'emitir') return supEmitir();
  if (seccion === 'usuarios') return supUsuarios();
  if (seccion === 'colores') return supColores();
  return supOts();
}

const panelMain = html => { const m = document.getElementById('panel-main'); if (m) m.innerHTML = html; };

function supOts() {
  const un = db.escucharTodasLasOts(ots => {
    const abiertas = ots.filter(o => o.estado !== 'cerrada');
    const cerradas = ots.filter(o => o.estado === 'cerrada');
    const fila = ot => {
      const a = avanceOT(ot);
      return `<tr>
        <td class="mono negrita">${esc(ot.nro)}</td>
        <td>${esc(ot.linea)}</td>
        <td>${esc(ot.cuadrilla)}</td>
        <td>${fechaAR(ot.fechaEmision)}</td>
        <td><div class="fila-chica">${a.hechos}/${a.total} ${barraAvance(ot)}</div><div class="chips">${chipsJornadas(ot)}</div></td>
        <td class="acciones">
          <a class="btn btn-chico" href="#/ot/${esc(ot.id)}">Abrir</a>
          <button class="btn btn-chico" data-accion="pdf" data-id="${esc(ot.id)}">PDF</button>
          ${ot.estado === 'cerrada'
            ? `<button class="btn btn-chico" data-accion="estado-ot" data-id="${esc(ot.id)}" data-valor="abierta">Reabrir</button>`
            : `<button class="btn btn-chico" data-accion="estado-ot" data-id="${esc(ot.id)}" data-valor="cerrada">Cerrar</button>`}
        </td></tr>`;
    };
    const tabla = (lista) => `<div class="tabla-caja"><table class="tabla">
      <thead><tr><th>Nro.</th><th>Línea</th><th>Cuadrilla</th><th>Emitida</th><th>Avance</th><th><span class="sr">Acciones</span></th></tr></thead>
      <tbody>${lista.map(fila).join('')}</tbody></table></div>`;
    S.listaOts = ots;
    panelMain(`
      <div class="panel-cab"><h1>Órdenes de trabajo</h1><a class="btn btn-primario" href="#/sup/emitir">Emitir OT</a></div>
      <h2>Abiertas (${abiertas.length})</h2>
      ${abiertas.length ? tabla(abiertas) : '<p class="nota">No hay OT abiertas.</p>'}
      <h2>Cerradas (${cerradas.length})</h2>
      ${cerradas.length ? tabla(cerradas) : '<p class="nota">Todavía no hay OT cerradas.</p>'}`);
  }, err => panelMain(`<p class="error">No se pudieron leer las OT: ${esc(err.message)}</p>`));
  S.subs.push(un);
}

async function supEmitir(recargar = false) {
  if (!S.reclamos || recargar) {
    panelMain('<p class="nota">Leyendo reclamos pendientes…</p>');
    try {
      S.reclamos = await db.reclamosPendientes();
    } catch (e) {
      panelMain(`<p class="error">No se pudieron leer los reclamos: ${esc(e.message)}</p>`);
      return;
    }
  }
  if (!S.usuarios) { try { S.usuarios = await db.listarUsuarios(); } catch (_) { S.usuarios = []; } }
  pintarEmitir();
}

function pintarEmitir() {
  const porLinea = {};
  for (const r of S.reclamos) (porLinea[r.linea] = porLinea[r.linea] || []).push(r);
  const lineas = Object.keys(porLinea).sort((a, b) => a.localeCompare(b, 'es'));
  if (!S.lineaElegida || !porLinea[S.lineaElegida]) S.lineaElegida = lineas[0] || '';
  const orden = Object.fromEntries(CATEGORIAS_OT.map((c, i) => [c, i]));
  const lista = (porLinea[S.lineaElegida] || []).slice().sort((a, b) =>
    (orden[categoriaOT(a.categoria)] - orden[categoriaOT(b.categoria)]) || compararPiquetes(a.piquete, b.piquete));
  if (!S.elegidos || S.elegidosLinea !== S.lineaElegida) {
    S.elegidos = new Set(lista.filter(r => !r.otNro).map(r => r.id));
    S.prioritarios = new Set();
    S.elegidosLinea = S.lineaElegida;
  }
  const cuadrillas = [...new Set((S.usuarios || []).map(u => u.cuadrilla).filter(Boolean))];
  const { nro, secuencia } = db.proximoNroOT(S.config.ultimaSecuencia);
  S.secuenciaSugerida = secuencia;
  const ultimo = lista.slice().sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))[0];
  const relevo = ultimo ? `${ultimo.responsable || ''} (${ultimo.fecha || ''})` : '';

  panelMain(`
    <div class="panel-cab"><div><h1>Emitir orden de trabajo</h1><p class="gris">Elegí la línea, revisá los reclamos pendientes y ajustá el texto que va a la OT.</p></div>
      <button class="btn" data-accion="recargar-reclamos">Actualizar reclamos</button></div>
    <div class="dos-col">
      <section class="tarjeta ancha">
        <label>Línea
          <select data-cambio="linea">${lineas.map(l => `<option ${l === S.lineaElegida ? 'selected' : ''} value="${esc(l)}">${esc(l)} (${porLinea[l].length})</option>`).join('')}</select>
        </label>
        ${lista.length ? `
        <div class="tabla-caja"><table class="tabla">
          <thead><tr><th><input type="checkbox" data-cambio="todos" aria-label="Incluir todos" ${lista.every(r => S.elegidos.has(r.id)) ? 'checked' : ''}></th><th>Piquete</th><th>Categoría</th><th>Prioridad</th><th title="La cuadrilla lo ve destacado para hacerlo primero">Prioritario</th><th>Observación del relevamiento</th><th>Texto en la OT</th></tr></thead>
          <tbody>${lista.map(r => `<tr>
            <td><input type="checkbox" data-cambio="elegir" data-rid="${esc(r.id)}" aria-label="Incluir ${esc(r.piquete)}" ${S.elegidos.has(r.id) ? 'checked' : ''}></td>
            <td class="mono negrita">${esc(r.piquete)}${r.otNro ? `<br><span class="etiqueta-ot">En OT ${esc(r.otNro)}</span>` : ''}${r.estado === 'En proceso' ? `<br><span class="etiqueta-proceso">En proceso</span>` : ''}</td>
            <td>${esc(r.categoria)}</td>
            <td><span class="prio" style="background:${fondoPrioridad(r.prioridad)}">${esc(r.prioridad || '-')}</span></td>
            <td class="centrado"><input type="checkbox" class="check-prio" data-cambio="prio" data-rid="${esc(r.id)}" aria-label="Prioritario ${esc(r.piquete)}" ${S.prioritarios.has(r.id) ? 'checked' : ''}></td>
            <td class="gris">${esc(r.observacion)}<br><span class="chico">${esc(r.fecha)} · ${esc(r.responsable)}</span></td>
            <td><input class="texto-ot" data-cambio="texto" data-rid="${esc(r.id)}" value="${esc(r.textoOT || textoInicialOT(r.categoria, r.observacion))}" aria-label="Texto en la OT para ${esc(r.piquete)}"></td>
          </tr>`).join('')}</tbody></table></div>
        <p class="nota">El texto editado se guarda solo. La observación original del relevamiento no se modifica.</p>`
        : '<p class="nota">No hay reclamos pendientes.</p>'}
      </section>
      <form class="tarjeta lateral" data-form="emitir">
        <h2>Nueva OT</h2>
        <p class="fila-esp"><span class="gris">Trabajos incluidos</span><strong data-elegidos>${S.elegidos.size}</strong></p>
        <p class="fila-esp"><span class="gris">Prioritarios</span><strong data-prioritarios>${S.prioritarios.size}</strong></p>
        <label>Número de OT<input name="nro" required value="${esc(nro)}" class="mono"></label>
        <label>Código de línea<input name="codigo" value="${esc(S.config.codigosLinea[S.lineaElegida] || '')}" placeholder="ej.: 66FP17" class="mono"></label>
        <label>Cuadrilla<input name="cuadrilla" required list="lista-cuadrillas" placeholder="ej.: RAT TcT/TsT"></label>
        <datalist id="lista-cuadrillas">${cuadrillas.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
        <label>Encargado 1<input name="enc1"></label>
        <label>Encargado 2<input name="enc2"></label>
        <label>Relevó<input name="relevo" value="${esc(relevo)}"></label>
        <label>Observación / pendientes<textarea name="obs" rows="2"></textarea></label>
        <button class="btn btn-primario btn-grande" type="submit">Emitir y enviar a la cuadrilla</button>
      </form>
    </div>`);
}

async function supUsuarios() {
  try { S.usuarios = await db.listarUsuarios(); } catch (e) { panelMain(`<p class="error">${esc(e.message)}</p>`); return; }
  const cuadrillas = [...new Set(S.usuarios.map(u => u.cuadrilla).filter(Boolean))];
  panelMain(`
    <div class="panel-cab"><h1>Usuarios</h1></div>
    <div class="dos-col">
      <section class="tarjeta ancha">
        ${S.usuarios.length ? `<div class="tabla-caja"><table class="tabla">
          <thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Cuadrilla</th><th>Estado</th></tr></thead>
          <tbody>${S.usuarios.map(u => `<tr>
            <td class="negrita">${esc(u.nombre)}</td><td class="mono">${esc(u.usuario)}</td>
            <td>${u.rol === 'supervisor' ? 'Supervisor' : u.rol === 'inspector' ? 'Inspector de poda' : 'Operario'}</td><td>${esc(u.cuadrilla)}</td>
            <td><button class="btn btn-chico" data-accion="activo" data-uid="${esc(u.id)}" data-valor="${u.activo === false ? '1' : '0'}">${u.activo === false ? 'Reactivar' : 'Desactivar'}</button></td>
          </tr>`).join('')}</tbody></table></div>` : '<p class="nota">Todavía no hay usuarios. Creá el primero con el formulario.</p>'}
      </section>
      <form class="tarjeta lateral" data-form="usuario">
        <h2>Nuevo usuario</h2>
        <label>Nombre y apellido<input name="nombre" required placeholder="ej.: Gustavo Rojo"></label>
        <label>Usuario (para ingresar)<input name="usuario" required autocapitalize="none" spellcheck="false" placeholder="ej.: rojo.g" pattern="[a-z0-9._-]+"></label>
        <label>Contraseña (mínimo 6 caracteres)<input name="clave" required minlength="6"></label>
        <label>Rol<select name="rol"><option value="operario">Operario</option><option value="supervisor">Supervisor</option><option value="inspector">Inspector de poda</option></select></label>
        <label>Cuadrilla<input name="cuadrilla" list="lista-cuadrillas2" placeholder="ej.: RAT TcT/TsT"></label>
        <datalist id="lista-cuadrillas2">${cuadrillas.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
        <button class="btn btn-primario btn-grande" type="submit">Crear usuario</button>
        <p class="nota">El operario ingresa con el usuario y la contraseña. Anotáselos: la contraseña no se puede volver a ver.</p>
      </form>
    </div>`);
}

function supColores() {
  const cs = S.config.colores;
  panelMain(`
    <div class="panel-cab"><h1>Colores por jornada</h1></div>
    <form class="tarjeta angosta" data-form="colores">
      <p class="gris">Cada fecha de ejecución de una OT se tacha con un color: la primera jornada con el 1, la segunda con el 2, y así hasta 5.</p>
      ${[0, 1, 2, 3, 4].map(i => `<label class="fila-color">Jornada ${i + 1}<input type="color" name="c${i}" value="${esc(cs[i] || COLORES_DEFECTO[i])}"></label>`).join('')}
      <button class="btn btn-primario" type="submit">Guardar colores</button>
      <p class="nota">Cambiar un color modifica también el tachado de las OT ya emitidas.</p>
    </form>`);
}

// ---------------- Acciones ----------------

async function descargarPdf(id) {
  if (!esSup()) return toast('El PDF solo lo puede descargar el supervisor.', 'error');
  const ot = (S.ot && S.ot.id === id) ? S.ot : (S.listaOts || []).find(o => o.id === id);
  if (!ot) return toast('No se encontró la OT', 'error');
  try {
    toast('Generando PDF…');
    const { generarPdfOT } = await import('./pdf.js');
    const bytes = await generarPdfOT(ot, S.config.colores);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `OT ${ot.nro} - ${ot.linea}.pdf`.replace(/[\\/:*?"<>|]/g, '-');
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    console.error(e);
    toast('No se pudo generar el PDF. Si no hay señal y es la primera vez, probá con conexión.', 'error');
  }
}

app.addEventListener('click', async e => {
  const el = e.target.closest('[data-accion]');
  if (!el) return;
  const acc = el.dataset.accion;
  if (acc === 'nada') { e.stopPropagation(); return; }
  if (acc === 'cerrar-hoja') {
    if (e.target.closest('.hoja') && el.classList.contains('velo')) return;
    S.seleccion = null; S.modoProceso = false; conservarScroll(pintarOt); return;
  }
  if (acc === 'proceso') { S.modoProceso = true; S.motivo = ''; conservarScroll(pintarOt); return; }
  if (acc === 'cancelar-proceso') { S.modoProceso = false; conservarScroll(pintarOt); return; }
  if (acc === 'motivo') {
    const ta = app.querySelector('[data-motivo]');
    if (ta) { ta.value = el.dataset.valor; S.motivo = ta.value; ta.focus(); }
    return;
  }
  if (acc === 'confirmar-proceso') {
    const ta = app.querySelector('[data-motivo]');
    const motivo = (ta ? ta.value : S.motivo || '').trim();
    if (!motivo) { toast('Escribí o elegí el motivo.', 'error'); return; }
    const ot = S.ot; const it = ot.items.find(x => x.rid === el.dataset.rid);
    S.seleccion = null; S.modoProceso = false; S.motivo = '';
    pend.agregar(ot.id, it.rid);
    db.marcarEnProceso(ot, it, hoyISO(), motivo, S.perfil)
      .catch(err => { pend.limpiar(ot.id); toast('No se pudo guardar: ' + err.message, 'error'); });
    conservarScroll(pintarOt);
    return;
  }
  if (acc === 'prioritario') {
    const valor = el.dataset.valor === '1';
    db.cambiarPrioritario(S.ot.id, el.dataset.rid, valor)
      .then(() => toast(valor ? 'Marcado como prioritario' : 'Prioridad quitada', 'ok'))
      .catch(err => toast(err.message, 'error'));
    S.seleccion = null; conservarScroll(pintarOt);
    return;
  }
  if (acc === 'reiniciar') { location.reload(); return; }
  if (acc === 'salir') { limpiarSubs(); await db.salir(); location.hash = '#/'; return; }
  if (acc === 'instalar' && S.instalar) { S.instalar.prompt(); S.instalar = null; refrescarAvisos(); return; }
  if (acc === 'filtro') { S.filtro = el.dataset.valor; conservarScroll(pintarOt); return; }
  if (acc === 'abrir') { S.seleccion = el.dataset.rid; S.modoProceso = false; conservarScroll(pintarOt); return; }
  if (acc === 'marcar' || acc === 'desmarcar') {
    const ot = S.ot; const it = ot.items.find(x => x.rid === el.dataset.rid);
    const hoy = hoyISO();
    S.seleccion = null;
    pend.agregar(ot.id, it.rid);
    const p = acc === 'marcar' ? db.marcarRealizado(ot, it, hoy, S.perfil) : db.desmarcar(ot, it);
    p.then(() => { /* el listener actualiza la vista */ })
      .catch(err => { pend.limpiar(ot.id); toast('No se pudo guardar: ' + err.message, 'error'); });
    conservarScroll(pintarOt);
    if (acc === 'marcar' && navigator.vibrate) navigator.vibrate(30);
    return;
  }
  if (acc === 'pdf') return descargarPdf(el.dataset.id);
  if (acc === 'estado-ot') {
    const cerrar = el.dataset.valor === 'cerrada';
    if (cerrar && !confirm('¿Cerrar la OT? La cuadrilla ya no podrá marcar trabajos.')) return;
    try { await db.cambiarEstadoOt(el.dataset.id, el.dataset.valor); toast(cerrar ? 'OT cerrada' : 'OT reabierta', 'ok'); }
    catch (err) { toast(err.message, 'error'); }
    return;
  }
  if (acc === 'recargar-reclamos') { S.elegidos = null; return supEmitir(true); }
  if (acc === 'activo') {
    try { await db.actualizarUsuario(el.dataset.uid, { activo: el.dataset.valor === '1' }); supUsuarios(); }
    catch (err) { toast(err.message, 'error'); }
  }
});

app.addEventListener('change', async e => {
  const el = e.target.closest('[data-cambio]');
  if (!el) return;
  const c = el.dataset.cambio;
  if (c === 'linea') { S.lineaElegida = el.value; S.elegidos = null; pintarEmitir(); return; }
  if (c === 'elegir') {
    el.checked ? S.elegidos.add(el.dataset.rid) : S.elegidos.delete(el.dataset.rid);
    const n = app.querySelector('[data-elegidos]'); if (n) n.textContent = S.elegidos.size;
    return;
  }
  if (c === 'prio') {
    if (el.checked) {
      S.prioritarios.add(el.dataset.rid);
      // un prioritario siempre va incluido en la OT
      S.elegidos.add(el.dataset.rid);
      const cb = app.querySelector(`[data-cambio="elegir"][data-rid="${el.dataset.rid}"]`); if (cb) cb.checked = true;
    } else S.prioritarios.delete(el.dataset.rid);
    const n = app.querySelector('[data-prioritarios]'); if (n) n.textContent = S.prioritarios.size;
    const m = app.querySelector('[data-elegidos]'); if (m) m.textContent = S.elegidos.size;
    return;
  }
  if (c === 'todos') {
    app.querySelectorAll('[data-cambio="elegir"]').forEach(cb => {
      cb.checked = el.checked; el.checked ? S.elegidos.add(cb.dataset.rid) : S.elegidos.delete(cb.dataset.rid);
    });
    const n = app.querySelector('[data-elegidos]'); if (n) n.textContent = S.elegidos.size;
    return;
  }
  if (c === 'texto') {
    const r = S.reclamos.find(x => x.id === el.dataset.rid);
    const nuevo = el.value.trim();
    if (r && nuevo !== r.textoOT) {
      try { await db.guardarTextoOT(r.id, nuevo); r.textoOT = nuevo; el.classList.add('guardado'); setTimeout(() => el.classList.remove('guardado'), 1200); }
      catch (err) { toast('No se guardó el texto: ' + err.message, 'error'); }
    }
    return;
  }
});

let temporizadorObs = null;
app.addEventListener('input', e => {
  if (e.target.matches('[data-motivo]')) { S.motivo = e.target.value; return; }
  const el = e.target.closest('[data-escribir="obs"]');
  if (!el || !S.ot) return;
  const otId = S.ot.id, fecha = hoyISO(), texto = el.value.trim();
  const estado = app.querySelector('[data-zona="obs-estado"]');
  if (estado) estado.textContent = 'Guardando…';
  clearTimeout(temporizadorObs);
  temporizadorObs = setTimeout(() => {
    pend.agregar(otId, 'obs');
    db.guardarObservacionJornada(otId, fecha, texto).catch(err => toast(err.message, 'error'));
    const est = app.querySelector('[data-zona="obs-estado"]');
    if (est) est.textContent = 'Observación guardada';
    const env = app.querySelector('[data-zona="envio"]');
    if (env && S.ot && S.ot.id === otId) env.innerHTML = zonaEnvioCierre(S.ot);
  }, 700);
});

app.addEventListener('submit', async e => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  const d = Object.fromEntries(new FormData(f).entries());
  const boton = f.querySelector('[type="submit"]');
  const ocupado = v => { if (boton) { boton.disabled = v; } };

  if (f.dataset.form === 'login') {
    if (!d.usuario || !d.clave) return vistaLogin('Completá usuario y contraseña.');
    ocupado(true);
    try { await db.ingresar(d.usuario, d.clave); }
    catch (err) {
      const msg = /network|offline/i.test(err.code || err.message) ? 'Sin conexión. La primera vez necesitás señal para ingresar.'
        : 'Usuario o contraseña incorrectos.';
      vistaLogin(msg);
    }
    return;
  }

  if (f.dataset.form === 'emitir') {
    const elegidos = S.reclamos.filter(r => S.elegidos.has(r.id));
    if (!elegidos.length) return toast('Elegí al menos un reclamo.', 'error');
    if (!d.cuadrilla.trim()) return toast('Indicá la cuadrilla.', 'error');
    ocupado(true);
    try {
      const sec = secuenciaDeNro(d.nro) || S.secuenciaSugerida;
      await db.emitirOt({
        nro: d.nro.trim(), secuencia: sec, linea: S.lineaElegida, codigoLinea: d.codigo.trim(),
        cuadrilla: d.cuadrilla.trim(), encargados: [d.enc1.trim(), d.enc2.trim()],
        relevo: d.relevo.trim(), observacion: d.obs.trim(),
        prioritarios: [...S.prioritarios].filter(rid => S.elegidos.has(rid))
      }, elegidos, S.perfil);
      toast(`OT ${d.nro} emitida`, 'ok');
      elegidos.forEach(r => { r.otNro = d.nro.trim(); });
      S.elegidos = null;
      navegar('#/sup/ots');
    } catch (err) { toast('No se pudo emitir: ' + err.message, 'error'); ocupado(false); }
    return;
  }

  if (f.dataset.form === 'usuario') {
    if (!/^[a-z0-9._-]+$/.test(d.usuario.trim().toLowerCase())) return toast('El usuario solo puede tener letras minúsculas, números, punto, guion y guion bajo.', 'error');
    if (String(d.clave).length < 6) return toast('La contraseña debe tener al menos 6 caracteres.', 'error');
    if (d.rol === 'operario' && !d.cuadrilla.trim()) return toast('Un operario necesita una cuadrilla.', 'error');
    ocupado(true);
    try {
      await db.crearUsuario({ usuario: d.usuario.trim().toLowerCase(), clave: d.clave, nombre: d.nombre.trim(), rol: d.rol, cuadrilla: d.cuadrilla.trim() });
      toast(`Usuario ${d.usuario} creado`, 'ok');
      supUsuarios();
    } catch (err) {
      toast(err.code === 'auth/email-already-in-use' ? 'Ese usuario ya existe.' : 'No se pudo crear: ' + err.message, 'error');
      ocupado(false);
    }
    return;
  }

  if (f.dataset.form === 'colores') {
    const colores = [0, 1, 2, 3, 4].map(i => d['c' + i]);
    try { await db.guardarColores(colores); toast('Colores guardados', 'ok'); } catch (err) { toast(err.message, 'error'); }
  }
});

// ---------------- Arranque ----------------

function avisoReinicio(msg) {
  if (!/INTERNAL ASSERTION|Firestore|IndexedDB/i.test(String(msg))) return;
  if (document.querySelector('.aviso-reinicio')) return;
  document.body.insertAdjacentHTML('beforeend', `<div class="aviso aviso-rojo aviso-reinicio" role="alert"><div><strong>Hay que reiniciar la app</strong><span>Lo marcado está guardado en el teléfono.</span></div><button class="btn btn-chico" onclick="location.reload()">Reiniciar</button></div>`);
}
window.addEventListener('error', e => avisoReinicio(e.message));
window.addEventListener('unhandledrejection', e => avisoReinicio(e.reason && (e.reason.message || e.reason)));

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.instalar = e; refrescarAvisos(); });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW', err)));
}

vistaCargando();
let configSub = null;
db.alCambiarSesion(async user => {
  S.user = user;
  if (configSub) { configSub(); configSub = null; }
  if (!user) { S.perfil = null; return enrutar(); }
  vistaCargando('Cargando tu usuario…');
  S.perfil = await db.obtenerPerfil(user);
  configSub = db.escucharConfig(cfg => {
    const cambioColores = JSON.stringify(cfg.colores) !== JSON.stringify(S.config.colores);
    S.config = cfg;
    const r = ruta();
    if (cambioColores && S.ot && r.a === 'ot' && r.b === S.ot.id && r.c !== 'cierre') conservarScroll(pintarOt);
  });
  enrutar();
  // Precarga el generador de PDF para que funcione después sin señal
  if (navigator.onLine) setTimeout(() => import('./pdf.js').catch(() => {}), 4000);
});
