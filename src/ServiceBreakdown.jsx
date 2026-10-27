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
const DRAFT_KEY = 'th_service_breakdown_draft_v1';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const num = v => (v === '' || v == null || Number.isNaN(Number(v)) ? 0 : Number(v));
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
  cliente: '', domicilio: '', fecha: today(), folio: '', sistema: '',
  superficie_m2: '', superficies: [],
  condiciones: [], objetos: [],
  destechado_incluye: true, destechado_m2: '', destechado_destino: 'sitio',
  grietas_cantidad: '',
  power_220: '', conexion_temporal: '', maquinas: '', kw: '', minutos: 60, tarifa_kwh: '', costo_hora: '', distancia_cable: '',
  espesor: '', tono: '',
  h_destechado: '', h_punteado: '', h_aplicacion: '', h_acrilico: '', jornada: 8,
  aplicadores: '', ayudantes: '', supervisores: 1, fecha_inicio: '',
  monto_aplicacion: '', monto_agregados: 0, agregados_detalle: '', iva_aplica: true,
  notas: '',
});

/** Datos del lead que alimentan el desglose. Solo devuelve lo que el lead sí tiene. */
function fromLead(l) {
  const hasSnapshot = l.subtotal != null && l.iva != null;
  const extras = num(l.costo_logistico) + num(l.destechado_monto);
  const subtotal = num(hasSnapshot ? l.subtotal : l.total);
  const extraParts = [];
  if (num(l.destechado_monto) > 0) extraParts.push(`Destechado (${money(l.destechado_monto)})`);
  if (num(l.costo_logistico) > 0) extraParts.push(`Viáticos / distancia (${money(l.costo_logistico)})`);
  const out = {
    cliente: l.nombre || '',
    domicilio: [l.direccion, l.ciudad].filter(Boolean).join(', '),
    fecha: l.fecha_presupuesto ? String(l.fecha_presupuesto).slice(0, 10) : '',
    folio: l.folio || '',
    sistema: l.sistema || l.presentacion || '',
    superficie_m2: num(l.area_m2) > 0 ? l.area_m2 : '',
    superficies: Array.isArray(l.aplicaciones) ? l.aplicaciones : [],
    condiciones: Array.isArray(l.condiciones_techo) ? l.condiciones_techo : [],
    objetos: Array.isArray(l.objetos_techo) ? l.objetos_techo : [],
    tono: l.tono_acrilico || '',
    espesor: /FORTE/i.test(l.sistema || l.presentacion || '') ? 'menor de 1 cm (presentación Forte)' : '',
    power_220: /220/.test(String(l.voltaje || '')) ? 'si' : '',
    monto_aplicacion: subtotal > 0 ? Math.max(0, subtotal - extras) : '',
    monto_agregados: extras,
    agregados_detalle: extraParts.join(', '),
    iva_aplica: l.iva_aplica != null ? Boolean(l.iva_aplica) : hasSnapshot ? num(l.iva) > 0 : true,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => !empty(v)));
}

/** Campos que todavía faltan para que el documento quede completo. */
function pendingFields(f) {
  const list = [];
  const need = (label, value) => { if (empty(value)) list.push(label); };
  need('Cliente', f.cliente);
  need('Domicilio', f.domicilio);
  need('Fecha', f.fecha);
  need('Folio de presupuesto', f.folio);
  need('Superficie (m²)', f.superficie_m2);
  need('Tipo de superficie', f.superficies);
  if (f.destechado_incluye) need('Superficie de destechado (m²)', f.destechado_m2);
  need('Cantidad de grietas / punteo', f.grietas_cantidad);
  need('Máquinas conectadas a la luz', f.maquinas);
  need('Consumo por máquina (kW)', f.kw);
  need('Minutos de encendido', f.minutos);
  need('Costo de electricidad por hora', f.costo_hora);
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

function Field({label, value, onChange, type = 'text', required = false, hint, wide = false, children, ...rest}) {
  const missing = required && empty(value);
  return (
    <div className={wide ? 'w' : undefined}>
      <label>{label}</label>
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

function BreakdownDocument({f, totals, docRef}) {
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
        {f.sistema && <div><b>Presentación:</b> {f.sistema}</div>}
      </div>

      <section className="sb-section sb-avoid">
        <h2>1. Objetivo del servicio</h2>
        <p>
          Impermeabilizar y aislar térmicamente {val(f.superficie_m2 === '' ? '' : Number(f.superficie_m2), ' m²')} de{' '}
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
            <li>
              Consumo estimado por máquina: {val(f.kw === '' ? '' : Number(f.kw), ' kW')}. Tiempo de encendido:{' '}
              {val(f.minutos === '' ? '' : Number(f.minutos), ' minutos')} (referencia: 60 minutos).
            </li>
            <li>Costo estimado de electricidad: {empty(f.costo_hora) ? <Blank /> : money(f.costo_hora)} MXN por hora.</li>
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
              espreado (isocianato + poliol) en capas uniformes hasta alcanzar el espesor acordado ({val(f.espesor)}).
            </li>
          </ol>
        </div>
        <ol start={3}>
          <li className="sb-avoid"><b>Revisión de la capa:</b> se verifica que la espuma quede continua, sin huecos, y se corrigen detalles en bordes y puntos de unión.</li>
          <li className="sb-avoid"><b>Curado:</b> el poliuretano cura en pocas horas; durante ese tiempo no debe haber personas ni tránsito en el área.</li>
          <li className="sb-avoid">
            <b>Recubrimiento acrílico:</b> se aplica el recubrimiento acrílico elastomérico base celulosa (32 micras){' '}
            {f.tono === 'No aplica' ? <>({toneText}),</> : <>en tono {toneText || <Blank />},</>} que protege la espuma de los rayos UV y mejora su rendimiento térmico.
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
            <>El presupuesto incluye agregados por <b>{money(totals.extras)}</b>{f.agregados_detalle ? ` (${f.agregados_detalle})` : ''}. </>
          ) : (
            <b>El presupuesto se presenta sin agregados. </b>
          )}
          Cualquier trabajo adicional, como destechado, reparaciones, tratamiento de grietas, retiro de escombro,
          distancia o maniobras especiales, se cotiza por separado y se suma al total solo con autorización del cliente.
        </p>
        <table className="sb-table">
          <thead><tr><th>Concepto</th><th>Monto (MXN)</th></tr></thead>
          <tbody>
            <tr><td>Aplicación</td><td>{empty(f.monto_aplicacion) ? <Blank /> : money(f.monto_aplicacion)}</td></tr>
            <tr><td>Agregados</td><td>{totals.extras > 0 ? money(totals.extras) : '$0 (no incluidos)'}</td></tr>
            <tr><td>Subtotal</td><td>{empty(f.monto_aplicacion) ? <Blank /> : money(totals.subtotal)}</td></tr>
            <tr><td>IVA{f.iva_aplica ? ' (16%)' : ''}</td><td>{empty(f.monto_aplicacion) ? <Blank /> : f.iva_aplica ? money(totals.iva) : 'No aplica'}</td></tr>
            <tr className="sb-strong"><td>Total</td><td>{empty(f.monto_aplicacion) ? <Blank /> : money(totals.total)}</td></tr>
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
          Se requiere anticipo del 50% sobre el total del presupuesto{!empty(f.monto_aplicacion) && totals.total > 0 ? ` (${money(totals.total * 0.5)})` : ''} y
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
    return {form: {...blankForm(), ...parsed.form}, savedId: parsed.savedId || null, mode: parsed.mode || 'manual'};
  } catch { return null; }
};

export default function ServiceBreakdown({initialLead = null}) {
  const draft = useMemo(() => (initialLead ? null : loadDraft()), [initialLead]);
  const [f, setF] = useState(() => draft?.form || {...blankForm(), ...(initialLead ? {lead_id: initialLead.id, ...fromLead(initialLead)} : {})});
  const [mode, setMode] = useState(() => (initialLead ? 'lead' : draft?.mode || 'lead'));
  const [savedId, setSavedId] = useState(draft?.savedId || null);
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
    return leads.filter(l => !q || `${l.nombre || ''} ${l.whatsapp || ''} ${l.folio || ''}`.toLowerCase().includes(q)).slice(0, 60);
  }, [leads, search]);

  const applyLead = id => {
    const lead = leads.find(l => l.id === id);
    if (!lead) { setV('lead_id', null); return; }
    setF(c => ({...c, lead_id: lead.id, ...fromLead(lead)}));
    setMessage({type: 'ok', text: `Datos de ${lead.nombre} cargados. Completa lo que falte.`});
  };

  const totals = useMemo(() => {
    const extras = num(f.monto_agregados);
    const subtotal = num(f.monto_aplicacion) + extras;
    const iva = f.iva_aplica ? subtotal * VAT : 0;
    const hours = [f.destechado_incluye ? f.h_destechado : 0, f.h_punteado, f.h_aplicacion, f.h_acrilico].reduce((a, h) => a + num(h), 0);
    const days = Math.max(1, Math.ceil(hours / Math.max(1, num(f.jornada) || 8)));
    return {extras, subtotal, iva, total: subtotal + iva, hours, days};
  }, [f]);

  const pending = useMemo(() => pendingFields(f), [f]);
  const miss = (k, cond = true) => (cond && empty(f[k]) ? 'sb-pending' : undefined);

  const calcElectricity = () => {
    const value = num(f.maquinas) * num(f.kw) * num(f.tarifa_kwh);
    if (value > 0) setV('costo_hora', Math.round(value * 100) / 100);
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
    setF({...blankForm(), ...row.data});
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
                  {selectedLead && !filteredLeads.some(l => l.id === selectedLead.id) && <option value={selectedLead.id}>{selectedLead.nombre} · {selectedLead.folio}</option>}
                  {filteredLeads.map(l => <option key={l.id} value={l.id}>{l.nombre} · {l.folio || 'sin folio'}{l.whatsapp ? ` · ${l.whatsapp}` : ''}</option>)}
                </select>
              </Field>
              {leadsState.error && <p className="data-alert w" role="alert">No se pudieron cargar los clientes: {leadsState.error}</p>}
              {f.lead_id && <div className="w"><button type="button" className="btn ghost" onClick={() => setV('lead_id', null)}>Desvincular (conservar datos)</button></div>}
            </div>
          )}
          <div className="f">
            <Field label="Nombre del cliente" value={f.cliente} onChange={set('cliente')} required />
            <Field label="Folio de presupuesto" value={f.folio} onChange={set('folio')} required />
            <Field label="Domicilio" value={f.domicilio} onChange={set('domicilio')} required wide />
            <Field label="Fecha" type="date" value={f.fecha} onChange={set('fecha')} required />
            <Field label="Presentación / sistema" value={f.sistema} onChange={set('sistema')} placeholder="Ej. TH FORTE" />
          </div>
        </fieldset>

        <fieldset className="sb-group">
          <legend>2 · Objetivo y trabajos previos</legend>
          <div className="f">
            <Field label="Superficie a aplicar (m²)" type="number" min="0" step="0.01" value={f.superficie_m2} onChange={set('superficie_m2')} required />
            <div className="w"><CheckGroup label="Tipo de superficie" options={SURFACES} selected={f.superficies} onChange={v => setV('superficies', v)} /></div>
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
            <Field label="Máquinas conectadas a la luz" type="number" min="0" step="1" value={f.maquinas} onChange={set('maquinas')} required />
            <Field label="Consumo por máquina (kW)" type="number" min="0" step="0.01" value={f.kw} onChange={set('kw')} required />
            <Field label="Tiempo de encendido (min)" type="number" min="0" step="1" value={f.minutos} onChange={set('minutos')} required hint="Referencia: 60 minutos." />
            <Field label="Tarifa eléctrica ($/kWh) · opcional" type="number" min="0" step="0.01" value={f.tarifa_kwh} onChange={set('tarifa_kwh')} hint="Solo para calcular el costo por hora." />
            <Field label="Costo de electricidad ($ MXN por hora)" type="number" min="0" step="0.01" value={f.costo_hora} onChange={set('costo_hora')} required hint={<button type="button" className="sb-link" onClick={calcElectricity} disabled={!(num(f.maquinas) && num(f.kw) && num(f.tarifa_kwh))}>Calcular: máquinas × kW × tarifa</button>} />
            <Field label="Distancia de cableado (m)" type="number" min="0" step="0.1" value={f.distancia_cable} onChange={set('distancia_cable')} required hint="De la toma de corriente al techo." />
            <Field label="¿El inmueble tiene 220V?">
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
            <Field label="Espesor acordado" value={f.espesor} onChange={set('espesor')} required placeholder="Ej. 1 pulgada" hint="TH Forte: menor de 1 cm." />
            <Field label="Tono del acrílico">
              <select value={f.tono} onChange={set('tono')} className={miss('tono')}><option value="">Seleccione…</option>{TONES.map(t => <option key={t}>{t}</option>)}</select>
            </Field>
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
            <Field label="Fecha tentativa de inicio" type="date" value={f.fecha_inicio} onChange={set('fecha_inicio')} required />
            <Field label="Aplicadores" type="number" min="0" step="1" value={f.aplicadores} onChange={set('aplicadores')} required />
            <Field label="Ayudantes" type="number" min="0" step="1" value={f.ayudantes} onChange={set('ayudantes')} required />
            <Field label="Supervisores" type="number" min="0" step="1" value={f.supervisores} onChange={set('supervisores')} required />
          </div>
        </fieldset>

        <fieldset className="sb-group">
          <legend>6 · Alcance del presupuesto</legend>
          <div className="f">
            <Field label="Aplicación ($)" type="number" min="0" step="0.01" value={f.monto_aplicacion} onChange={set('monto_aplicacion')} required />
            <Field label="Agregados ($)" type="number" min="0" step="0.01" value={f.monto_agregados} onChange={set('monto_agregados')} hint="Deja en 0 si el presupuesto va sin agregados." />
            <Field label="Concepto de los agregados" value={f.agregados_detalle} onChange={set('agregados_detalle')} wide placeholder="Ej. Destechado, viáticos" />
            <div className="w"><label className="sb-inline-check"><input type="checkbox" checked={f.iva_aplica} onChange={e => setV('iva_aplica', e.target.checked)} /><span>Aplicar IVA (16%)</span></label></div>
          </div>
          <div className="quote-price-summary">
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
          <BreakdownDocument f={f} totals={totals} docRef={docRef} />
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
