import logoUrl from './assets/thermo-house-logo.png';
import {presentationLabel} from './leadPresentations';

/*
 * PDF de cotización (presupuesto) Thermo House.
 *
 * Se dibuja directamente con jsPDF (texto y líneas vectoriales, nada de capturas de
 * pantalla) sobre una sola hoja carta vertical con el diseño del "Machote Formato Presupuesto".
 */

const LOGO_RATIO = 144 / 300;

const COLOR = {
  black: [0, 0, 0],
  text: [20, 20, 20],
  gray: [140, 140, 140],
  checkGray: [90, 90, 90],
  green: [183, 225, 205],
  pink: [244, 199, 195],
  navy: [31, 56, 100],
  yellow: [255, 255, 0],
  red: [255, 0, 0],
  orange: [255, 102, 0],
  blue: [0, 0, 255],
};

const QUOTE_MEDIA = ['TV', 'RADIO', 'REDES SOCIALES', 'VOLANTE PUB', 'RECOMENDACIÓN'];
const QUOTE_APPLICATIONS = ['PARED', 'CUARTO FRIO', 'LÁMINA', 'CONCRETO', 'PARED TABLA ROCA'];
const QUOTE_TONES = ['BLANCO', 'ROJO ÓXIDO', 'NO APLICA'];

const BENEFITS = [
  'La espuma de poliuretano es el mejor aislante térmico disponible en el mercado.',
  'Se aplica directamente sobre cualquier superficie sólida (concreto, metal, madera, etc.).',
  'Producto químicamente neutro protege el área cubierta de la corrosión (lámina), putrefacción, plagas, microorganismos y roedores.',
  'Se puede aplicar en techos y muros, exterior e interior.',
  'Evita la condensación de la humedad.',
];

const ADVANCE_NOTE =
  'Nota: Se requiere anticipo del 50% (porcentaje calculado sobre el total del monto del presupuesto). Thermo House se reserva el derecho de devolución en caso de cancelación. Al terminar el trabajo se deberá cubrir el pago total del trabajo.';

const DEFAULT_SPECIFICATIONS =
  'Suministro y aplicación de espuma de poliuretano espreado a un espesor de una pulgada y recubrimiento acrílico elastomérico base celulosa (32 micras) (7000 cel 85).\nIncluye mano de obra y material.';

const money = n =>
  '$' + Number(n || 0).toLocaleString('es-MX', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const number = n => Number(n || 0).toLocaleString('es-MX');
const normalizeOption = value =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
const has = (list, label) =>
  Array.isArray(list) && list.some(item => normalizeOption(item) === normalizeOption(label));

function formatDate(value) {
  if (!value) return '';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('es-MX');
}

/** Replica los cálculos del reporte en pantalla (Report en App.jsx). */
function quoteData(l) {
  const hasFiscalSnapshot = l.subtotal != null && l.iva != null;
  const extras = Number(l.costo_logistico || 0) + Number(l.destechado_monto || 0);
  const subtotal = Number(hasFiscalSnapshot ? l.subtotal : l.total ?? 0);
  const tax = Number(hasFiscalSnapshot ? l.iva : subtotal * 0.16);
  const grandTotal = Number(hasFiscalSnapshot ? l.total ?? subtotal + tax : subtotal + tax);
  const applicationAmount = Math.max(0, subtotal - extras);

  const relevant = line => line.sistema || Number(line.destechado_m2) > 0 || Number(line.destechado_monto) > 0;
  const lines =
    Array.isArray(l.presentaciones) && l.presentaciones.some(relevant)
      ? l.presentaciones.filter(relevant).map((line, index) => ({
          ...line,
          destechado_m2: line.destechado_m2 ?? (index === 0 ? l.destechado_m2 : 0),
          destechado_monto: line.destechado_monto ?? (index === 0 ? l.destechado_monto : 0),
        }))
      : [
          {
            sistema: l.sistema || l.presentacion,
            area_m2: l.area_m2,
            precio_final_m2: l.precio_final_m2,
            monto: applicationAmount,
            tono_acrilico: l.tono_acrilico,
            destechado_m2: l.destechado_m2,
            destechado_monto: l.destechado_monto,
          },
        ];

  const area = lines.reduce((sum, line) => sum + Number(line.area_m2 || 0), 0);
  const destechadoArea = lines.reduce((sum, line) => sum + Number(line.destechado_m2 || 0), 0);
  const destechadoCost = lines.reduce((sum, line) => sum + Number(line.destechado_monto || 0), 0);
  const systems = [...new Set(lines.map(line => presentationLabel(line.sistema)).filter(Boolean))];
  const pricePerMeter =
    l.precio_final_m2 ?? (Number(l.area_m2) > 0 ? applicationAmount / Number(l.area_m2) : null);

  return {
    subtotal,
    tax,
    grandTotal,
    applicationAmount,
    extras,
    lines,
    area,
    destechadoArea,
    destechadoCost: destechadoCost || Number(l.destechado_monto || 0),
    systems,
    pricePerMeter,
    quotedAt: l.fecha_presupuesto || l.created_at,
  };
}

/**
 * Dibuja la cotización completa en UNA sola hoja carta vertical (612 × 792 pt),
 * con el mismo orden y estilo del "Machote Formato Presupuesto".
 * Las coordenadas están en puntos. Si el contenido crece (varias presentaciones,
 * textos largos) se reduce todo proporcionalmente para que siempre quepa.
 * `logo` es un data URL PNG (o null).
 */
export function drawQuote(doc, l, logo) {
  const d = quoteData(l);
  const L = 30;
  const R = 582;
  const MID = (L + R) / 2;
  const BOTTOM = 772;
  const ROW = 13;

  // ── Medición previa (no depende de la escala) ──
  const wrap = (value, width, size, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    return doc.splitTextToSize(String(value ?? ''), width);
  };
  const clip = (rows, max) =>
    rows.length > max ? [...rows.slice(0, max - 1), rows[max - 1].replace(/\s*\S*$/, '') + '…'] : rows;

  const SPEC_X = 300;
  const SPEC_LH = 10.5;
  const specLines = clip(
    String(l.especificaciones || DEFAULT_SPECIFICATIONS)
      .split('\n')
      .flatMap(part => (part.trim() ? wrap(part.trim(), R - SPEC_X, 8) : [])),
    9,
  );
  const obsLines = clip(
    l.notas ? String(l.notas).split('\n').flatMap(part => wrap(part, 320, 7.5)) : [],
    3,
  );
  const benefitRows = BENEFITS.map(item => wrap(item, R - L - 6, 8));
  const noteLines = wrap(ADVANCE_NOTE, R - L - 8, 8);

  // ── Posiciones verticales ──
  const totalsTop = 206;
  const totalsEnd = totalsTop + 5 * 14;
  const specHeadY = 212;
  const specY0 = 225;
  const specEnd = specY0 + (specLines.length - 1) * SPEC_LH + 6;
  const blockEnd = Math.max(totalsEnd, specEnd);

  const multi = d.lines.length > 1;
  const tableHeadY = blockEnd + 14;
  const tableTop = tableHeadY + 8;
  const afterBlock = multi ? tableTop + ROW * (d.lines.length + 1) : blockEnd;

  const checkTitleY = afterBlock + 20;
  const checkHeadY = checkTitleY + 13;
  const checkRow = n => checkTitleY + 26 + (n - 1) * 12.5;
  const billingY = checkRow(6) + 20;
  const billingEnd = billingY + 3 * 13 + 4;

  const ybt = billingEnd + 14;
  const benefitsY0 = ybt + 39;
  let cursor = benefitsY0;
  const benefitY = benefitRows.map(rows => {
    const y = cursor;
    cursor += rows.length * 10 + 2;
    return y;
  });
  const guaranteeY = cursor + 3;
  const benefitsEnd = guaranteeY + 8;

  const noteTop = benefitsEnd + 10;
  const noteH = 11 * noteLines.length + 6;
  const receiptY0 = noteTop + noteH + 13;
  const receiptEnd = receiptY0 + 3 * 14 + 4;
  const signY = receiptEnd + 30;
  const barTop = signY + 22;
  const totalH = barTop + ROW + 14;

  // Escala para que todo quepa en una hoja
  const S = Math.min(1, BOTTOM / totalH);
  const X = v => MID + (v - MID) * S;
  const Y = v => v * S;
  const Wd = v => v * S;
  const FS = v => v * S;

  const setColor = (kind, rgb) =>
    kind === 'fill' ? doc.setFillColor(...rgb) : kind === 'draw' ? doc.setDrawColor(...rgb) : doc.setTextColor(...rgb);

  const fit = (value, maxW) => {
    let out = String(value ?? '');
    const max = Wd(maxW);
    if (doc.getTextWidth(out) <= max) return out;
    while (out.length > 1 && doc.getTextWidth(out + '…') > max) out = out.slice(0, -1);
    return out.trimEnd() + '…';
  };

  /** Texto con centro vertical en y. */
  const text = (value, x, y, o = {}) => {
    const {size = 8, bold = false, color = COLOR.text, align = 'left', maxW, underline = false} = o;
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(FS(size));
    setColor('text', color);
    const str = maxW ? fit(value, maxW) : String(value ?? '');
    doc.text(str, X(x), Y(y), {align, baseline: 'middle'});
    if (underline) {
      const w = doc.getTextWidth(str);
      const x0 = align === 'center' ? X(x) - w / 2 : align === 'right' ? X(x) - w : X(x);
      doc.setLineWidth(0.6 * S);
      setColor('draw', color);
      doc.line(x0, Y(y) + FS(size) * 0.62, x0 + w, Y(y) + FS(size) * 0.62);
    }
  };

  const textRows = (rows, x, y0, lh, size, color = COLOR.text) => {
    rows.forEach((row, index) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(FS(size));
      setColor('text', color);
      doc.text(row, X(x), Y(y0 + index * lh), {baseline: 'middle'});
    });
  };

  const line = (x1, y1, x2, y2, width = 0.6, color = COLOR.black) => {
    doc.setLineWidth(width * S);
    setColor('draw', color);
    doc.line(X(x1), Y(y1), X(x2), Y(y2));
  };

  const rect = (x, y, w, h, {fill, stroke = COLOR.black, width = 0.6} = {}) => {
    doc.setLineWidth(width * S);
    if (fill) setColor('fill', fill);
    if (stroke) setColor('draw', stroke);
    doc.rect(X(x), Y(y), Wd(w), Wd(h), fill && stroke ? 'FD' : fill ? 'F' : 'S');
  };

  const checkbox = (cx, cy, checked, size = 8) => {
    const sz = Wd(size);
    const x = X(cx) - sz / 2;
    const y = Y(cy) - sz / 2;
    doc.setLineWidth(0.7 * S);
    setColor('draw', COLOR.gray);
    doc.roundedRect(x, y, sz, sz, 1.2 * S, 1.2 * S, 'S');
    if (checked) {
      doc.setLineWidth(1.2 * S);
      setColor('draw', COLOR.checkGray);
      doc.line(x + sz * 0.2, y + sz * 0.55, x + sz * 0.42, y + sz * 0.77);
      doc.line(x + sz * 0.42, y + sz * 0.77, x + sz * 0.82, y + sz * 0.25);
    }
  };

  /* ───────────── Encabezado ───────────── */
  if (logo) {
    const w = 125;
    doc.addImage(logo, 'PNG', X(L), Y(26), Wd(w), Wd(w * LOGO_RATIO));
  }

  // Datos del cliente (entre el logo y el medio de contacto)
  const CX = 172;
  const VX = 262;
  text('Atención:', CX, 36, {bold: true});
  text(l.nombre || '—', VX, 36, {maxW: 175});
  text('Teléfono/Celular:', CX, 50, {bold: true});
  text(l.whatsapp || '', VX, 50, {maxW: 120});
  line(VX - 2, 55, VX + 125, 55, 0.5);
  text('Domicilio:', CX, 64, {bold: true});
  text([l.direccion, l.ciudad].filter(Boolean).join(', ') || '—', VX, 64, {maxW: 175});
  text('Fecha de Presupuesto', CX, 78, {bold: true});
  text(formatDate(d.quotedAt) || '—', VX + 10, 78);
  text('E-mail', CX, 92, {bold: true});
  text(l.email || '—', VX, 92, {maxW: 175});

  // Medio de contacto
  const mediaX = R - 130;
  rect(mediaX, 26, 130, ROW);
  text('MEDIO DE CONTACTO', mediaX + 65, 26 + ROW / 2, {bold: true, align: 'center', size: 7.5});
  QUOTE_MEDIA.forEach((item, index) => {
    const y = 26 + ROW + index * ROW;
    rect(mediaX, y, 130, ROW);
    line(mediaX + 90, y, mediaX + 90, y + ROW);
    text(item, mediaX + 2, y + ROW / 2, {size: 7.5});
    checkbox(mediaX + 110, y + ROW / 2, has(l.medio_contacto, item), 7);
  });
  line(L, 112, R, 112, 0.6);

  /* ───────────── Precio / aplicación / tono ───────────── */
  text('Superficie M²', L, 126, {bold: true});
  text(number(d.area), 235, 126, {align: 'right'});
  line(170, 132, 235, 132, 0.5);
  text('Presentación', L, 145, {bold: true});
  text(d.systems.join(', ') || '—', 100, 145, {maxW: 140});
  text('Precio (mxn)', L, 158, {bold: true});
  text(d.pricePerMeter == null ? '—' : money(d.pricePerMeter), 235, 158, {align: 'right'});
  text('Descuento', L, 171, {bold: true});
  text(l.descuento || '—', 100, 171, {maxW: 140});
  text('Destechado M²', L, 184, {bold: true});
  if (d.destechadoArea > 0) text(`${number(d.destechadoArea)} m²`, 100, 184);
  text(money(d.destechadoCost), 235, 184, {align: 'right'});
  text('Distancia', L, 197, {bold: true});
  text(money(l.costo_logistico), 235, 197, {align: 'right'});

  // Tabla Aplicación
  const appX = 322;
  const appCol = appX + 85;
  text('APLICACIÓN', appX + 1, 125, {bold: true, size: 7.5});
  text('SELECCIONAR', appCol + 1, 125, {bold: true, size: 7});
  QUOTE_APPLICATIONS.forEach((item, index) => {
    const y = 131 + index * ROW;
    const checked = has(l.aplicaciones, item);
    rect(appX, y, appCol - appX, ROW, {fill: checked ? COLOR.green : null});
    rect(appCol, y, 452 - appCol, ROW);
    text(item, appX + 2, y + ROW / 2, {size: 7.5, maxW: 81});
    checkbox((appCol + 452) / 2, y + ROW / 2, checked, 7);
  });

  // Tabla Tono de acrílico
  const toneX = 452;
  const toneCol = toneX + 82;
  text('TONO DE ACRÍLICO', toneX + 1, 144, {bold: true, size: 7.5});
  text('SELECCIONAR', toneCol + 1, 144, {bold: true, size: 7});
  const selectedTone = normalizeOption(l.tono_acrilico);
  QUOTE_TONES.forEach((item, index) => {
    const y = 150 + index * ROW;
    const checked = selectedTone === normalizeOption(item);
    rect(toneX, y, toneCol - toneX, ROW, {fill: checked ? COLOR.green : COLOR.pink});
    rect(toneCol, y, R - toneCol, ROW);
    text(item, toneX + 2, y + ROW / 2, {size: 7.5});
    checkbox((toneCol + R) / 2, y + ROW / 2, checked, 7);
  });

  // Totales
  [
    ['APLICACIÓN', money(d.applicationAmount), false],
    ['AGREGADOS', money(d.extras), false],
    ['SUBTOTAL', money(d.subtotal), true],
    ['IVA', money(d.tax), false],
    ['TOTAL', money(d.grandTotal), true],
  ].forEach(([label, value, bold], index) => {
    const y = totalsTop + index * 14;
    rect(150, y, 85, 14);
    text(label, 72, y + 7, {bold: true});
    text(value, 232, y + 7, {align: 'right', bold});
  });
  checkbox(252, totalsTop + 3 * 14 + 7, d.tax > 0, 8);

  // Especificaciones (a la derecha de los totales)
  text('ESPECIFICACIONES', SPEC_X, specHeadY, {bold: true, size: 8.5});
  textRows(specLines, SPEC_X, specY0, SPEC_LH, 8);

  // Detalle por presentación (solo si hay más de una)
  if (multi) {
    const cols = [
      ['Presentación', 90, 'left'],
      ['Superficie', 60, 'right'],
      ['Precio / m²', 70, 'right'],
      ['Tono de acrílico', 90, 'left'],
      ['Destechado', 65, 'right'],
      ['Costo destechado', 85, 'right'],
      ['Importe', 92, 'right'],
    ];
    text('DETALLE POR PRESENTACIÓN', L, tableHeadY, {bold: true, size: 8, underline: true});
    let cx = L;
    const xs = cols.map(([, w]) => {
      const start = cx;
      cx += w;
      return start;
    });
    rect(L, tableTop, R - L, ROW, {fill: [235, 235, 235]});
    cols.forEach(([label, w, align], i) => {
      text(label, align === 'right' ? xs[i] + w - 3 : xs[i] + 3, tableTop + ROW / 2, {bold: true, size: 7.2, align});
    });
    d.lines.forEach((item, index) => {
      const y = tableTop + ROW * (index + 1);
      rect(L, y, R - L, ROW);
      const area = Number(item.area_m2 || 0);
      const unit = Number(item.precio_final_m2 || 0);
      const values = [
        presentationLabel(item.sistema) || '—',
        `${number(area)} m²`,
        money(unit),
        item.tono_acrilico || l.tono_acrilico || '—',
        `${number(item.destechado_m2)} m²`,
        money(item.destechado_monto),
        money(item.monto || area * unit),
      ];
      cols.forEach(([, w, align], i) => {
        text(values[i], align === 'right' ? xs[i] + w - 3 : xs[i] + 3, y + ROW / 2, {size: 7.5, align, maxW: w - 6});
      });
    });
  }

  /* ───────────── Check list ───────────── */
  text('CHECK LIST DE OBSERVACIONES', MID, checkTitleY, {bold: true, align: 'center', size: 8.5});
  const heading = (label, x, w) => {
    text(label, x, checkHeadY, {size: 7});
    line(x - 1, checkHeadY + 5, x + w, checkHeadY + 5, 0.5);
  };
  heading('CONDICIONES DEL TECHO', L, 100);
  heading('SUMINISTROS', 305, 62);
  heading('OBJETOS EN TECHO', 440, 76);

  const cl = (label, x, boxX, y, checked) => {
    text(label, x, y, {size: 7.5});
    checkbox(boxX, y, checked, 7);
  };
  cl('Impermeabilizante Anterior', L, 135, checkRow(1), has(l.condiciones_techo, 'Impermeabilizante anterior'));
  cl('Grietas', L, 135, checkRow(2), has(l.condiciones_techo, 'Grietas'));
  cl('Fugas', L, 135, checkRow(3), has(l.condiciones_techo, 'Fugas'));
  cl('Perforaciones', 175, 255, checkRow(1), has(l.condiciones_techo, 'Perforaciones'));
  cl('Desgaste', 175, 255, checkRow(2), has(l.condiciones_techo, 'Desgaste'));
  cl('Otros', 175, 255, checkRow(3), has(l.condiciones_techo, 'Otros'));
  cl('220v', 305, 385, checkRow(1), has(l.suministros, '220v'));
  cl('Distancia', 305, 385, checkRow(2), has(l.suministros, 'Distancia') || Number(l.costo_logistico) > 0);
  [
    ['AC', 'AC'],
    ['Tinaco', 'Tinaco'],
    ['Antenas', 'Antenas'],
    ['Cables', 'Cables'],
    ['Escombro', 'Escombro'],
    ['Tanque de Gas', 'Tanque de gas'],
  ].forEach(([label, key], index) => cl(label, 440, 535, checkRow(index + 1), has(l.objetos_techo, key)));

  // Observaciones (debajo de las condiciones del techo)
  text('OBSERVACIONES:', L, checkRow(4), {size: 7.5});
  line(L - 1, checkRow(4) + 5, L + 72, checkRow(4) + 5, 0.5);
  textRows(obsLines, 108, checkRow(4), 12.5, 7.5);

  // Datos de facturación
  text('DATOS DE FACTURACIÓN', L, billingY, {size: 7.5});
  line(L - 1, billingY + 5, L + 92, billingY + 5, 0.5);
  [
    [['Razón Social', l.razon_social], ['Correo E', l.correo_facturacion]],
    [['RFC', l.rfc], ['Dirección', l.direccion_facturacion]],
    [['Forma de Pago', l.forma_pago], null],
  ].forEach((pair, index) => {
    const y = billingY + 13 + index * 13;
    pair.forEach((cell, side) => {
      if (!cell) return;
      const x = side === 0 ? L : 305;
      const labelW = side === 0 ? 62 : 44;
      text(cell[0], x, y, {size: 7.5});
      text(cell[1] || '', x + labelW, y, {size: 7.5, maxW: (side === 0 ? 230 : R - 305) - labelW});
      line(x + labelW - 2, y + 5, side === 0 ? 290 : R, y + 5, 0.4, [190, 190, 190]);
    });
  });

  /* ───────────── Beneficios ───────────── */
  text('BENEFICIOS', L, ybt, {bold: true, size: 8.5, underline: true});
  text('Garantiza aislamiento térmico.', L, ybt + 13, {bold: true, size: 8, color: COLOR.navy, underline: true});
  text('Impermeabilización al 100%, eliminación de goteras, filtraciones', L, ybt + 25, {
    bold: true,
    size: 8,
    color: COLOR.navy,
    underline: true,
  });
  benefitRows.forEach((rows, index) => textRows(rows, L + 3, benefitY[index], 10, 8));
  text('GARANTÍA DE POR VIDA', L, guaranteeY, {bold: true, size: 8, underline: true});

  /* ───────────── Nota, recibo, firmas ───────────── */
  rect(L, noteTop, R - L, noteH, {fill: COLOR.yellow, stroke: null});
  textRows(noteLines, L + 3, noteTop + 8, 11, 8, COLOR.red);

  ['RECIBÍ DE:', 'LA CANTIDAD DE:', 'POR CONCEPTO DE:'].forEach((label, index) => {
    const y = receiptY0 + index * 14;
    text(label, L, y, {bold: true, size: 7.5});
    line(115, y + 6, 360, y + 6, 0.7);
  });
  text('Los precios están sujetos a cambio sin previo aviso, por incremento en materia prima.', L, receiptEnd - 2, {size: 7.5});

  line(80, signY, 250, signY, 1);
  text('Dirección Admva / Ventas Thermohouse', 165, signY + 10, {size: 7.5, align: 'center'});
  line(360, signY, 530, signY, 1);
  text('Firma de conformidad de cliente', 445, signY + 10, {size: 7.5, align: 'center'});

  rect(L, barTop, R - L, ROW, {fill: COLOR.orange, stroke: null});
  text('Thermo House Morelos.', L + 2, barTop + ROW + 8, {size: 8, color: COLOR.blue});

  return doc;
}

/* ───────────────────────────── Navegador ───────────────────────────── */

let logoCache;
async function logoDataUrl() {
  if (logoCache) return logoCache;
  const response = await fetch(logoUrl);
  if (!response.ok) throw new Error('No se pudo cargar el logo para la cotización.');
  const blob = await response.blob();
  logoCache = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('No se pudo leer el logo para la cotización.'));
    reader.readAsDataURL(blob);
  });
  return logoCache;
}

export async function downloadQuotePdf(lead) {
  const button = document.querySelector('.quote-preview-actions .btn');
  const originalLabel = button?.textContent;
  const fileName =
    String(lead.folio || lead.nombre || 'cotizacion')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-|-$/g, '') || 'cotizacion';

  if (button) {
    button.setAttribute('disabled', '');
    button.textContent = 'Generando PDF…';
  }

  try {
    const [{jsPDF}, logo] = await Promise.all([import('jspdf'), logoDataUrl()]);
    const doc = new jsPDF({unit: 'pt', format: 'letter', orientation: 'portrait', compress: true});
    drawQuote(doc, lead, logo);
    doc.save(`cotizacion-${fileName}.pdf`);
  } finally {
    if (button) {
      button.removeAttribute('disabled');
      button.textContent = originalLabel;
    }
  }
}