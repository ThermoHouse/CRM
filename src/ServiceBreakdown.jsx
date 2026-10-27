import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {sb} from './supabase';
import logoUrl from './assets/thermo-house-logo.png';
import {downloadBreakdownPdf} from './breakdownPdf';

/* ============================================================
   Desglose de servicios profesionales
   Roles con acceso (definido en App.jsx → ROLE_TABS):
   root, sales (vendedores), administrative y manager (gerente).
   ============================================================ */

const SURFACES = ['Concreto', 'Lámina', 'Pared', 'Cuarto frío', 'Pared tabla roca'];
const TONES = ['Blanco', 'Rojo óxido', 'No aplica'];
const DISPOSAL = [['sitio', 'Se junta en el área indicada por el cliente'], ['retiro', 'Se retira del sitio']];
const POWER = [['', 'Por confirmar'], ['si', 'Sí cuenta con 220V'], ['no', 'No cuenta con 220V']];
const TEMP_POWER = [['', 'Seleccione…'], ['medidor', 'Conexión temporal desde un medidor (con autorización por escrito)'], ['planta', 'Planta de luz']];
const VAT = 0.16;
const DEFAULT_ELECTRICITY_COST_PER_MACHINE_HOUR = 37.5;
const DRAFT_KEY = 'th_service_breakdown_draft_v1';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const num = v => (v === '' || v == null || Number.isNaN(Number(v)) ? 0 : Number(v));
const leadPhone = lead => String(lead?.whatsapp || lead?.telefono || lead?.phone || '').trim();
const empty = v => v === '' || v == null || (Array.isArray(v) && !v.length);
const money = n => '$' + Number(n || 0).toLocaleString('es-MX', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const showDate = v => {
  if (!v) return '';
  const d = new Date(`${String(v).slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-MX', {day: '2-digit', month: 'long', year: 'numeric'});
};
const joinEs = items => {
  const list = items.map(item => String(item).toLowerCase());
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} y ${list[list.length - 1]}`;
};

const blankForm = () => ({
  lead_id: null,
  cliente: '', telefono: '', email: '', domicilio: '', fecha: today(), folio: '', sistema: '',
  trabajos: [],
  superficie_m2: '', superficies: [],
  condiciones: [], objetos: [],
  destechado_incluye: true, destechado_m2: '', destechado_destino: 'sitio',
  grietas_cantidad: '',
  power_220: '', conexion_temporal: '', maquinas: '', kw: '', minutos: 60, costo_maquina_hora: DEFAULT_ELECTRICITY_COST_PER_MACHINE_HOUR, costo_hora: '', distancia_cable: '',
  espesor: '', tono: '',
  h_destechado: '', h_punteado: '', h_aplicacion: '', h_acrilico: '', jornada: 8,
  aplicadores: '', ayudantes: '', supervisores: 1, fecha_inicio: '',
  monto_aplicacion: '', monto_destechado: '', monto_viaticos: '', monto_otros: '', concepto_otros: '', descuento: '', iva_aplica: true,
  notas: '',
});

const PRESENTATION_ALIASES = {FIX: 'TH FIX', LIGHT: 'TH LIGHT', LITE: 'TH LIGHT', FORTE: 'TH FORTE', '3/4': 'TH 3/4', INGLES: 'TH INGLES', 'INGLÉS': 'TH INGLES'};
const FALLBACK_PRODUCTS = [['TH FIX', '1000 micras'], ['TH LIGHT', '1/2 cm (5 mm)'], ['TH FORTE', '1 cm (10 mm)'], ['TH 3/4', '1.9 cm (19 mm)'], ['TH INGLES', '2.5 cm (25 mm)']]
  .map(([id, espesor], orden) => ({id, nombre: id, espesor, orden}));
/** Lleva "Forte", "TH LITE", "lite", etc. al id real de la tabla productos. */
const normalizePresentation = value => {
  const up = String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!up) return '';
  const bare = up.replace(/^TH\s+/, '');
  return PRESENTATION_ALIASES[bare] || (/^TH\s/.test(up) ? up : String(value).trim());
};
const presentationLabel = p => `${p.id === 'TH LIGHT' ? 'TH LITE' : p.nombre || p.id}${p.espesor ? ` · ${p.espesor}` : ''}`;

/** Formularios guardados con la versión anterior (un solo monto de "agregados"). */
function migrateForm(data) {
  const d = {...(data || {})};
  if (d.monto_agregados != null && d.monto_destechado == null && d.monto_viaticos == null && d.monto_otros == null) {
    if (num(d.monto_agregados) > 0) { d.monto_otros = d.monto_agregados; d.concepto_otros = d.agregados_detalle || ''; }
  }
  delete d.monto_agregados; delete d.agregados_detalle;
  const form = {
    ...blankForm(),
    ...d,
    trabajos: Array.isArray(d.trabajos)
      ? d.trabajos.map((work, index) => ({...work, id: work.id || `saved-work-${index}-${Math.random().toString(36).slice(2)}`}))
      : [],
  };
  if (d.costo_maquina_hora == null) {
    form.costo_maquina_hora = num(d.maquinas) > 0 && num(d.costo_hora) > 0
      ? num(d.costo_hora) / num(d.maquinas)
      : DEFAULT_ELECTRICITY_COST_PER_MACHINE_HOUR;
  }
  form.costo_hora = num(form.maquinas) > 0 ? num(form.maquinas) * num(form.costo_maquina_hora) : '';
  return form;
}

const joinParts = parts => parts.filter(p => !empty(p)).join(', ');

/**
 * Datos del lead (y, si existen, de su obra / cierre) que alimentan el desglose.
 * Solo devuelve lo que el cliente sí tiene, para no borrar lo ya capturado.
 *
 *  lead.nombre ................. cliente            lead.whatsapp ............ telefono
 *  lead.email .................. email              lead.direccion+cp+ciudad+estado → domicilio
 *  lead.folio .................. folio              lead.fecha_presupuesto|created_at → fecha
 *  lead.sistema|presentacion ... sistema (productos) lead.area_m2|obra.m2 .... superficie_m2
 *  lead.aplicaciones ........... superficies        lead.tono_acrilico ....... tono
 *  lead.condiciones_techo ...... condiciones        lead.objetos_techo ....... objetos
 *  lead.voltaje|suministros .... power_220          lead.destechado_monto .... monto_destechado
 *  lead.costo_logistico ........ monto_viaticos     lead.subtotal/total/iva .. monto_aplicacion, iva_aplica
 *  lead.descuento .............. descuento          obra.programacion|cierre.fecha_instalacion → fecha_inicio
 */
function fromLead(l, extra = {}) {
  const hasSnapshot = l.subtotal != null && l.iva != null;
  const destechado = num(l.destechado_monto);
  const viaticos = num(l.costo_logistico);
  const subtotal = num(hasSnapshot ? l.subtotal : l.total);
  const byUnit = num(l.precio_final_m2) * num(l.area_m2);
  const aplicacion = subtotal > 0 ? Math.max(0, subtotal - destechado - viaticos) : byUnit > 0 ? byUnit : '';
  const conditions = Array.isArray(l.condiciones_techo) ? l.condiciones_techo : [];
  const supplies = (Array.isArray(l.suministros) ? l.suministros : []).map(v => String(v).toLowerCase());
  const volt = String(l.voltaje || '');
  const power = /220/.test(volt) || supplies.includes('220v') ? 'si' : /1[12][0-9]|\b110\b|\b127\b/.test(volt) ? 'no' : '';
  const area = num(l.area_m2) > 0 ? l.area_m2 : num(extra.obra?.m2) > 0 ? extra.obra.m2 : '';
  const dateSource = l.fecha_presupuesto || l.created_at;
  const out = {
    cliente: l.nombre || '',
    telefono: leadPhone(l),
    email: l.email || '',
    domicilio: joinParts([
      l.direccion || extra.cierre?.direccion || extra.obra?.direccion || l.appointment_location,
      l.cp ? `C.P. ${l.cp}` : '',
      l.ciudad,
      l.estado && !String(l.ciudad || '').includes(l.estado) ? l.estado : '',
    ]),
    fecha: dateSource ? String(dateSource).slice(0, 10) : '',
    folio: l.folio || '',
    sistema: normalizePresentation(l.sistema || l.presentacion),
    superficie_m2: area,
    superficies: Array.isArray(l.aplicaciones) ? l.aplicaciones : [],
    condiciones: conditions,
    objetos: Array.isArray(l.objetos_techo) ? l.objetos_techo : [],
    tono: l.tono_acrilico || '',
    power_220: power,
    descuento: l.descuento || '',
    monto_destechado: destechado > 0 ? destechado : '',
    monto_viaticos: viaticos > 0 ? viaticos : '',
    monto_aplicacion: aplicacion,
    fecha_inicio: String(extra.obra?.programacion || extra.cierre?.fecha_instalacion || '').slice(0, 10),
  };
  // Hay destechado si se cobra o si el techo tiene impermeabilizante anterior / desgaste.
  if (destechado > 0 || conditions.some(c => /impermeabilizante|desgaste/i.test(c))) out.destechado_incluye = true;
  if (l.iva_aplica != null || hasSnapshot) out.iva_aplica = l.iva_aplica != null ? Boolean(l.iva_aplica) : num(l.iva) > 0;
  return Object.fromEntries(Object.entries(out).filter(([k, v]) => k === 'iva_aplica' || k === 'destechado_incluye' || !empty(v)));
}

/** Obra y cierre del cliente (fecha de instalación, m²). Es opcional: si el rol no puede leerlos, se ignora. */
async function fetchLeadExtras(id) {
  const extra = {};
  try {
    const {data, error} = await sb.from('obras').select('programacion,m2,direccion,status').eq('lead_id', id).limit(5);
    if (!error && data?.length) extra.obra = data.find(o => o.status !== 'cancelada') || data[0];
  } catch { /* sin acceso */ }
  try {
    const {data, error} = await sb.from('cierres').select('fecha_instalacion,direccion,status').eq('lead_id', id).neq('status', 'cancelado').limit(1);
    if (!error && data?.length) extra.cierre = data[0];
  } catch { /* sin acceso */ }
  return extra;
}

/** Campos que todavía faltan para que el documento quede completo. */
function pendingFields(f) {
  const list = [];
  const need = (label, value) => { if (empty(value)) list.push(label); };
  need('Cliente', f.cliente);
  need('Domicilio', f.domicilio);
  need('Fecha', f.fecha);
  need('Folio de presupuesto', f.folio);
  need('Presentación / sistema', f.sistema);
  need('Superficie (m²)', f.superficie_m2);
  need('Tipo de superficie', f.superficies);
  if (f.destechado_incluye) need('Superficie de destechado (m²)', f.destechado_m2);
  need('Cantidad de grietas / punteo', f.grietas_cantidad);
  need('Máquinas conectadas a la luz', f.maquinas);
  need('Minutos de encendido', f.minutos);
  need('Costo de electricidad por hora', f.costo_hora);
  (f.trabajos || []).forEach((work, index) => {
    const number = index + 2;
    need(`Trabajo ${number}: presentación / sistema`, work.sistema);
    need(`Trabajo ${number}: superficie (m²)`, work.superficie_m2);
    need(`Trabajo ${number}: espesor`, work.espesor);
    need(`Trabajo ${number}: monto de aplicación`, work.monto_aplicacion);
  });
  if (f.power_220 === 'no') need('Tipo de conexión temporal', f.conexion_temporal);
  need('Distancia de cableado (m)', f.distancia_cable);
  need('Espesor acordado', f.espesor);
  need('Tono del acrílico', f.tono);
  if (f.destechado_incluye) need('Horas de destechado y limpieza', f.h_destechado);
  need('Horas de punteado y sellado', f.h_punteado);
  need('Horas de aplicación de poliuretano', f.h_aplicacion);
  need('Horas de recubrimiento acrílico', f.h_acrilico);
  need('Aplicadores', f.aplicadores);
  need('Ayudantes', f.ayudantes);
  need('Supervisores', f.supervisores);
  need('Fecha tentativa de inicio', f.fecha_inicio);
  need('Monto de aplicación', f.monto_aplicacion);
  return list;
}

/* ---------- Piezas de formulario (fuera del componente para no perder el foco) ---------- */

function Field({label, value, onChange, type = 'text', required = false, hint, wide = false, from = false, children, ...rest}) {
  const missing = required && empty(value);
  return (
    <div className={wide ? 'w' : undefined}>
      <label>{label}{from && <span className="sb-from" title="Dato tomado del cliente vinculado">del cliente</span>}</label>
      {children || <input type={type} value={value ?? ''} onChange={onChange} className={missing ? 'sb-pending' : undefined} {...rest} />}
      {hint && <small className="field-hint">{hint}</small>}
    </div>
  );
}

function CheckGroup({label, options, selected = [], onChange}) {
  return (
    <fieldset className="quote-check-group">
      <legend>{label}</legend>
      <div>
        {options.map(option => (
          <label key={option}>
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={e => onChange(e.target.checked ? [...selected, option] : selected.filter(v => v !== option))}
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/* ---------- Documento (vista previa = lo que se descarga) ---------- */

const Blank = () => <span className="sb-blank" aria-label="por completar" />;
const val = (v, suffix = '') => (empty(v) ? <Blank /> : <>{typeof v === 'number' ? v.toLocaleString('es-MX') : v}{suffix}</>);

function BreakdownDocument({f, totals, docRef, productos}) {
  const works = [{sistema: f.sistema, superficie_m2: f.superficie_m2, espesor: f.espesor, tono: f.tono, monto_aplicacion: f.monto_aplicacion}, ...(f.trabajos || [])];
  const presentationFor = system => {
    const item = productos.find(p => p.id === system);
    return item ? (item.id === 'TH LIGHT' ? 'TH LITE' : item.nombre || item.id) : system;
  };
  const presentations = [...new Set(works.map(work => presentationFor(work.sistema)).filter(Boolean))];
  const totalArea = works.reduce((sum, work) => sum + num(work.superficie_m2), 0);
  const surfaces = f.superficies.length ? joinEs(f.superficies) : null;
  const toneText = f.tono === 'No aplica' ? 'sin tono específico' : f.tono ? f.tono.toLowerCase() : null;
  const connection = f.conexion_temporal === 'medidor'
    ? 'conexión temporal desde un medidor con autorización por escrito'
    : f.conexion_temporal === 'planta' ? 'planta de luz' : null;
  const hours = [f.h_destechado, f.h_punteado, f.h_aplicacion, f.h_acrilico];
  const hasHours = hours.some(h => !empty(h));

  return (
    <article className="sb-doc" ref={docRef}>
      <header className="sb-doc-head">
        <img className="sb-doc-logo" src={logoUrl} alt="ThermoHouse" />
        <div>
          <h1>Descripción detallada del servicio</h1>
          <p>ThermoHouse Morelos · Impermeabilización y aislamiento térmico con poliuretano espreado</p>
        </div>
      </header>

      <div className="sb-meta sb-avoid">
        <div><b>Cliente:</b> {val(f.cliente)}</div>
        <div><b>Presupuesto:</b> {val(f.folio)}</div>
        <div className="sb-meta-wide"><b>Domicilio:</b> {val(f.domicilio)}</div>
        <div><b>Fecha:</b> {showDate(f.fecha) || <Blank />}</div>
        {(f.telefono || f.email) && <div><b>Contacto:</b> {[f.telefono, f.email].filter(Boolean).join(' · ')}</div>}
        {presentations.length > 0 && <div><b>Presentación{presentations.length > 1 ? 'es' : ''}:</b> {presentations.join(', ')}</div>}
      </div>

      <section className="sb-section sb-avoid">
        <h2>1. Objetivo del servicio</h2>
        <p>
          Impermeabilizar y aislar térmicamente {val(totalArea || '', ' m²')} de{' '}
          {surfaces || <Blank />} mediante la aplicación de espuma de poliuretano espreado, con recubrimiento acrílico
          elastomérico reflectivo de protección UV.
        </p>
      </section>

      <section className="sb-section">
        <div className="sb-avoid">
          <h2>2. Trabajos previos a la aplicación</h2>
          <h3>2.1 Destechado</h3>
          {f.destechado_incluye ? (
            <p>
              Retiro del impermeabilizante anterior, material suelto o en mal estado, escombro y cualquier elemento que
              impida que el poliuretano se adhiera directamente a la superficie sólida. Superficie estimada de
              destechado: {val(f.destechado_m2 === '' ? '' : Number(f.destechado_m2), ' m²')}. El material retirado
              {f.destechado_destino === 'retiro' ? ' se retira del sitio.' : ' se junta en el área indicada por el cliente.'}
            </p>
          ) : (
            <p>No se contempla destechado en este servicio.</p>
          )}
        </div>
        <div className="sb-avoid">
          <h3>2.2 Limpieza</h3>
          <p>
            Barrido y limpieza profunda de toda la superficie para eliminar polvo, tierra, grasa y residuos. Si el techo
            presenta humedad, se espera a que seque o se elimina con soplete o deshumidificador antes de continuar,
            porque aplicar sobre una superficie húmeda o sucia es la principal causa de fallas.
          </p>
        </div>
        <div className="sb-avoid">
          <h3>2.3 Revisión y punteado de grietas</h3>
          <p>
            Se revisa todo el techo para localizar grietas, fugas y perforaciones. Cada grieta se marca y se trata de
            forma puntual (punteado) con espuma de poliuretano, cubriendo el largo completo de la grieta y sus
            extremos. Cantidad estimada de puntos o metros lineales: {val(f.grietas_cantidad)}.
          </p>
          {f.condiciones.length > 0 && <p><b>Condiciones registradas del techo:</b> {f.condiciones.join(', ')}.</p>}
        </div>
        <div className="sb-avoid">
          <h3>2.4 Sellado antes de colocar el material</h3>
          <p>
            Una vez limpias y punteadas las grietas, se sellan perímetros, juntas, bases de tinaco, antenas, ductos y
            cualquier perforación, de modo que el material se aplique sobre una superficie continua y estable. No se
            inicia la aplicación hasta que el sellado esté seco y firme.
          </p>
        </div>
        <div className="sb-avoid">
          <h3>2.5 Protección de áreas cercanas</h3>
          <p>
            Se protegen y enmascaran muros colindantes, tinaco, antenas, cables, tanque de gas, aires acondicionados y
            cualquier objeto que no deba recibir producto.
          </p>
          {f.objetos.length > 0 && <p><b>Objetos identificados en el techo:</b> {f.objetos.join(', ')}.</p>}
        </div>
      </section>

      <section className="sb-section">
        <div className="sb-avoid">
          <h2>3. Equipo y conexión eléctrica</h2>
          <ul>
            <li>El equipo de espreado requiere alimentación <b>bifásica 220V (2 fases, 3 hilos)</b>.</li>
            <li><b>Número de máquinas que se conectarán a la luz: {val(f.maquinas === '' ? '' : Number(f.maquinas))}.</b></li>
            {!empty(f.kw) && <li>Consumo estimado por máquina: {val(Number(f.kw), ' kW')}.</li>}
            <li>Tiempo de encendido: {val(f.minutos === '' ? '' : Number(f.minutos), ' minutos')}.</li>
            <li>Costo estimado de electricidad: {num(f.maquinas) > 0 ? money(totals.electricityHourlyCost) : <Blank />} MXN por hora y {!empty(f.minutos) && num(f.maquinas) > 0 ? money(totals.electricityTotalCost) : <Blank />} para el tiempo de encendido indicado. Referencia: {money(f.costo_maquina_hora)} por máquina-hora, calculado con el gasto observado de $150 por 4 horas.</li>
          </ul>
        </div>
        <div className="sb-avoid">
          <ul>
            {f.power_220 === 'si' ? (
              <li>El inmueble cuenta con instalación de 220V; no se requiere conexión temporal.</li>
            ) : (
              <li>
                {f.power_220 === 'no' ? 'Como el inmueble no cuenta con 220V, se utilizará ' : 'Si el inmueble no cuenta con 220V, se utilizará '}
                {connection || <Blank />}.
                {f.conexion_temporal !== 'planta' && ' La conexión usa cableado de calibre adecuado, sin empalmes expuestos, con protección térmica independiente, sin tocar el medidor ni elementos sellados por CFE, y se retira al concluir el trabajo el mismo día.'}
              </li>
            )}
            <li>Distancia de cableado desde la toma hasta el techo: {val(f.distancia_cable === '' ? '' : Number(f.distancia_cable), ' m')}.</li>
          </ul>
        </div>
      </section>

      <section className="sb-section">
        <div className="sb-avoid">
          <h2>4. Procedimiento de aplicación</h2>
          <ol>
            <li><b>Calibración y prueba:</b> se calibra la máquina antes de cada trabajo y se hace una prueba de aplicación para verificar la calidad del material.</li>
            <li>
              <b>Aplicación del poliuretano:</b> el personal, con traje y mascarilla, aplica la espuma de poliuretano
              espreado (isocianato + poliol) en capas uniformes hasta alcanzar los espesores acordados: {joinEs(works.filter(work => work.espesor).map(work => `${presentationFor(work.sistema) || 'Presentación'}: ${work.espesor}`)) || <Blank />}.
            </li>
          </ol>
        </div>
        <ol start={3}>
          <li className="sb-avoid"><b>Revisión de la capa:</b> se verifica que la espuma quede continua, sin huecos, y se corrigen detalles en bordes y puntos de unión.</li>
          <li className="sb-avoid"><b>Curado:</b> el poliuretano cura en pocas horas; durante ese tiempo no debe haber personas ni tránsito en el área.</li>
          <li className="sb-avoid">
            <b>Recubrimiento acrílico:</b> se aplica el recubrimiento acrílico elastomérico base celulosa (32 micras){' '}
            en los tonos acordados para cada trabajo ({joinEs(works.filter(work => work.tono).map(work => `${presentationFor(work.sistema) || 'Presentación'}: ${work.tono === 'No aplica' ? 'sin tono' : work.tono.toLowerCase()}`)) || toneText || <Blank />}), que protege la espuma de los rayos UV y mejora su rendimiento térmico.
          </li>
          <li className="sb-avoid"><b>Limpieza final y entrega:</b> se retiran protecciones y residuos, y se revisa el resultado junto con el cliente.</li>
        </ol>
      </section>

      <section className="sb-section sb-avoid">
        <h2>5. Tiempos y personal</h2>
        <table className="sb-table">
          <thead><tr><th>Etapa</th><th>Duración estimada</th></tr></thead>
          <tbody>
            <tr><td>Destechado y limpieza</td><td>{f.destechado_incluye ? val(f.h_destechado === '' ? '' : Number(f.h_destechado), ' hrs') : 'No aplica'}</td></tr>
            <tr><td>Punteado y sellado de grietas</td><td>{val(f.h_punteado === '' ? '' : Number(f.h_punteado), ' hrs')}</td></tr>
            <tr><td>Aplicación de poliuretano</td><td>{val(f.h_aplicacion === '' ? '' : Number(f.h_aplicacion), ' hrs')}</td></tr>
            <tr><td>Recubrimiento acrílico</td><td>{val(f.h_acrilico === '' ? '' : Number(f.h_acrilico), ' hrs')}</td></tr>
            <tr className="sb-strong"><td>Total en sitio</td><td>{hasHours ? `${totals.hours.toLocaleString('es-MX')} hrs / ${totals.days} ${totals.days === 1 ? 'día' : 'días'}` : <><Blank /> hrs / <Blank /> días</>}</td></tr>
          </tbody>
        </table>
        <p>
          Personal asignado: {val(f.aplicadores === '' ? '' : Number(f.aplicadores))} aplicadores,{' '}
          {val(f.ayudantes === '' ? '' : Number(f.ayudantes))} ayudantes y {val(f.supervisores === '' ? '' : Number(f.supervisores))} supervisor.{' '}
          Fecha tentativa de inicio: {showDate(f.fecha_inicio) || <Blank />}.
        </p>
      </section>

      <section className="sb-section sb-avoid">
        <h2>6. Alcance del presupuesto</h2>
        <p>
          El presupuesto cubre únicamente el suministro y la aplicación de espuma de poliuretano espreado con
          recubrimiento acrílico, incluyendo mano de obra y material, sobre la superficie indicada.{' '}
          {totals.extras > 0 ? (
            <>El presupuesto incluye agregados por <b>{money(totals.extras)}</b> ({totals.extraParts.join(', ')}). </>
          ) : (
            <b>El presupuesto se presenta sin agregados. </b>
          )}
          {f.descuento && <>Descuento aplicado: {f.descuento}. </>}
          Los trabajos y presentaciones incluidos son los que aparecen en la tabla. Cualquier trabajo no listado,
          como reparaciones, retiro adicional de escombro, distancia o maniobras especiales, se cotiza por separado
          y se suma al total solo con autorización del cliente.
        </p>
        <table className="sb-table">
          <thead><tr><th>Trabajo / presentación</th><th>Superficie</th><th>Espesor</th><th>Tono</th><th>Monto (MXN)</th></tr></thead>
          <tbody>{works.map((work, index) => (
            <tr key={work.id || `work-${index}`}>
              <td>{presentationFor(work.sistema) || <Blank />}</td>
              <td>{val(work.superficie_m2 === '' ? '' : Number(work.superficie_m2), ' m²')}</td>
              <td>{val(work.espesor)}</td>
              <td>{work.tono === 'No aplica' ? 'No aplica' : val(work.tono)}</td>
              <td>{empty(work.monto_aplicacion) ? <Blank /> : money(work.monto_aplicacion)}</td>
            </tr>
          ))}</tbody>
        </table>
        <table className="sb-table">
          <thead><tr><th>Concepto</th><th>Monto (MXN)</th></tr></thead>
          <tbody>
            <tr><td>Aplicación</td><td>{empty(totals.application) ? <Blank /> : money(totals.application)}</td></tr>
            <tr><td>Agregados</td><td>{totals.extras > 0 ? money(totals.extras) : '$0 (no incluidos)'}</td></tr>
            <tr><td>Subtotal</td><td>{empty(totals.application) ? <Blank /> : money(totals.subtotal)}</td></tr>
            <tr><td>IVA{f.iva_aplica ? ' (16%)' : ''}</td><td>{empty(totals.application) ? <Blank /> : f.iva_aplica ? money(totals.iva) : 'No aplica'}</td></tr>
            <tr className="sb-strong"><td>Total</td><td>{empty(totals.application) ? <Blank /> : money(totals.total)}</td></tr>
          </tbody>
        </table>
      </section>

      <section className="sb-section sb-avoid">
        <h2>7. Responsabilidades del cliente</h2>
        <ul>
          <li>Dar acceso al techo y a la toma de corriente.</li>
          <li>Retirar objetos del techo o permitir que se retiren.</li>
          <li>No transitar ni permanecer en el área hasta que el producto haya curado.</li>
          <li>Gestionar permisos con la administración, si es condominio o fraccionamiento.</li>
        </ul>
      </section>

      <section className="sb-section sb-avoid">
        <h2>8. Condiciones</h2>
        <p>
          Se requiere anticipo del 50% sobre el total del presupuesto{!empty(totals.application) && totals.total > 0 ? ` (${money(totals.total * 0.5)})` : ''} y
          el pago restante al terminar el trabajo. El servicio cuenta con garantía de por vida. Los precios están
          sujetos a cambio sin previo aviso por incremento en materia prima.
        </p>
        {f.notas && <p><b>Notas adicionales:</b> {f.notas}</p>}
      </section>
    </article>
  );
}

/* ---------- Pantalla principal ---------- */

const loadDraft = () => {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {form: migrateForm(parsed.form), savedId: parsed.savedId || null, mode: parsed.mode || 'manual'};
  } catch { return null; }
};

export default function ServiceBreakdown({initialLead = null}) {
  const draft = useMemo(() => (initialLead ? null : loadDraft()), [initialLead]);
  const [f, setF] = useState(() => draft?.form || {...blankForm(), ...(initialLead ? {lead_id: initialLead.id, ...fromLead(initialLead)} : {})});
  const [mode, setMode] = useState(() => (initialLead ? 'lead' : draft?.mode || 'lead'));
  const [savedId, setSavedId] = useState(draft?.savedId || null);
  const [productos, setProductos] = useState(FALLBACK_PRODUCTS);
  const [linked, setLinked] = useState(() => (initialLead ? Object.keys(fromLead(initialLead)) : []));
  const [extrasNote, setExtrasNote] = useState('');
  const [leads, setLeads] = useState([]);
  const [leadsState, setLeadsState] = useState({loading: true, error: ''});
  const [search, setSearch] = useState('');
  const [saved, setSaved] = useState([]);
  const [savedState, setSavedState] = useState({loading: true, error: '', missingTable: false});
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [message, setMessage] = useState({type: '', text: ''});
  const docRef = useRef(null);

  const set = k => e => setF(c => ({...c, [k]: e.target.value}));
  const L = k => linked.includes(k);
  const setV = (k, v) => setF(c => ({...c, [k]: v}));

  // Conserva el borrador al cambiar de pestaña (solo en esta sesión del navegador).
  useEffect(() => {
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({form: f, savedId, mode})); } catch { /* sin almacenamiento */ }
  }, [f, savedId, mode]);

  useEffect(() => {
    let active = true;
    sb.from('leads').select('*').order('created_at', {ascending: false}).limit(1000).then(({data, error}) => {
      if (!active) return;
      setLeads(data || []);
      setLeadsState({loading: false, error: error?.message || ''});
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    sb.from('productos').select('id,nombre,espesor,orden').order('orden', {ascending: true}).then(({data, error}) => {
      if (active && !error && data?.length) setProductos(data);
    });
    return () => { active = false; };
  }, []);

  // Al abrir desde Leads, completa con la obra / cierre del cliente (fecha de instalación, m²).
  useEffect(() => {
    if (!initialLead) return undefined;
    let active = true;
    fetchLeadExtras(initialLead.id).then(extra => {
      if (!active || (!extra.obra && !extra.cierre)) return;
      const more = fromLead(initialLead, extra);
      setF(c => Object.fromEntries(Object.entries({...c, ...Object.fromEntries(Object.entries(more).filter(([k]) => empty(c[k])))})));
      setLinked(cur => [...new Set([...cur, ...Object.keys(more)])]);
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // El espesor sale de la presentación (tabla productos) mientras no se haya escrito uno propio.
  useEffect(() => {
    const product = productos.find(p => p.id === f.sistema);
    if (!product?.espesor) return;
    setF(c => {
      const auto = empty(c.espesor) || productos.some(p => p.espesor === c.espesor);
      return auto && c.espesor !== product.espesor ? {...c, espesor: product.espesor} : c;
    });
  }, [f.sistema, productos]);

  const loadSaved = useCallback(async () => {
    setSavedState(s => ({...s, loading: true}));
    const {data, error} = await sb.from('service_breakdowns').select('id,lead_id,folio,cliente,data,created_by_email,updated_at').order('updated_at', {ascending: false}).limit(100);
    if (error) {
      const missing = error.code === '42P01' || error.code === 'PGRST205' || /service_breakdowns/.test(error.message || '');
      setSavedState({loading: false, error: missing ? '' : error.message, missingTable: missing});
      return;
    }
    setSaved(data || []);
    setSavedState({loading: false, error: '', missingTable: false});
  }, []);
  useEffect(() => { loadSaved(); }, [loadSaved]);

  const selectedLead = leads.find(l => l.id === f.lead_id) || null;
  const filteredLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter(l => !q || `${l.nombre || ''} ${leadPhone(l)} ${l.folio || ''}`.toLowerCase().includes(q)).slice(0, 60);
  }, [leads, search]);

  const applyLead = async id => {
    const lead = leads.find(l => l.id === id);
    if (!lead) { setV('lead_id', null); setLinked([]); return; }
    const extra = await fetchLeadExtras(lead.id);
    const data = fromLead(lead, extra);
    setF(c => ({...c, lead_id: lead.id, ...data, telefono: leadPhone(lead)}));
    setLinked(Object.keys(data));
    const found = Object.keys(data).length;
    setExtrasNote(extra.obra || extra.cierre ? 'Se incluyó la fecha/obra programada del cliente.' : '');
    setMessage({type: 'ok', text: `Se cargaron ${found} dato(s) de ${lead.nombre}. Completa lo que falte.`});
  };

  const totals = useMemo(() => {
    const application = num(f.monto_aplicacion) + (f.trabajos || []).reduce((sum, work) => sum + num(work.monto_aplicacion), 0);
    const extraParts = [
      num(f.monto_destechado) > 0 && `Destechado ${money(f.monto_destechado)}`,
      num(f.monto_viaticos) > 0 && `Viáticos / distancia ${money(f.monto_viaticos)}`,
      num(f.monto_otros) > 0 && `${f.concepto_otros || 'Otros'} ${money(f.monto_otros)}`,
    ].filter(Boolean);
    const extras = num(f.monto_destechado) + num(f.monto_viaticos) + num(f.monto_otros);
    const subtotal = application + extras;
    const iva = f.iva_aplica ? subtotal * VAT : 0;
    const hours = [f.destechado_incluye ? f.h_destechado : 0, f.h_punteado, f.h_aplicacion, f.h_acrilico].reduce((a, h) => a + num(h), 0);
    const days = Math.max(1, Math.ceil(hours / Math.max(1, num(f.jornada) || 8)));
    const electricityHourlyCost = num(f.maquinas) * num(f.costo_maquina_hora);
    const electricityTotalCost = electricityHourlyCost * num(f.minutos) / 60;
    return {application, electricityHourlyCost, electricityTotalCost, extras, extraParts, subtotal, iva, total: subtotal + iva, hours, days};
  }, [f]);

  const pending = useMemo(() => pendingFields(f), [f]);
  const miss = (k, cond = true) => (cond && empty(f[k]) ? 'sb-pending' : undefined);

  const addWork = () => setV('trabajos', [...(f.trabajos || []), {
    id: `work-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    sistema: '', superficie_m2: '', espesor: '', tono: '', monto_aplicacion: '',
  }]);
  const updateWork = (id, changes) => setV('trabajos', (f.trabajos || []).map(work => work.id === id ? {...work, ...changes} : work));
  const removeWork = id => setV('trabajos', (f.trabajos || []).filter(work => work.id !== id));
  const setMachineCount = event => {
    const maquinas = event.target.value;
    setF(current => ({...current, maquinas, costo_hora: num(maquinas) > 0 ? num(maquinas) * num(current.costo_maquina_hora) : ''}));
  };
  const setMachineHourlyCost = event => {
    const costo_maquina_hora = event.target.value;
    setF(current => ({...current, costo_maquina_hora, costo_hora: num(current.maquinas) > 0 ? num(current.maquinas) * num(costo_maquina_hora) : ''}));
  };

  const download = async () => {
    setMessage({type: '', text: ''});
    if (pending.length && !window.confirm(`Faltan ${pending.length} dato(s). Se dejarán como línea en blanco para llenarlos a mano.\n\n¿Descargar el PDF de todos modos?`)) return;
    setPdfBusy(true);
    try {
      await downloadBreakdownPdf(docRef.current, {name: f.cliente, folio: f.folio});
    } catch (error) {
      setMessage({type: 'error', text: error.message || 'No se pudo generar el PDF.'});
    } finally {
      setPdfBusy(false);
    }
  };

  const save = async () => {
    setMessage({type: '', text: ''});
    if (!f.cliente.trim()) { setMessage({type: 'error', text: 'Escribe o vincula un cliente antes de guardar.'}); return; }
    setBusy(true);
    try {
      const {data: {user}, error: userError} = await sb.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error('La sesión expiró. Inicia sesión de nuevo.');
      const row = {lead_id: f.lead_id || null, folio: f.folio || null, cliente: f.cliente.trim(), data: f};
      if (savedId) {
        const {error} = await sb.from('service_breakdowns').update(row).eq('id', savedId);
        if (error) throw error;
      } else {
        const {data, error} = await sb.from('service_breakdowns').insert({...row, created_by: user.id, created_by_email: user.email}).select('id').single();
        if (error) throw error;
        setSavedId(data.id);
      }
      setMessage({type: 'ok', text: 'Desglose guardado.'});
      await loadSaved();
    } catch (error) {
      const missing = error.code === '42P01' || error.code === 'PGRST205' || /service_breakdowns/.test(error.message || '');
      setMessage({type: 'error', text: missing ? 'Falta aplicar supabase/34_service_breakdowns.sql para poder guardar. Aún puedes descargar el PDF.' : error.message || 'No se pudo guardar.'});
    } finally {
      setBusy(false);
    }
  };

  const openSaved = row => {
    setF(migrateForm(row.data));
    setLinked([]);
    setSavedId(row.id);
    setMode(row.lead_id ? 'lead' : 'manual');
    setMessage({type: 'ok', text: `Desglose de ${row.cliente || 'cliente'} abierto.`});
    window.scrollTo({top: 0, behavior: 'smooth'});
  };

  const removeSaved = async row => {
    if (!window.confirm(`¿Eliminar el desglose de ${row.cliente || 'este cliente'}?`)) return;
    const {error} = await sb.from('service_breakdowns').delete().eq('id', row.id);
    if (error) { setMessage({type: 'error', text: error.message}); return; }
    if (row.id === savedId) setSavedId(null);
    await loadSaved();
  };

  const reset = () => {
    if (!window.confirm('¿Limpiar el formulario y empezar un desglose nuevo?')) return;
    setF(blankForm());
    setLinked([]);
    setSavedId(null);
    setSearch('');
    setMessage({type: '', text: ''});
  };

  return (
    <div className="sb-page">
      <div className="card sb-form">
        <div className="row">
          <h3 style={{flex: 1}}>Desglose de servicios profesionales</h3>
          {savedId && <span className="badge">Guardado</span>}
          <button type="button" className="btn ghost" onClick={reset}>Nuevo</button>
        </div>
        <p className="mut sb-intro">
          Documento para el cliente con el detalle del servicio. Puede acompañar a la cotización o entregarse por separado.
          Vincula un cliente existente para cargar sus datos, o captura todo desde cero.
        </p>

        <fieldset className="sb-group">
          <legend>1 · Cliente</legend>
          <div className="lead-view-toggle" aria-label="Origen del cliente">
            <button type="button" className={mode === 'lead' ? 'active' : ''} aria-pressed={mode === 'lead'} onClick={() => setMode('lead')}>Vincular cliente existente</button>
            <button type="button" className={mode === 'manual' ? 'active' : ''} aria-pressed={mode === 'manual'} onClick={() => setMode('manual')}>Captura manual</button>
          </div>
          {mode === 'lead' && (
            <div className="f sb-lead-picker">
              <Field label="Buscar cliente" wide hint={leadsState.loading ? 'Cargando clientes…' : `${leads.length} cliente(s) disponibles. Busca por nombre, teléfono o folio.`}>
                <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Nombre, teléfono o folio" />
              </Field>
              <Field label="Cliente" wide>
                <select value={f.lead_id || ''} onChange={e => applyLead(e.target.value)}>
                  <option value="">— Selecciona un cliente —</option>
                  {selectedLead && !filteredLeads.some(l => l.id === selectedLead.id) && <option value={selectedLead.id}>{selectedLead.nombre} · {selectedLead.folio}{leadPhone(selectedLead) ? ` · ${leadPhone(selectedLead)}` : ''}</option>}
                  {filteredLeads.map(l => <option key={l.id} value={l.id}>{l.nombre} · {l.folio || 'sin folio'}{leadPhone(l) ? ` · ${leadPhone(l)}` : ''}</option>)}
                </select>
              </Field>
              {leadsState.error && <p className="data-alert w" role="alert">No se pudieron cargar los clientes: {leadsState.error}</p>}
              {f.lead_id && <div className="w"><button type="button" className="btn ghost" onClick={() => setV('lead_id', null)}>Desvincular (conservar datos)</button></div>}
            </div>
          )}
          <div className="f">
            <Field label="Nombre del cliente" value={f.cliente} onChange={set('cliente')} required from={L('cliente')} />
            <Field label="Folio de presupuesto" value={f.folio} onChange={set('folio')} required from={L('folio')} />
            <Field label="Teléfono" value={f.telefono} onChange={set('telefono')} from={L('telefono')} />
            <Field label="Correo" type="email" value={f.email} onChange={set('email')} from={L('email')} />
            <Field label="Domicilio" value={f.domicilio} onChange={set('domicilio')} required wide from={L('domicilio')} />
            <Field label="Fecha del presupuesto" type="date" value={f.fecha} onChange={set('fecha')} required from={L('fecha')} />
            <Field label="Presentación / sistema" from={L('sistema')} hint="Lista de presentaciones del sistema; el espesor se toma de ella.">
              <select value={f.sistema} onChange={set('sistema')} className={miss('sistema')}>
                <option value="">Seleccione…</option>
                {f.sistema && !productos.some(p => p.id === f.sistema) && <option value={f.sistema}>{f.sistema}</option>}
                {productos.map(p => <option key={p.id} value={p.id}>{presentationLabel(p)}</option>)}
              </select>
            </Field>
          </div>
        </fieldset>

        <fieldset className="sb-group">
          <legend>2 · Objetivo y trabajos previos</legend>
          <div className="f">
            <Field label="Superficie a aplicar (m²)" type="number" min="0" step="0.01" value={f.superficie_m2} onChange={set('superficie_m2')} required from={L('superficie_m2')} />
            <div className="w">{L('superficies') && <small className="field-hint">Tipo de superficie tomado del cliente — puedes ajustarlo.</small>}<CheckGroup label="Tipo de superficie" options={SURFACES} selected={f.superficies} onChange={v => setV('superficies', v)} /></div>
            <div className="w">
              <label className="sb-inline-check"><input type="checkbox" checked={f.destechado_incluye} onChange={e => setV('destechado_incluye', e.target.checked)} /><span>Incluye destechado</span></label>
            </div>
            {f.destechado_incluye && <>
              <Field label="Superficie de destechado (m²)" type="number" min="0" step="0.01" value={f.destechado_m2} onChange={set('destechado_m2')} required hint="Depende de la temporada o del descuento aplicado." />
              <Field label="Material retirado">
                <select value={f.destechado_destino} onChange={set('destechado_destino')}>{DISPOSAL.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </Field>
            </>}
            <Field label="Grietas: puntos o metros lineales" value={f.grietas_cantidad} onChange={set('grietas_cantidad')} required placeholder="Ej. 12 puntos / 8 m lineales" wide />
          </div>
        </fieldset>

        <fieldset className="sb-group">
          <legend>3 · Equipo y conexión eléctrica</legend>
          <div className="f">
            <Field label="Máquinas conectadas a la luz" type="number" min="1" step="1" value={f.maquinas} onChange={setMachineCount} required />
            <Field label="Consumo por máquina (kW) · opcional" type="number" min="0" step="0.01" value={f.kw} onChange={set('kw')} hint="Solo informativo; la estimación usa el gasto observado por hora." />
            <Field label="Tiempo de encendido (min)" type="number" min="0" step="1" value={f.minutos} onChange={set('minutos')} required hint="Referencia: 60 minutos." />
            <Field label="Gasto estimado por máquina ($/hora)" type="number" min="0" step="0.01" value={f.costo_maquina_hora} onChange={setMachineHourlyCost} required hint="Regla inicial: $150 ÷ 4 horas = $37.50 por máquina-hora. Ajustable si cambia el costo observado." />
            <Field label="Costo estimado total de electricidad ($/hora)" type="number" value={num(f.maquinas) > 0 ? totals.electricityHourlyCost : ''} disabled hint="Máquinas conectadas × gasto por máquina-hora. El voltaje de 220V por sí solo no determina los kWh." />
            <Field label="Costo estimado para el tiempo de encendido ($)" type="number" value={num(f.maquinas) > 0 && !empty(f.minutos) ? totals.electricityTotalCost : ''} disabled hint="Costo por hora × minutos de encendido ÷ 60. A 4 horas y una máquina: $150." />
            <Field label="Distancia de cableado (m)" type="number" min="0" step="0.1" value={f.distancia_cable} onChange={set('distancia_cable')} required hint="De la toma de corriente al techo." />
            <Field label="¿El inmueble tiene 220V?" from={L('power_220')}>
              <select value={f.power_220} onChange={set('power_220')}>{POWER.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </Field>
            {f.power_220 !== 'si' && (
              <Field label="Si no hay 220V, se usará">
                <select value={f.conexion_temporal} onChange={set('conexion_temporal')} className={f.power_220 === 'no' ? miss('conexion_temporal') : undefined}>{TEMP_POWER.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </Field>
            )}
          </div>
        </fieldset>

        <fieldset className="sb-group">
          <legend>4 · Aplicación</legend>
          <div className="f">
            <Field label="Espesor acordado" value={f.espesor} onChange={set('espesor')} required placeholder="Ej. 1 cm (10 mm)" hint="Se llena con el espesor de la presentación; puedes cambiarlo." />
            <Field label="Tono del acrílico" from={L('tono')}>
              <select value={f.tono} onChange={set('tono')} className={miss('tono')}><option value="">Seleccione…</option>{TONES.map(t => <option key={t}>{t}</option>)}</select>
            </Field>
          </div>
          <div className="sb-extra-works">
            <div className="row"><div style={{flex: 1}}><strong>Otros trabajos o presentaciones para este cliente</strong><p className="mut">Agrega cada sistema adicional con su superficie, espesor, tono y monto. Los trabajos comparten domicilio, preparación, equipo y calendario.</p></div><button type="button" className="btn ghost" onClick={addWork}>+ Agregar trabajo</button></div>
            {(f.trabajos || []).map((work, index) => <div className="sb-work-item" key={work.id}>
              <div className="row"><strong>Trabajo {index + 2}</strong><button type="button" className="btn red" onClick={() => removeWork(work.id)}>Quitar</button></div>
              <div className="f">
                <Field label="Presentación / sistema">
                  <select value={work.sistema} onChange={event => {
                    const selected = productos.find(item => item.id === event.target.value);
                    updateWork(work.id, {sistema: event.target.value, ...(selected?.espesor ? {espesor: selected.espesor} : {})});
                  }}>
                    <option value="">Seleccione…</option>
                    {productos.map(item => <option key={item.id} value={item.id}>{presentationLabel(item)}</option>)}
                  </select>
                </Field>
                <Field label="Superficie (m²)" type="number" min="0" step="0.01" value={work.superficie_m2} onChange={event => updateWork(work.id, {superficie_m2: event.target.value})} />
                <Field label="Espesor acordado" value={work.espesor} onChange={event => updateWork(work.id, {espesor: event.target.value})} />
                <Field label="Tono del acrílico">
                  <select value={work.tono} onChange={event => updateWork(work.id, {tono: event.target.value})}><option value="">Seleccione…</option>{TONES.map(tone => <option key={tone}>{tone}</option>)}</select>
                </Field>
                <Field label="Monto de aplicación ($)" type="number" min="0" step="0.01" value={work.monto_aplicacion} onChange={event => updateWork(work.id, {monto_aplicacion: event.target.value})} />
              </div>
            </div>)}
          </div>
        </fieldset>

        <fieldset className="sb-group">
          <legend>5 · Tiempos y personal</legend>
          <div className="f">
            {f.destechado_incluye && <Field label="Destechado y limpieza (hrs)" type="number" min="0" step="0.5" value={f.h_destechado} onChange={set('h_destechado')} required />}
            <Field label="Punteado y sellado (hrs)" type="number" min="0" step="0.5" value={f.h_punteado} onChange={set('h_punteado')} required />
            <Field label="Aplicación de poliuretano (hrs)" type="number" min="0" step="0.5" value={f.h_aplicacion} onChange={set('h_aplicacion')} required />
            <Field label="Recubrimiento acrílico (hrs)" type="number" min="0" step="0.5" value={f.h_acrilico} onChange={set('h_acrilico')} required />
            <Field label="Jornada (hrs por día)" type="number" min="1" step="0.5" value={f.jornada} onChange={set('jornada')} hint={`Total: ${totals.hours.toLocaleString('es-MX')} hrs ≈ ${totals.days} día(s).`} />
            <Field label="Fecha tentativa de inicio" type="date" value={f.fecha_inicio} onChange={set('fecha_inicio')} required from={L('fecha_inicio')} hint={extrasNote || undefined} />
            <Field label="Aplicadores" type="number" min="0" step="1" value={f.aplicadores} onChange={set('aplicadores')} required />
            <Field label="Ayudantes" type="number" min="0" step="1" value={f.ayudantes} onChange={set('ayudantes')} required />
            <Field label="Supervisores" type="number" min="0" step="1" value={f.supervisores} onChange={set('supervisores')} required />
          </div>
        </fieldset>

        <fieldset className="sb-group">
          <legend>6 · Alcance del presupuesto</legend>
          <div className="f">
            <Field label="Aplicación del trabajo principal ($)" type="number" min="0" step="0.01" value={f.monto_aplicacion} onChange={set('monto_aplicacion')} required from={L('monto_aplicacion')} hint="Poliuretano + acrílico, sin agregados. Se suma con los trabajos adicionales." />
            <Field label="Descuento / promoción" value={f.descuento} onChange={set('descuento')} from={L('descuento')} placeholder="Ej. Temporada" />
            <Field label="Destechado ($)" type="number" min="0" step="0.01" value={f.monto_destechado} onChange={set('monto_destechado')} from={L('monto_destechado')} hint="Déjalo vacío si el destechado no se cobra." />
            <Field label="Viáticos / distancia ($)" type="number" min="0" step="0.01" value={f.monto_viaticos} onChange={set('monto_viaticos')} from={L('monto_viaticos')} />
            <Field label="Otros agregados ($)" type="number" min="0" step="0.01" value={f.monto_otros} onChange={set('monto_otros')} />
            <Field label="Concepto de otros agregados" value={f.concepto_otros} onChange={set('concepto_otros')} placeholder="Ej. Maniobras especiales" />
            <div className="w"><label className="sb-inline-check"><input type="checkbox" checked={f.iva_aplica} onChange={e => setV('iva_aplica', e.target.checked)} /><span>Aplicar IVA (16%)</span></label></div>
          </div>
          <div className="quote-price-summary">
            <span>Agregados<strong>{money(totals.extras)}</strong></span>
            <span>Aplicaciones<strong>{money(totals.application)}</strong></span>
            <span>Subtotal<strong>{money(totals.subtotal)}</strong></span>
            <span>IVA<strong>{money(totals.iva)}</strong></span>
            <span>Total<strong>{money(totals.total)}</strong></span>
          </div>
          <div className="f" style={{marginTop: 10}}>
            <Field label="Notas adicionales (aparecen en el documento)" wide>
              <textarea rows={2} value={f.notas} onChange={set('notas')} />
            </Field>
          </div>
        </fieldset>

        {message.text && <p className={message.type === 'error' ? 'data-alert' : 'panel-feedback'} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</p>}
        {pending.length > 0 && (
          <details className="sb-pending-list">
            <summary>{pending.length} dato(s) pendiente(s) — se imprimen como línea en blanco</summary>
            <ul>{pending.map(p => <li key={p}>{p}</li>)}</ul>
          </details>
        )}
      </div>

      <div className="card sb-preview-card">
        <div className="row sb-actions">
          <h3 style={{flex: 1}}>Vista previa del documento</h3>
          <button type="button" className="btn ghost" disabled={busy} onClick={save}>{busy ? 'Guardando…' : savedId ? 'Actualizar guardado' : 'Guardar'}</button>
          <button type="button" className="btn" disabled={pdfBusy} onClick={download}>{pdfBusy ? 'Generando PDF…' : 'Descargar PDF'}</button>
        </div>
        <div className="sb-preview-scroll">
          <BreakdownDocument f={f} totals={totals} docRef={docRef} productos={productos} />
        </div>
      </div>

      <div className="card tbl sb-saved">
        <h3>Desgloses guardados</h3>
        {savedState.missingTable && <p className="migration-hint" role="status">Para guardar desgloses ejecuta <code>supabase/34_service_breakdowns.sql</code>. Mientras tanto puedes llenar el formulario y descargar el PDF.</p>}
        {savedState.error && <p className="data-alert" role="alert">{savedState.error}</p>}
        {!savedState.missingTable && !savedState.loading && !saved.length && <p className="mut">Aún no hay desgloses guardados.</p>}
        {saved.length > 0 && (
          <table>
            <thead><tr><th>Cliente</th><th>Folio</th><th>Creado por</th><th>Actualizado</th><th>Acciones</th></tr></thead>
            <tbody>
              {saved.map(row => (
                <tr key={row.id}>
                  <td>{row.cliente || '—'}</td>
                  <td>{row.folio || '—'}</td>
                  <td>{row.created_by_email || '—'}</td>
                  <td>{new Date(row.updated_at).toLocaleString('es-MX', {dateStyle: 'short', timeStyle: 'short'})}</td>
                  <td>
                    <button type="button" className="btn ghost" onClick={() => openSaved(row)}>Abrir</button>{' '}
                    <button type="button" className="btn red" onClick={() => removeSaved(row)}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
