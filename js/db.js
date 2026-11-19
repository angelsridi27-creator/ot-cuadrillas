// Acceso a Firebase: autenticación y base de datos (Firestore) con modo sin conexión.
import { initializeApp, deleteApp } from 'firebase/app';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  createUserWithEmailAndPassword, updatePassword
} from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, getDocs, setDoc, updateDoc, onSnapshot, collection, query, where,
  writeBatch, serverTimestamp, deleteField
} from 'firebase/firestore';
import { firebaseConfig, CORREO_ADMIN, DOMINIO_USUARIOS } from './config.js';
import { COLORES_DEFECTO, categoriaOT, textoInicialOT, compararPiquetes, hoyISO, horaLocal, fechaAR, formatoNroOT } from './logica.js';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

// ---------------- Autenticación ----------------

export function correoDeUsuario(usuario) {
  const u = String(usuario || '').trim().toLowerCase();
  return u.includes('@') ? u : `${u}@${DOMINIO_USUARIOS}`;
}

export function ingresar(usuario, clave) {
  return signInWithEmailAndPassword(auth, correoDeUsuario(usuario), clave);
}

export function salir() { return signOut(auth); }

export function alCambiarSesion(cb) { return onAuthStateChanged(auth, cb); }

export function cambiarMiClave(nueva) { return updatePassword(auth.currentUser, nueva); }

/** Perfil del usuario: rol, nombre, cuadrilla. */
export async function obtenerPerfil(user) {
  let datos = null;
  try {
    const snap = await getDoc(doc(db, 'usuarios', user.uid));
    if (snap.exists()) datos = snap.data();
  } catch (e) {
    console.warn('No se pudo leer el perfil', e);
  }
  const esAdmin = (user.email || '').toLowerCase() === CORREO_ADMIN;
  if (!datos && esAdmin) {
    datos = { nombre: 'Supervisor', usuario: user.email, rol: 'supervisor', cuadrilla: '', activo: true };
  }
  if (!datos) return null;
  if (esAdmin) datos.rol = 'supervisor';
  return { uid: user.uid, email: user.email, ...datos };
}

// ---------------- Configuración ----------------

export function escucharConfig(cb) {
  return onSnapshot(doc(db, 'config', 'general'), snap => {
    const d = snap.exists() ? snap.data() : {};
    cb({
      colores: Array.isArray(d.colores) && d.colores.length ? d.colores : COLORES_DEFECTO,
      ultimaSecuencia: d.ultimaSecuencia || 0,
      codigosLinea: d.codigosLinea || {}
    });
  }, err => { console.warn(err); cb({ colores: COLORES_DEFECTO, ultimaSecuencia: 0, codigosLinea: {} }); });
}

export function guardarColores(colores) {
  return setDoc(doc(db, 'config', 'general'), { colores }, { merge: true });
}

// ---------------- OT ----------------

function conId(snap) { return { id: snap.id, ...snap.data() }; }

/** OT de una cuadrilla (operario). */
export function escucharOtsDeCuadrilla(cuadrilla, cb, onError) {
  const q = query(collection(db, 'ots'), where('cuadrilla', '==', cuadrilla));
  return onSnapshot(q, { includeMetadataChanges: true }, s => {
    cb(s.docs.map(conId).sort((a, b) => String(b.fechaEmision).localeCompare(String(a.fechaEmision))), s.metadata);
  }, onError);
}

/** Todas las OT (supervisor). */
export function escucharTodasLasOts(cb, onError) {
  return onSnapshot(collection(db, 'ots'), { includeMetadataChanges: true }, s => {
    cb(s.docs.map(conId).sort((a, b) => String(b.nro).localeCompare(String(a.nro))), s.metadata);
  }, onError);
}

/** Una OT, con aviso de si hay cambios guardados en el teléfono sin enviar. */
export function escucharOt(id, cb, onError) {
  return onSnapshot(doc(db, 'ots', id), { includeMetadataChanges: true }, s => {
    cb(s.exists() ? conId(s) : null, { pendiente: s.metadata.hasPendingWrites, desdeCache: s.metadata.fromCache });
  }, onError);
}

/**
 * Marca un trabajo como realizado en la fecha indicada.
 * No se espera la respuesta del servidor: sin señal queda en cola y se envía sola.
 */
export function marcarRealizado(ot, item, fecha, perfil) {
  const b = writeBatch(db);
  b.update(doc(db, 'ots', ot.id), {
    [`marcas.${item.rid}`]: { fecha, por: perfil.uid, nombre: perfil.nombre || '', ts: serverTimestamp() },
    actualizado: serverTimestamp()
  });
  b.update(doc(db, 'reclamos', item.rid), {
    estado: 'Realizado', fechaEjecucion: fechaAR(fecha), otNro: ot.nro, actualizado: serverTimestamp()
  });
  return b.commit();
}

export function desmarcar(ot, item) {
  const b = writeBatch(db);
  b.update(doc(db, 'ots', ot.id), { [`marcas.${item.rid}`]: deleteField(), actualizado: serverTimestamp() });
  b.update(doc(db, 'reclamos', item.rid), {
    estado: 'Pendiente', fechaEjecucion: '', actualizado: serverTimestamp()
  });
  return b.commit();
}

export function guardarObservacionJornada(otId, fecha, texto) {
  return updateDoc(doc(db, 'ots', otId), { [`obsJornadas.${fecha}`]: texto, actualizado: serverTimestamp() });
}

export function cambiarEstadoOt(otId, estado) {
  return updateDoc(doc(db, 'ots', otId), { estado, actualizado: serverTimestamp() });
}

// ---------------- Reclamos y emisión de OT (supervisor) ----------------

export async function reclamosPendientes() {
  const s = await getDocs(query(collection(db, 'reclamos'), where('estado', '==', 'Pendiente')));
  return s.docs.map(conId);
}

export function guardarTextoOT(rid, texto) {
  return updateDoc(doc(db, 'reclamos', rid), { textoOT: texto, actualizado: serverTimestamp() });
}

/**
 * Emite una OT nueva con los reclamos elegidos.
 * datos: { nro, secuencia, linea, codigoLinea, cuadrilla, encargados[], relevo, observacion }
 */
export async function emitirOt(datos, reclamos, perfil) {
  const items = reclamos.map(r => ({
    rid: r.id,
    pq: r.piquete || '',
    txt: r.textoOT || textoInicialOT(r.categoria, r.observacion),
    prio: r.prioridad || '',
    categoria: r.categoria || '',
    fila: categoriaOT(r.categoria),
    coord: r.coordenadas || ''
  })).sort((a, b) => compararPiquetes(a.pq, b.pq));

  const ref = doc(collection(db, 'ots'));
  const b = writeBatch(db);
  b.set(ref, {
    nro: datos.nro,
    linea: datos.linea,
    codigoLinea: datos.codigoLinea || '',
    fechaEmision: hoyISO(),
    hora: horaLocal(),
    encargados: datos.encargados || [],
    relevo: datos.relevo || '',
    cuadrilla: datos.cuadrilla,
    observacion: datos.observacion || '',
    estado: 'abierta',
    items,
    marcas: {},
    obsJornadas: {},
    creadoPor: perfil.uid,
    creado: serverTimestamp(),
    actualizado: serverTimestamp()
  });
  b.set(doc(db, 'config', 'general'), {
    ultimaSecuencia: datos.secuencia,
    codigosLinea: { [datos.linea]: datos.codigoLinea || '' }
  }, { merge: true });
  for (const r of reclamos) {
    b.update(doc(db, 'reclamos', r.id), { otNro: datos.nro, actualizado: serverTimestamp() });
  }
  await b.commit();
  return ref.id;
}

export function proximoNroOT(ultimaSecuencia) {
  const sec = (ultimaSecuencia || 0) + 1;
  return { secuencia: sec, nro: formatoNroOT(sec) };
}

// ---------------- Usuarios (supervisor) ----------------

export async function listarUsuarios() {
  const s = await getDocs(collection(db, 'usuarios'));
  return s.docs.map(conId).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
}

/**
 * Crea un usuario sin cerrar la sesión del supervisor
 * (se usa una segunda instancia de Firebase solo para el alta).
 */
export async function crearUsuario({ usuario, clave, nombre, rol, cuadrilla }) {
  const secundaria = initializeApp(firebaseConfig, 'alta-' + Date.now());
  try {
    const cred = await createUserWithEmailAndPassword(getAuth(secundaria), correoDeUsuario(usuario), clave);
    await setDoc(doc(db, 'usuarios', cred.user.uid), {
      usuario: String(usuario).trim().toLowerCase(),
      nombre, rol, cuadrilla, activo: true, creado: serverTimestamp()
    });
    return cred.user.uid;
  } finally {
    await deleteApp(secundaria);
  }
}

export function actualizarUsuario(uid, cambios) {
  return updateDoc(doc(db, 'usuarios', uid), cambios);
}
