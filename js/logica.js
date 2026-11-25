// Lógica pura (sin Firebase ni DOM): categorías, jornadas, fechas y orden.
// Se usa en la app y en el generador de PDF.

export const CATEGORIAS_OT = [
  'PODA', 'NIDO', 'AISLADORES', 'CONDUCTORES', 'HILO DE GUARDIA', 'PUESTA A TIERRA', 'OTROS'
];

export const COLORES_DEFECTO = ['#29B6F6', '#E53935', '#43A047', '#8E24AA', '#FB8C00'];
export const MAX_JORNADAS = 5;

export const PRIORIDAD_FONDO = {
  Rojo: '#FF7C80',
  Amarillo: '#FFE699',
  Verde: '#C6E0B4'
};

/** Categoría del relevamiento -> fila de la OT. */
export function categoriaOT(cat) {
  const c = String(cat || '').trim().toLowerCase();
  if (c.startsWith('poda')) return 'PODA';
  if (c.startsWith('nido')) return 'NIDO';
  if (c.startsWith('aislador')) return 'AISLADORES';
  if (c.startsWith('conductor')) return 'CONDUCTORES';
  if (c === 'hdg' || c.startsWith('hilo')) return 'HILO DE GUARDIA';
  if (c === 'pat' || c.startsWith('puesta')) return 'PUESTA A TIERRA';
  return 'OTROS';
}

/** Para "Otros" se antepone la categoría original (Apoyo, Punto caliente...). */
export function textoInicialOT(cat, observacion) {
  const obs = String(observacion || '').trim();
  const fila = categoriaOT(cat);
  const original = String(cat || '').trim();
  if (fila === 'OTROS' && original && original.toLowerCase() !== 'otros') {
    const corto = original.replace(/^Fenómeno Meteorológico\s*\((.*)\)$/i, '$1');
    if (obs.toLowerCase().startsWith(corto.toLowerCase())) return obs;
    return corto + ': ' + obs;
  }
  return obs;
}

/** Piquete o vano como se muestra: letras en mayúscula ("6rt - 7rt" -> "6RT - 7RT"). */
export function textoPiquete(pq) {
  return String(pq ?? '').toUpperCase();
}

function sinAcentos(s) {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Reclamos que no son trabajos y no van a la OT: los que solo marcan una ubicación
 * ("Ubicación", "Ubicación salida desde MSU") y los "Sin observaciones".
 */
export function excluidoDeOT(r) {
  const o = sinAcentos(r && r.observacion).toLowerCase().replace(/[.\s]+$/, '').trim();
  return o === 'sin observaciones' || o === 'sin observacion' || /^ubicacion\b/.test(o);
}

/** Fecha del relevamiento ("20/10/2026", "9/6/2026") -> 'AAAA-MM-DD' ('' si no se entiende). */
export function fechaRelevISO(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return '';
  const y = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** Relevador y fecha del relevamiento más reciente de los reclamos: "Juarez P. (20/10/2026)". */
export function textoRelevamiento(reclamos) {
  const conFecha = (reclamos || []).filter(r => r && (r.responsable || r.fecha))
    .map(r => ({ r, iso: fechaRelevISO(r.fecha) }))
    .sort((a, b) => b.iso.localeCompare(a.iso));
  const u = conFecha[0];
  if (!u) return '';
  const fecha = u.iso ? fechaAR(u.iso) : String(u.r.fecha || '');
  return `${String(u.r.responsable || '').trim()}${fecha ? ` (${fecha})` : ''}`.trim();
}

/** Clave de una línea para buscar su código (sin acentos, espacios ni puntos). */
export function claveLinea(nombre) {
  return sinAcentos(nombre).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Código de la línea para la OT: el de la planilla OT Dinamica (hoja Detalles) o el último usado. */
export function codigoDeLinea(config, linea) {
  const c = config || {};
  return (c.codigosOT || {})[claveLinea(linea)] || (c.codigosLinea || {})[linea] || '';
}

export function fondoPrioridad(prio) {
  return PRIORIDAD_FONDO[prio] || '#FFFFFF';
}

/** Orden natural de piquetes: "8/10rt" < "19/20" < "166-167RT"; los sin número al final. */
export function compararPiquetes(a, b) {
  const na = parseInt(String(a).match(/\d+/)?.[0] ?? 'NaN', 10);
  const nb = parseInt(String(b).match(/\d+/)?.[0] ?? 'NaN', 10);
  const va = isNaN(na) ? Infinity : na;
  const vb = isNaN(nb) ? Infinity : nb;
  if (va !== vb) return va - vb;
  return String(a).localeCompare(String(b), 'es');
}

/** Fecha local de Argentina como 'YYYY-MM-DD'. */
export function hoyISO(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit'
  });
  return f.format(d);
}

export function horaLocal(d = new Date()) {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(d);
}

/** 'YYYY-MM-DD' -> 'DD/MM/YYYY' */
export function fechaAR(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** Días libres entre dos trabajos para que sigan siendo el mismo período (menos de 3 días libres). */
export const DIAS_MISMO_PERIODO = 3;

function diasEntre(a, b) {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);
}

/**
 * Períodos de trabajo de una OT, deducidos de las fechas de las marcas.
 * Dos fechas con menos de 3 días libres entre sí (diferencia de hasta 3 días) son el mismo período:
 * 24 y 25 -> "24-25/11/2026"; 27 y 30 -> "27 y 30/10/2026". Cada período tiene un color y ocupa uno
 * de los 5 casilleros de "Fecha Ejecución" del formulario. Se calcula de las fechas (no de un contador),
 * así dos teléfonos sin señal nunca se pisan.
 * Devuelve [{ n, fecha (la primera), fechas[], texto, color, excedida }].
 */
export function jornadasDeOT(marcas, colores = COLORES_DEFECTO, fechaExtra = null) {
  const set = new Set();
  for (const m of Object.values(marcas || {})) {
    if (!m) continue;
    if (m.fecha) set.add(m.fecha);
    if (m.proceso && m.proceso.fecha) set.add(m.proceso.fecha); // un "en proceso" anterior conserva su período
  }
  if (fechaExtra) set.add(fechaExtra);
  const fechas = [...set].sort();
  const periodos = [];
  for (const f of fechas) {
    const ult = periodos[periodos.length - 1];
    if (ult && diasEntre(ult.fechas[ult.fechas.length - 1], f) <= DIAS_MISMO_PERIODO) ult.fechas.push(f);
    else periodos.push({ fechas: [f] });
  }
  return periodos.map((p, i) => ({
    n: i + 1,
    fecha: p.fechas[0],
    fechas: p.fechas,
    texto: textoPeriodo(p.fechas),
    color: colores[i] || colores[colores.length - 1] || '#000000',
    excedida: i >= MAX_JORNADAS
  }));
}

/** Período que contiene una fecha, o null. */
export function jornadaDeFecha(jornadas, fecha) {
  return jornadas.find(j => (j.fechas || [j.fecha]).includes(fecha)) || null;
}

/**
 * Texto de un período: "24/11/2026", "24-26/11/2026", "27 y 30/10/2026", "24-25 y 28/11/2026",
 * "30/11-02/12/2026".
 */
export function textoPeriodo(fechas) {
  const fs = [...new Set(fechas || [])].sort();
  if (!fs.length) return '';
  const tramos = [];
  for (const f of fs) {
    const t = tramos[tramos.length - 1];
    if (t && diasEntre(t[1], f) === 1) t[1] = f; else tramos.push([f, f]);
  }
  const p = iso => { const [y, m, d] = iso.split('-'); return { y, m, d }; };
  const mismoMes = fs.every(f => f.slice(0, 7) === fs[0].slice(0, 7));
  const mismoAnio = fs.every(f => f.slice(0, 4) === fs[0].slice(0, 4));
  const corto = iso => { const x = p(iso); return mismoMes ? x.d : mismoAnio ? `${x.d}/${x.m}` : `${x.d}/${x.m}/${x.y}`; };
  const partes = tramos.map(([a, b]) => a === b ? corto(a) : `${corto(a)}-${corto(b)}`);
  const unidas = partes.length > 1 ? partes.slice(0, -1).join(', ') + ' y ' + partes[partes.length - 1] : partes[0];
  const u = p(fs[fs.length - 1]);
  return unidas + (mismoMes ? `/${u.m}/${u.y}` : mismoAnio ? `/${u.y}` : '');
}

const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

/**
 * Poda privada de la OT: leyenda para el PDF ("PODA EMPRESA PRIVADA - EFUS MAYO 2026") y aviso si
 * hay más de una empresa o más de un mes de certificación (no debería pasar en una misma OT).
 */
export function resumenPrivados(ot) {
  const lista = Object.entries((ot && ot.privados) || {}).map(([, p]) => p).filter(Boolean);
  const empresas = [...new Set(lista.map(p => String(p.empresa || '').trim().toUpperCase()).filter(Boolean))];
  const meses = [...new Set(lista.map(p => String(p.fecha || '').slice(0, 7)).filter(Boolean))].sort();
  const textoMes = ym => { const [y, m] = ym.split('-'); return `${MESES[Number(m) - 1] || ''} ${y}`.trim(); };
  return {
    hay: lista.length > 0,
    empresas, meses: meses.map(textoMes),
    leyenda: lista.length ? `PODA EMPRESA PRIVADA - ${empresas.join(' / ') || 'SIN NOMBRE'} ${meses.map(textoMes).join(' / ')}`.trim() : '',
    conflicto: empresas.length > 1 || meses.length > 1
  };
}

/** Relevamientos de la OT para el renglón "Relev.:" (los textos, en orden). */
export function relevamientosDeOT(ot, relevoExtra = '') {
  const lista = Array.isArray(ot && ot.relevamientos) ? ot.relevamientos.map(r => (r && r.texto) || '').filter(Boolean) : [];
  if (!lista.length) { const r = (ot && ot.relevo) || relevoExtra; if (r) lista.push(r); }
  return lista;
}

/** Agrupa los ítems de la OT por fila de categoría, en el orden del formulario. */
export function agruparPorCategoria(items) {
  const grupos = CATEGORIAS_OT.map(nombre => ({ nombre, items: [] }));
  for (const it of items || []) {
    const g = grupos.find(x => x.nombre === (it.fila || categoriaOT(it.categoria)));
    (g || grupos[grupos.length - 1]).items.push(it);
  }
  return grupos;
}

/** Número de OT con el formato NNNN-MM-YY. */
export function formatoNroOT(secuencia, d = new Date()) {
  const iso = hoyISO(d);
  const [y, m] = iso.split('-');
  return `${String(secuencia).padStart(4, '0')}-${m}-${y.slice(2)}`;
}

export function secuenciaDeNro(nro) {
  const n = parseInt(String(nro).split('-')[0], 10);
  return isNaN(n) ? 0 : n;
}

/** 'pendiente' | 'proceso' | 'realizado' */
export function estadoMarca(m) {
  if (!m) return 'pendiente';
  return m.estado === 'proceso' ? 'proceso' : 'realizado';
}

export const MOTIVOS_PROCESO = ['Falta grúa alta', 'Falta material', 'Sin acceso al piquete', 'No alcanzó el tiempo', 'Condiciones climáticas'];

/** Estado del reclamo cuando la poda la hizo una empresa privada y EPEC la certificó. */
export const ESTADO_PRIVADO = 'Realizado (privado)';

/** Datos de la poda privada de un trabajo de la OT ({ empresa, fecha, vano, porNombre }), o null. */
export function privadoDe(ot, rid) {
  return (ot && ot.privados && ot.privados[rid]) || null;
}

export function avanceOT(ot) {
  const items = ot.items || [];
  const total = items.length;
  const marcas = ot.marcas || {};
  const priv = it => !!privadoDe(ot, it.rid) && estadoMarca(marcas[it.rid]) !== 'realizado';
  const hechos = items.filter(it => estadoMarca(marcas[it.rid]) === 'realizado').length;
  const privados = items.filter(priv).length;
  const enProceso = items.filter(it => !priv(it) && estadoMarca(marcas[it.rid]) === 'proceso').length;
  const prio = ot.prioritarios || {};
  const prioPendientes = items.filter(it => prio[it.rid] && !priv(it) && estadoMarca(marcas[it.rid]) !== 'realizado').length;
  return { total, hechos, privados, enProceso, prioPendientes, pct: total ? Math.round(((hechos + privados) / total) * 100) : 0 };
}
