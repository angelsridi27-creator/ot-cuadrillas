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

/**
 * Jornadas de una OT, deducidas de las fechas de las marcas.
 * Cada fecha distinta es una jornada, numeradas en orden cronológico.
 * Así dos teléfonos sin señal nunca se "pisan" el número de jornada.
 */
export function jornadasDeOT(marcas, colores = COLORES_DEFECTO, fechaExtra = null) {
  const fechas = new Set();
  for (const m of Object.values(marcas || {})) {
    if (!m) continue;
    if (m.fecha) fechas.add(m.fecha);
    if (m.proceso && m.proceso.fecha) fechas.add(m.proceso.fecha); // un "en proceso" anterior conserva su jornada
  }
  if (fechaExtra) fechas.add(fechaExtra);
  return [...fechas].sort().map((fecha, i) => ({
    n: i + 1,
    fecha,
    color: colores[i] || colores[colores.length - 1] || '#000000',
    excedida: i >= MAX_JORNADAS
  }));
}

export function jornadaDeFecha(jornadas, fecha) {
  return jornadas.find(j => j.fecha === fecha) || null;
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
