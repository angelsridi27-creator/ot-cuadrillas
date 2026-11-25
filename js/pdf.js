// Genera el PDF de la OT con el formato SG-R09 y el tachado diagonal por jornada.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  agruparPorCategoria, jornadasDeOT, fechaAR, fondoPrioridad, COLORES_DEFECTO, MAX_JORNADAS, estadoMarca, privadoDe, textoPiquete
} from './logica.js';
import { NRO_OT_PDF } from './config.js';

const W = 612, H = 792, M = 30, CW = W - 2 * M;
const NEGRO = rgb(0, 0, 0);
const GRIS_BARRA = rgb(0.74, 0.74, 0.74);
const GRIS_LABEL = rgb(0.85, 0.85, 0.85);
const VERDE_EPEC = rgb(0, 0.44, 0.29);
const GRIS_PRIVADO = rgb(0.45, 0.48, 0.47);

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
  linea(x1, y1, x2, y2, color = NEGRO, grosor = 0.6) {
    this.page.drawLine({ start: { x: x1, y: H - y1 }, end: { x: x2, y: H - y2 }, thickness: grosor, color });
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
  texto(t, x, y, w, h, { size = 8, min = 4.5, bold = false, alinear = 'centro', vertical = 'centro', pad = 2, color = NEGRO, mayus = false } = {}) {
    const font = bold ? this.f.bold : this.f.normal;
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
    bold: await doc.embedFont(StandardFonts.HelveticaBold)
  };
  let logo = null;
  try {
    const r = await fetch(new URL('../icons/logo-epec.png', import.meta.url));
    if (r.ok) logo = await doc.embedPng(new Uint8Array(await r.arrayBuffer()));
  } catch (_) { /* sin logo: se escribe EPEC */ }
  const L = new Lienzo(doc, fonts);
  const jornadas = jornadasDeOT(ot.marcas, colores);
  const colorDeFecha = Object.fromEntries(jornadas.map(j => [j.fecha, j.color]));

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
  L.texto('DEPARTAMENTO REDES DE ALTA TENSIÓN', x1, y, c.codLbl + c.cod + c.nroLbl, 18, { size: 8, bold: true });
  L.rect(der, y, c.nro + c.sg, 18);
  L.texto(`Fecha de emisión: ${fechaAR(ot.fechaEmision)}`, der, y, c.nro + c.sg, 18, { size: 6.5, alinear: 'izq' });
  y += 18;
  // Fila 3
  L.rect(x0, y, c.logo, 16); L.texto('MANTENIMIENTO REGLAMENTARIO', x0, y, c.logo, 16, { size: 6, bold: true });
  L.rect(x1, y, c.codLbl + c.cod + c.nroLbl, 16);
  L.texto('ORDEN DE TRABAJO', x1, y, c.codLbl + c.cod + c.nroLbl, 16, { size: 9, bold: true });
  L.rect(der, y, c.nro + c.sg, 16); L.texto(`Hora: ${ot.hora || ''}`, der, y, c.nro + c.sg, 16, { size: 6.5, alinear: 'izq' });
  y += 16;

  // Filas 4 a 8: datos a la izquierda y las 5 fechas de ejecución a la derecha
  const fh = 15, izqW = c.logo + c.codLbl + c.cod + c.nroLbl;
  const enc = ot.encargados || [];
  L.rect(x0, y, c.logo, fh * 2);
  L.texto('ENCARGADOS DEL\nTRABAJO (NOMBRES)', x0, y, c.logo, fh * 2, { size: 7.5 });
  L.rect(x1, y, izqW - c.logo, fh); L.texto(`1) ${enc[0] || ''}`, x1, y, izqW - c.logo, fh, { size: 7, alinear: 'izq' });
  L.rect(x1, y + fh, izqW - c.logo, fh); L.texto(`2) ${enc[1] || ''}`, x1, y + fh, izqW - c.logo, fh, { size: 7, alinear: 'izq' });
  // TRAMO/LÍNEA ocupa dos renglones (los nombres de línea son largos); la cuadrilla no se imprime
  L.rect(x0, y + fh * 2, izqW, fh * 2);
  L.texto(`TRAMO/LÍNEA: ${ot.linea || ''}`, x0, y + fh * 2, izqW, fh * 2, { size: 8, bold: true, alinear: 'izq' });
  L.rect(x0, y + fh * 4, izqW, fh);
  L.texto(ot.relevo ? `Relevó ${ot.relevo}` : '', x0, y + fh * 4, izqW, fh, { size: 7, alinear: 'izq' });

  for (let i = 0; i < MAX_JORNADAS; i++) {
    const yy = y + fh * i;
    L.rect(der, yy, c.nro, fh);
    if (i === 0) L.texto('Fecha Ejecución:', der, yy, c.nro, fh, { size: 6.5, alinear: 'izq' });
    L.rect(x5, yy, c.sg, fh);
    const j = jornadas[i];
    if (j) {
      L.texto(fechaAR(j.fecha), x5, yy, c.sg, fh - 2, { size: 7.5 });
      L.linea(x5 + 4, yy + fh - 2.5, x5 + c.sg - 4, yy + fh - 2.5, hex(j.color), 2.2);
    }
  }
  y += fh * MAX_JORNADAS;

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

  for (const grupo of agruparPorCategoria(ot.items)) {
    const filas = Math.max(1, Math.ceil(grupo.items.length / ncol));
    let inicioSegmento = y, filasSegmento = 0;
    const cerrarSegmento = () => {
      if (!filasSegmento) return;
      L.rect(x0, inicioSegmento, labelW, y - inicioSegmento);
      L.texto(grupo.nombre, x0, inicioSegmento, labelW, y - inicioSegmento, { size: 8, bold: true });
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
          // poda hecha por una empresa privada: diagonal gris
          L.linea(cx + 1.5, y + celdaH - 1.5, cx + colW - 1.5, y + 1.5, GRIS_PRIVADO, 2.4);
        } else if (marca && colorDeFecha[marca.fecha]) {
          const col = hex(colorDeFecha[marca.fecha]);
          if (estadoMarca(marca) === 'proceso') {
            // en proceso: media diagonal (desde la esquina inferior izquierda hasta el centro)
            L.linea(cx + 1.5, y + celdaH - 1.5, cx + colW / 2, y + celdaH / 2, col, 2.4);
          } else {
            L.linea(cx + 1.5, y + celdaH - 1.5, cx + colW - 1.5, y + 1.5, col, 2.4);
          }
        }
      }
      y += altoFila;
      filasSegmento++;
    }
    cerrarSegmento();
  }

  // ---------- Observaciones y firmas ----------
  const obsJ = Object.entries(ot.obsJornadas || {})
    .filter(([, t]) => t && String(t).trim())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([f, t]) => `${fechaAR(f)}: ${t}`);
  const enProceso = (ot.items || [])
    .filter(it => estadoMarca((ot.marcas || {})[it.rid]) === 'proceso')
    .map(it => `${textoPiquete(it.pq)}: EN PROCESO (${fechaAR(ot.marcas[it.rid].fecha)}) - ${ot.marcas[it.rid].motivo || ''}`);
  const privados = (ot.items || [])
    .filter(it => estadoMarca((ot.marcas || {})[it.rid]) !== 'realizado' && privadoDe(ot, it.rid))
    .map(it => { const p = privadoDe(ot, it.rid); return `${textoPiquete(it.pq)}: PODA REALIZADA POR ${p.empresa || 'EMPRESA PRIVADA'} - CERTIFICADA ${fechaAR(p.fecha)}`; });
  const hayPrio = Object.keys(ot.prioritarios || {}).some(k => ot.prioritarios[k]);
  const referencias = (hayPrio || enProceso.length || privados.length)
    ? ['Referencias: ' + [hayPrio ? 'borde grueso con triángulo = trabajo prioritario' : '', enProceso.length ? 'media diagonal = en proceso' : '',
        privados.length ? 'diagonal gris = poda hecha por empresa privada' : ''].filter(Boolean).join(' · ')]
    : [];
  const textoObs = [ot.observacion || '', ...enProceso, ...privados, ...obsJ, ...referencias].filter(Boolean).join('\n');
  const bloqueFinal = 12 + 44 + 12 + 36;
  if (y + bloqueFinal > limite) { L.nuevaPagina(); y = M; }

  L.rect(x0, y, labelW, 12); L.texto('OBSERVACIÓN', x0, y, labelW, 12, { size: 6.5, bold: true });
  L.rect(x0 + labelW, y, CW - labelW, 12);
  L.texto('PENDIENTES (MOTIVO y NRO. APOYO)', x0 + labelW, y, CW - labelW, 12, { size: 6, alinear: 'izq' });
  y += 12;
  L.rect(x0, y, labelW, 44);
  L.texto('N° de piquete: detalle lo observado', x0, y, labelW, 44, { size: 5, vertical: 'abajo', alinear: 'izq' });
  L.rect(x0 + labelW, y, CW - labelW, 44);
  L.texto(textoObs, x0 + labelW, y, CW - labelW, 44, { size: 7, min: 4.5, alinear: 'izq', vertical: 'arriba' });
  y += 44;
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
