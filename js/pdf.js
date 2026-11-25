// Genera el PDF de la OT con el formato SG-R09 y el tachado diagonal por jornada.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  agruparPorCategoria, jornadasDeOT, fechaAR, fondoPrioridad, COLORES_DEFECTO, MAX_JORNADAS, estadoMarca, privadoDe, textoPiquete,
  resumenPrivados, relevamientosDeOT
} from './logica.js';
import { NRO_OT_PDF } from './config.js';

const W = 612, H = 792, M = 30, CW = W - 2 * M;
const NEGRO = rgb(0, 0, 0);
const GRIS_BARRA = rgb(0.6, 0.6, 0.6);
const GRIS_LABEL = rgb(0.85, 0.85, 0.85);
const VERDE_EPEC = rgb(0, 0.44, 0.29);
const NEGRO_PRIVADO = rgb(0, 0, 0); // poda hecha por empresa privada: distinto de los colores de las fechas
const PUNTEADA = [3.2, 2.4];

function hex(c) {
  const h = String(c || '#000000').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// Solo caracteres que la fuente estándar (WinAnsi) puede dibujar.
function limpiar(s) {
  return String(s ?? '')
    .normalize('NFC')
    .replace(/[\r\t]/g, ' ')
    .replace(/[^\n\x20-\x7E -ÿ–—‘’“”•…€]/g, '');
}

class Lienzo {
  constructor(doc, fonts) {
    this.doc = doc;
    this.f = fonts;
    this.nuevaPagina();
  }
  nuevaPagina() {
    this.page = this.doc.addPage([W, H]);
    return this.page;
  }
  // y = distancia desde el borde superior
  rect(x, y, w, h, { fill = null, borde = true, grosor = 0.6 } = {}) {
    this.page.drawRectangle({
      x, y: H - y - h, width: w, height: h,
      color: fill || undefined,
      borderColor: borde ? NEGRO : undefined,
      borderWidth: borde ? grosor : 0
    });
  }
  linea(x1, y1, x2, y2, color = NEGRO, grosor = 0.6, punteada = null) {
    this.page.drawLine({ start: { x: x1, y: H - y1 }, end: { x: x2, y: H - y2 }, thickness: grosor, color, ...(punteada ? { dashArray: punteada } : {}) });
  }
  envolver(texto, font, size, ancho) {
    const lineas = [];
    for (const parrafo of limpiar(texto).split('\n')) {
      let actual = '';
      for (const palabra of parrafo.split(/\s+/).filter(Boolean)) {
        const prueba = actual ? actual + ' ' + palabra : palabra;
        if (font.widthOfTextAtSize(prueba, size) <= ancho) { actual = prueba; continue; }
        if (actual) lineas.push(actual);
        // palabra más larga que el ancho: se corta
        let resto = palabra;
        while (font.widthOfTextAtSize(resto, size) > ancho && resto.length > 1) {
          let i = resto.length - 1;
          while (i > 1 && font.widthOfTextAtSize(resto.slice(0, i), size) > ancho) i--;
          lineas.push(resto.slice(0, i));
          resto = resto.slice(i);
        }
        actual = resto;
      }
      lineas.push(actual);
    }
    return lineas;
  }
  /** Texto dentro de una caja; achica la letra hasta que entre. */
  texto(t, x, y, w, h, { size = 8, min = 4.5, bold = false, italic = false, alinear = 'centro', vertical = 'centro', pad = 2, color = NEGRO, mayus = false } = {}) {
    const font = bold && italic ? this.f.boldItalic : bold ? this.f.bold : this.f.normal;
    let s = size, lineas;
    const contenido = mayus ? String(t ?? '').toUpperCase() : t;
    for (;;) {
      lineas = this.envolver(contenido, font, s, w - 2 * pad);
      if (lineas.length * s * 1.15 <= h - 2 * pad || s <= min) break;
      s = Math.max(min, s - 0.25);
    }
    const alto = lineas.length * s * 1.15;
    let yy = vertical === 'arriba' ? y + pad : vertical === 'abajo' ? y + h - pad - alto : y + (h - alto) / 2;
    for (const ln of lineas) {
      if (yy + s > y + h + 0.5) break; // no se sale de la caja
      const ancho = font.widthOfTextAtSize(ln, s);
      const xx = alinear === 'izq' ? x + pad : alinear === 'der' ? x + w - pad - ancho : x + (w - ancho) / 2;
      this.page.drawText(ln, { x: xx, y: H - yy - s * 0.92, size: s, font, color });
      yy += s * 1.15;
    }
  }
}

/**
 * opciones: { codigoLinea } — código a usar si la OT no tiene uno propio.
 */
export async function generarPdfOT(ot, colores = COLORES_DEFECTO, opciones = {}) {
  const nro = NRO_OT_PDF || ot.nro || '';
  const codigo = ot.codigoLinea || opciones.codigoLinea || '';
  const doc = await PDFDocument.create();
  doc.setTitle(`OT ${nro} - ${ot.linea}`);
  doc.setCreator('App Cuadrillas OT');
  const fonts = {
    normal: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique)
  };
  let logo = null;
  try {
    const r = await fetch(new URL('../icons/logo-epec.png', import.meta.url));
    if (r.ok) logo = await doc.embedPng(new Uint8Array(await r.arrayBuffer()));
  } catch (_) { /* sin logo: se escribe EPEC */ }
  const L = new Lienzo(doc, fonts);
  const jornadas = jornadasDeOT(ot.marcas, colores);
  // cada fecha -> color de su período
  const colorDeFecha = {};
  jornadas.forEach(j => j.fechas.forEach(f => { colorDeFecha[f] = j.color; }));

  // ---------- Encabezado ----------
  let y = M;
  const c = { logo: 130, codLbl: 70, cod: 150, nroLbl: 62, nro: 80, sg: 60 };
  const x0 = M, x1 = x0 + c.logo, x2 = x1 + c.codLbl, x3 = x2 + c.cod, x4 = x3 + c.nroLbl, x5 = x4 + c.nro;
  const der = x4; // columna derecha (140 de ancho) a partir de x4

  // Fila 1
  L.rect(x0, y, c.logo, 42);
  if (logo) {
    const k = Math.min((c.logo - 14) / logo.width, (42 - 8) / logo.height);
    const w = logo.width * k, h = logo.height * k;
    L.page.drawImage(logo, { x: x0 + (c.logo - w) / 2, y: H - y - (42 + h) / 2, width: w, height: h });
  } else {
    L.texto('EPEC', x0, y, c.logo, 42, { size: 24, bold: true, color: VERDE_EPEC });
  }
  L.rect(x1, y, c.codLbl, 24); L.texto('CODIGO LINEA', x1, y, c.codLbl, 24, { size: 7.5 });
  L.rect(x2, y, c.cod, 24); L.texto(`[ ${codigo} ]`, x2, y, c.cod, 24, { size: 9 });
  L.rect(x3, y, c.nroLbl, 24); L.texto('Nro. OT', x3, y, c.nroLbl, 24, { size: 7.5 });
  L.rect(x4, y, c.nro, 24); L.texto(`[ ${nro} ]`, x4, y, c.nro, 24, { size: 8.5, bold: true });
  L.rect(x5, y, c.sg, 24); L.texto('SG-R09\nVersión: 01', x5, y, c.sg, 24, { size: 7, bold: true });
  y += 24;
  // Fila 2
  L.rect(x1, y, c.codLbl + c.cod + c.nroLbl, 18);
  L.texto('DEPARTAMENTO REDES DE ALTA TENSIÓN', x1, y, c.codLbl + c.cod + c.nroLbl, 18, { size: 8, bold: true, italic: true });
  L.rect(der, y, c.nro + c.sg, 18);
  L.texto(`Fecha de emisión: ${fechaAR(ot.fechaEmision)}`, der, y, c.nro + c.sg, 18, { size: 6.5, alinear: 'izq' });
  y += 18;
  // Fila 3
  L.rect(x0, y, c.logo, 16); L.texto('MANTENIMIENTO REGLAMENTARIO', x0, y, c.logo, 16, { size: 6, bold: true });
  L.rect(x1, y, c.codLbl + c.cod + c.nroLbl, 16);
  L.texto('ORDEN DE TRABAJO', x1, y, c.codLbl + c.cod + c.nroLbl, 16, { size: 9, bold: true });
  L.rect(der, y, c.nro + c.sg, 16); L.texto(`Hora: ${ot.hora || ''}`, der, y, c.nro + c.sg, 16, { size: 6.5, alinear: 'izq' });
  y += 16;

  // Filas 4 a 6: encargados y tramo/línea a la izquierda; a la derecha, los 5 casilleros de
  // "Fecha Ejecución" (uno por período de trabajo). Fila 7: relevadores, a todo lo ancho (SG-R09).
  const fh = 15, izqW = c.logo + c.codLbl + c.cod + c.nroLbl, FILAS_FECHA = 3;
  const enc = ot.encargados || [];
  L.rect(x0, y, c.logo, fh * 2);
  L.texto('ENCARGADOS DEL\nTRABAJO (NOMBRES)', x0, y, c.logo, fh * 2, { size: 7.5 });
  L.rect(x1, y, izqW - c.logo, fh); L.texto(`1) ${enc[0] || ''}`, x1, y, izqW - c.logo, fh, { size: 7, alinear: 'izq' });
  L.rect(x1, y + fh, izqW - c.logo, fh); L.texto(`2) ${enc[1] || ''}`, x1, y + fh, izqW - c.logo, fh, { size: 7, alinear: 'izq' });
  L.rect(x0, y + fh * 2, izqW, fh);
  L.texto(`TRAMO/LÍNEA: ${ot.linea || ''}`, x0, y + fh * 2, izqW, fh, { size: 7.5, alinear: 'izq' });

  for (let i = 0; i < FILAS_FECHA; i++) {
    L.rect(der, y + fh * i, c.nro, fh);
    L.rect(x5, y + fh * i, c.sg, fh);
  }
  L.texto('Fecha Ejecución:', der, y, c.nro, fh, { size: 6.5, alinear: 'izq' });
  // casilleros: 1 al lado del rótulo, 2 y 3 en el segundo renglón, 4 y 5 en el tercero
  const casilleros = [[x5, 0, c.sg], [der, 1, c.nro], [x5, 1, c.sg], [der, 2, c.nro], [x5, 2, c.sg]];
  casilleros.forEach(([cx, fila, w], i) => {
    const j = jornadas[i];
    if (!j) return;
    const yy = y + fh * fila;
    L.texto(j.texto, cx, yy, w, fh - 2, { size: 7.5, min: 4.5 });
    L.linea(cx + 3, yy + fh - 2.5, cx + w - 3, yy + fh - 2.5, hex(j.color), 2.2);
  });
  y += fh * FILAS_FECHA;
  const relevos = relevamientosDeOT(ot, opciones.relevo)
    .map((r, i) => i === 0 ? String(r).replace(/^relev(ó|o|\.)?:?\s*/i, '') : String(r));
  L.rect(x0, y, CW, fh);
  L.texto(`Relev.: ${relevos.join('   ·   ')}`, x0, y, CW, fh, { size: 7, alinear: 'izq' });
  y += fh;

  // ---------- Tabla de trabajos ----------
  const labelW = 120, ncol = 7, colW = (CW - labelW) / ncol, celdaH = 46, pqH = 12;
  const limite = H - M;

  const barraTrabajos = () => {
    L.rect(x0, y, CW, 14, { fill: GRIS_BARRA });
    L.texto('TRABAJOS A REALIZAR [TcT Y TsT]', x0, y, CW, 14, { size: 8 });
    y += 14;
    L.rect(x0, y, labelW, 13, { fill: GRIS_LABEL });
    L.texto('TIPO DE AVERÍA', x0, y, labelW, 13, { size: 7.5, bold: true });
    L.rect(x0 + labelW, y, CW - labelW, 13, { fill: GRIS_LABEL });
    L.texto('PIQUETES', x0 + labelW, y, CW - labelW, 13, { size: 7.5, bold: true });
    y += 13;
  };
  const saltoPagina = () => {
    L.nuevaPagina();
    y = M;
    L.texto(`OT ${nro} · ${ot.linea} (continuación)`, x0, y, CW, 12, { size: 7, alinear: 'izq' });
    y += 14;
    barraTrabajos();
  };

  barraTrabajos();
  const privados = resumenPrivados({ privados: Object.fromEntries((ot.items || [])
    .filter(it => privadoDe(ot, it.rid) && estadoMarca((ot.marcas || {})[it.rid]) !== 'realizado')
    .map(it => [it.rid, privadoDe(ot, it.rid)])) });

  for (const grupo of agruparPorCategoria(ot.items)) {
    const filas = Math.max(1, Math.ceil(grupo.items.length / ncol));
    let inicioSegmento = y, filasSegmento = 0;
    let primerSegmento = true;
    const cerrarSegmento = () => {
      if (!filasSegmento) return;
      const alto = y - inicioSegmento;
      L.rect(x0, inicioSegmento, labelW, alto);
      L.texto(grupo.nombre, x0, inicioSegmento, labelW, alto, { size: 8, bold: true });
      // leyenda de la poda privada, arriba del recuadro PODA, en el mismo color del tachado
      if (grupo.nombre === 'PODA' && primerSegmento && privados.hay) {
        L.texto(privados.leyenda, x0, inicioSegmento, labelW, Math.min(30, alto / 2 - 4),
          { size: 7, min: 4.5, bold: true, alinear: 'izq', vertical: 'arriba', color: NEGRO_PRIVADO });
      }
      primerSegmento = false;
    };
    const altoFila = grupo.items.length ? celdaH : 28;
    for (let f = 0; f < filas; f++) {
      if (y + altoFila > limite) {
        cerrarSegmento();
        saltoPagina();
        inicioSegmento = y; filasSegmento = 0;
      }
      for (let k = 0; k < ncol; k++) {
        const it = grupo.items[f * ncol + k];
        const cx = x0 + labelW + k * colW;
        if (!it) { L.rect(cx, y, colW, altoFila); continue; }
        L.rect(cx, y, colW, celdaH);
        L.texto(textoPiquete(it.pq), cx, y + 1, colW, pqH, { size: 8.5, bold: true, min: 5 });
        L.rect(cx + 0.6, y + pqH + 1, colW - 1.2, celdaH - pqH - 1.6, { fill: hex(fondoPrioridad(it.prio)), borde: false });
        L.texto(it.txt, cx, y + pqH + 1, colW, celdaH - pqH - 1.6, { size: 7, min: 4.5, mayus: true });
        if (ot.prioritarios && ot.prioritarios[it.rid]) {
          // trabajo prioritario: borde grueso y triángulo negro en la esquina
          L.rect(cx + 1, y + 1, colW - 2, celdaH - 2, { grosor: 1.8 });
          L.page.drawSvgPath('M 0 0 L 9 0 L 0 9 Z', { x: cx + 1, y: H - y - 1, color: NEGRO });
        }
        const marca = ot.marcas && ot.marcas[it.rid];
        const priv = estadoMarca(marca) !== 'realizado' ? privadoDe(ot, it.rid) : null;
        if (priv) {
          // poda hecha por una empresa privada: diagonal negra
          L.linea(cx + 1.5, y + celdaH - 1.5, cx + colW - 1.5, y + 1.5, NEGRO_PRIVADO, 2.4);
        } else if (marca && colorDeFecha[marca.fecha]) {
          const col = hex(colorDeFecha[marca.fecha]);
          // en proceso: diagonal punteada del color del período; realizado: diagonal llena
          L.linea(cx + 1.5, y + celdaH - 1.5, cx + colW - 1.5, y + 1.5, col, 2.6,
            estadoMarca(marca) === 'proceso' ? PUNTEADA : null);
        }
      }
      y += altoFila;
      filasSegmento++;
    }
    cerrarSegmento();
  }

  // ---------- Observaciones y firmas ----------
  // Renglones: observación de la OT, observaciones de cada jornada y, para los trabajos en proceso,
  // un trazo punteado horizontal del color del período seguido del motivo que escribió el operario.
  const renglones = [];
  String(ot.observacion || '').split('\n').filter(t => t.trim()).forEach(t => renglones.push({ t }));
  Object.entries(ot.obsJornadas || {})
    .filter(([, t]) => t && String(t).trim())
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([f, t]) => renglones.push({ t: `${fechaAR(f)}: ${t}` }));
  const vistos = new Set();
  (ot.items || []).forEach(it => {
    const m = (ot.marcas || {})[it.rid];
    if (estadoMarca(m) !== 'proceso' || privadoDe(ot, it.rid)) return;
    const color = colorDeFecha[m.fecha] || '#000000';
    const motivo = String(m.motivo || '').trim() || `${textoPiquete(it.pq)} en proceso`;
    const clave = color + '|' + motivo.toLowerCase();
    if (vistos.has(clave)) return; // mismo motivo en el mismo período: un solo renglón
    vistos.add(clave);
    renglones.push({ t: motivo, muestra: color });
  });
  if (Object.keys(ot.prioritarios || {}).some(k => ot.prioritarios[k])) {
    renglones.push({ t: 'Referencia: borde grueso con triángulo = trabajo prioritario', chico: true });
  }

  const obsW = CW - labelW, tam = 7, alto = tam * 1.25, sangria = 30;
  const lineasObs = [];
  renglones.forEach(r => {
    const w = obsW - 6 - (r.muestra ? sangria : 0);
    L.envolver(r.t, fonts.normal, r.chico ? 6 : tam, w).forEach((ln, i) => lineasObs.push({ ln, muestra: i === 0 ? r.muestra : null, sangria: !!r.muestra, chico: r.chico }));
  });
  const obsH = Math.max(44, lineasObs.length * alto + 8);
  const bloqueFinal = 12 + obsH + 12 + 36;
  if (y + bloqueFinal > limite) { L.nuevaPagina(); y = M; }

  L.rect(x0, y, labelW, 12); L.texto('OBSERVACIÓN', x0, y, labelW, 12, { size: 6.5, bold: true });
  L.rect(x0 + labelW, y, obsW, 12);
  L.texto('PENDIENTES (MOTIVO y NRO. APOYO)', x0 + labelW, y, obsW, 12, { size: 6, alinear: 'izq' });
  y += 12;
  L.rect(x0, y, labelW, obsH);
  L.texto('N° de piquete: detalle lo observado', x0, y, labelW, obsH, { size: 5, vertical: 'abajo', alinear: 'izq' });
  L.rect(x0 + labelW, y, obsW, obsH);
  let yo = y + 4;
  const xo = x0 + labelW + 3;
  lineasObs.forEach(o => {
    if (o.muestra) L.linea(xo, yo + alto / 2, xo + sangria - 6, yo + alto / 2, hex(o.muestra), 2.6, PUNTEADA);
    L.page.drawText(o.ln, { x: xo + (o.sangria ? sangria : 0), y: H - yo - tam * 0.95, size: o.chico ? 6 : tam, font: fonts.normal, color: NEGRO });
    yo += alto;
  });
  y += obsH;
  L.rect(x0, y, CW, 12, { fill: GRIS_BARRA });
  L.texto('RESPONSABLES DEL MANTENIMIENTO', x0, y, CW, 12, { size: 7, bold: true });
  y += 12;
  L.rect(x0, y, CW / 2, 36); L.rect(x0 + CW / 2, y, CW / 2, 36);
  L.linea(x0 + 60, y + 23, x0 + CW / 2 - 60, y + 23);
  L.linea(x0 + CW / 2 + 60, y + 23, x0 + CW - 60, y + 23);
  L.texto('Firma ENCARGADO', x0, y + 24, CW / 2, 10, { size: 6.5 });
  L.texto('Firma JEFE DEL SECTOR', x0 + CW / 2, y + 24, CW / 2, 10, { size: 6.5 });

  return await doc.save();
}
