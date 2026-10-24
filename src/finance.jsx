import {useCallback,useEffect,useState} from 'react';
import {sb} from './supabase';

/* ---------- utilidades ---------- */
const money=n=>'$'+Number(n||0).toLocaleString('es-MX',{minimumFractionDigits:0,maximumFractionDigits:2});
const monthKey=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
const todayInput=()=>{const now=new Date();return `${monthKey(now)}-${String(now.getDate()).padStart(2,'0')}`};
const showDate=value=>value?String(value).slice(0,10).split('-').reverse().join('/'):'—';
const monthRange=month=>{const[year,mon]=month.split('-').map(Number);const next=mon===12?`${year+1}-01-01`:`${year}-${String(mon+1).padStart(2,'0')}-01`;return[`${month}-01`,next]};
const sum=(rows,pick)=>rows.reduce((total,row)=>total+Number(pick(row)||0),0);
const METODOS=[['efectivo','Efectivo'],['transferencia','Transferencia'],['tarjeta','Tarjeta'],['cheque','Cheque'],['caja_chica','Caja chica'],['otro','Otro']];
const CAJA_TIPOS=[['reposicion','Reposición de caja'],['viatico','Viático a técnico'],['gasto','Gasto de caja'],['devolucion','Devolución de sobrante']];
const ORIGEN_LABEL={manual:'Manual',anticipo:'Anticipo',caja_chica:'Caja chica'};

const csvCell=value=>{let text=String(value??'');if(/^[=+\-@]/.test(text)&&Number.isNaN(Number(text)))text="'"+text;return /[",\r\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text};
function downloadCsv(name,header,rows){const text=[header,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n');const blob=new Blob(['\ufeff'+text],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url)}

function useQuery(run,deps){
  const[data,setData]=useState([]);const[state,setState]=useState({loading:true,error:''});
  const load=useCallback(async()=>{setState(current=>({...current,loading:true,error:''}));try{const{data:rows,error}=await run();if(error)throw error;setData(rows||[]);setState({loading:false,error:''})}catch(error){setState({loading:false,error:error.message||'No se pudieron cargar los datos.'})}},deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{load()},[load]);
  return[data,load,state];
}

const Feedback=({state,empty})=>state.error?<p className="data-alert" role="alert">{state.error}</p>:state.loading?<p className="mut">Cargando…</p>:empty?<p className="mut">{empty}</p>:null;
const Kpi=({label,value,tone})=><div className={'card kpi'+(tone?' '+tone:'')}><span className="lbl">{label}</span><strong className="big">{value}</strong></div>;

async function exportMonthCsv(month){
  const[from,to]=monthRange(month);
  const{data,error}=await sb.from('movimientos_financieros').select('*, finanzas_categorias(nombre,naturaleza)').gte('fecha',from).lt('fecha',to).order('fecha');
  if(error)throw error;
  if(!data.length)throw new Error('No hay movimientos en ese mes.');
  downloadCsv(`ingresos-egresos-${month}.csv`,['Fecha','Tipo','Categoría','Fijo/Variable','Concepto','Monto','Plaza','Método de pago','Origen','Comprobante'],
    data.map(row=>[row.fecha,row.tipo==='ingreso'?'Ingreso':'Egreso',row.finanzas_categorias?.nombre||'',row.finanzas_categorias?.naturaleza||'',row.concepto||'',Number(row.monto),row.plaza,METODOS.find(([value])=>value===row.metodo_pago)?.[1]||'',ORIGEN_LABEL[row.origen]||row.origen,row.comprobante_path?'Sí':'No']));
}

/* ---------- Cierres de venta (Administrativo) ---------- */
function ClosingForm({cierre,onClose,onDone}){
  const lead=cierre.leads||{};
  const[anticipo,setAnticipo]=useState('recibido');const[monto,setMonto]=useState('');const[motivo,setMotivo]=useState('');
  const[metodo,setMetodo]=useState('transferencia');const[fecha,setFecha]=useState(()=>{const at=cierre.leads?.appointment_at;if(!at)return'';const d=new Date(at);return Number.isNaN(d.getTime())?'':`${monthKey(d)}-${String(d.getDate()).padStart(2,'0')}`});
  const[direccion,setDireccion]=useState(cierre.direccion||'');const[notas,setNotas]=useState('');const[busy,setBusy]=useState(false);const[error,setError]=useState('');
  const submit=async event=>{event.preventDefault();setError('');setBusy(true);try{
    const{error:rpcError}=await sb.rpc('confirm_closing',{p_cierre_id:cierre.id,p_anticipo_status:anticipo,p_anticipo_monto:anticipo==='recibido'?Number(monto):null,p_anticipo_motivo:anticipo==='perdonado'?motivo:null,p_metodo_pago:anticipo==='recibido'?metodo:null,p_fecha_instalacion:fecha||null,p_direccion:direccion,p_notas:notas});
    if(rpcError)throw rpcError;await onDone()}catch(err){setError(err.message||'No se pudo confirmar el cierre.')}finally{setBusy(false)}};
  return <div className="modal"><form className="card appointment-form" onSubmit={submit}>
    <div className="row"><h3 style={{flex:1}}>Confirmar cierre y agenda</h3><button type="button" className="btn ghost" disabled={busy} onClick={onClose}>✕</button></div>
    <p className="mut">{lead.nombre||'Cliente'}{lead.whatsapp?` · ${lead.whatsapp}`:''} · Total cotizado {money(lead.total)}</p>
    <label htmlFor="cl-fecha">Fecha de instalación (agenda)</label><input id="cl-fecha" type="date" required value={fecha} onChange={e=>setFecha(e.target.value)}/>
    <label htmlFor="cl-dir">Dirección de la obra</label><input id="cl-dir" value={direccion} onChange={e=>setDireccion(e.target.value)} placeholder="Dirección o zona de servicio"/>
    <label htmlFor="cl-ant">Anticipo</label>
    <select id="cl-ant" value={anticipo} onChange={e=>setAnticipo(e.target.value)}><option value="recibido">Recibido</option><option value="perdonado">Perdonado (el cliente no da anticipo)</option><option value="pendiente">Pendiente (aún no se cobra)</option></select>
    {anticipo==='recibido'&&<><label htmlFor="cl-monto">Monto del anticipo</label><input id="cl-monto" type="number" min="0.01" step="0.01" required value={monto} onChange={e=>setMonto(e.target.value)}/>
      <label htmlFor="cl-metodo">Método de pago</label><select id="cl-metodo" value={metodo} onChange={e=>setMetodo(e.target.value)}>{METODOS.filter(([value])=>value!=='caja_chica').map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></>}
    {anticipo==='perdonado'&&<><label htmlFor="cl-motivo">Motivo</label><input id="cl-motivo" required maxLength={200} value={motivo} onChange={e=>setMotivo(e.target.value)} placeholder="Ej. desconfianza por seguridad, cliente recurrente…"/></>}
    <label htmlFor="cl-notas">Notas <span>(opcional)</span></label><textarea id="cl-notas" maxLength={500} value={notas} onChange={e=>setNotas(e.target.value)}/>
    {error&&<p className="data-alert" role="alert">{error}</p>}
    <p className="mut">Al confirmar se crea la aplicación en Instalaciones{anticipo==='recibido'?' y el anticipo se registra como ingreso en el libro':''}.</p>
    <div className="row"><button className="btn" type="submit" disabled={busy}>{busy?'Confirmando…':'Confirmar cierre'}</button><button className="btn ghost" type="button" disabled={busy} onClick={onClose}>Cancelar</button></div>
  </form></div>;
}

export function Cierres({readOnly=false}){
  const[rows,load,state]=useQuery(()=>sb.from('cierres').select('*, leads(nombre,whatsapp,asesor,folio,total,area_m2,sistema,appointment_at)').order('created_at',{ascending:false}),[]);
  const[active,setActive]=useState(null);const[busyId,setBusyId]=useState(null);const[error,setError]=useState('');
  const pending=rows.filter(row=>row.status==='pendiente');const history=rows.filter(row=>row.status!=='pendiente');
  const cancel=async row=>{const reason=prompt('Motivo de la cancelación (opcional):');if(reason===null)return;setError('');setBusyId(row.id);try{const{error:rpcError}=await sb.rpc('cancel_closing',{p_cierre_id:row.id,p_motivo:reason});if(rpcError)throw rpcError;await load()}catch(err){setError(err.message||'No se pudo cancelar.')}finally{setBusyId(null)}};
  const anticipoText=row=>row.anticipo_status==='recibido'?`Recibido ${money(row.anticipo_monto)}`:row.anticipo_status==='perdonado'?`Perdonado · ${row.anticipo_motivo||''}`:'Pendiente';
  return <div className="finance-stack">
    <div className="card tbl"><div className="row"><div style={{flex:1}}><span className="lbl">Ventas cerradas</span><h3>Por confirmar ({pending.length})</h3></div></div>
      <p className="mut">Al cerrar una venta, el vendedor la envía aquí. Confirma la agenda y el anticipo para que aparezca en Instalaciones.</p>
      {error&&<p className="data-alert" role="alert">{error}</p>}<Feedback state={state} empty={!pending.length&&'No hay cierres pendientes.'}/>
      {pending.length>0&&<table><thead><tr><th>Cliente</th><th>Vendedor</th><th>Total</th><th>m²</th><th>Cerrada</th>{!readOnly&&<th>Acciones</th>}</tr></thead><tbody>{pending.map(row=><tr key={row.id}>
        <td><strong>{row.leads?.nombre||'Sin nombre'}</strong><div className="mut">{row.leads?.whatsapp||''}</div></td><td>{row.leads?.asesor||'Sin asignar'}</td><td>{money(row.leads?.total)}</td><td>{row.leads?.area_m2||'—'}</td><td>{showDate(row.created_at)}</td>
        {!readOnly&&<td><button type="button" className="btn" disabled={busyId===row.id} onClick={()=>setActive(row)}>Confirmar y agendar</button> <button type="button" className="btn ghost" disabled={busyId===row.id} onClick={()=>cancel(row)}>Cancelar</button></td>}</tr>)}</tbody></table>}
    </div>
    <div className="card tbl"><h3>Historial de cierres</h3><Feedback state={{loading:false,error:''}} empty={!history.length&&'Aún no hay cierres confirmados.'}/>
      {history.length>0&&<table><thead><tr><th>Cliente</th><th>Estado</th><th>Anticipo</th><th>Instalación</th><th>Confirmado</th></tr></thead><tbody>{history.map(row=><tr key={row.id}><td>{row.leads?.nombre||'—'}</td><td><span className={'pill '+(row.status==='confirmado'?'confirmado':'no')}>{row.status}</span></td><td>{row.status==='confirmado'?anticipoText(row):'—'}</td><td>{showDate(row.fecha_instalacion)}</td><td>{showDate(row.confirmado_at)}</td></tr>)}</tbody></table>}
    </div>
    {active&&<ClosingForm cierre={active} onClose={()=>setActive(null)} onDone={async()=>{setActive(null);await load()}}/>}
  </div>;
}

/* ---------- Libro de ingresos y egresos ---------- */
function MovementForm({categorias,plazas,initial,onClose,onSaved}){
  const editing=Boolean(initial?.id);
  const[form,setForm]=useState(()=>({fecha:initial?.fecha||todayInput(),tipo:initial?.tipo||'egreso',categoria_id:initial?.categoria_id||'',monto:initial?.monto??'',concepto:initial?.concepto||'',plaza:initial?.plaza||plazas[0]||'Morelos',metodo_pago:initial?.metodo_pago||''}));
  const[file,setFile]=useState(null);const[busy,setBusy]=useState(false);const[error,setError]=useState('');
  const options=categorias.filter(item=>item.tipo===form.tipo&&(item.activa||item.id===form.categoria_id));
  const set=key=>event=>setForm(current=>({...current,[key]:event.target.value,...(key==='tipo'?{categoria_id:''}:{})}));
  const save=async event=>{event.preventDefault();setError('');setBusy(true);let uploaded=null;try{
    if(file){const safe=file.name.replace(/[^\w.\-]+/g,'_').slice(-80);uploaded=`${form.fecha.slice(0,7)}/${Date.now()}-${safe}`;const{error:uploadError}=await sb.storage.from('comprobantes').upload(uploaded,file,{contentType:file.type});if(uploadError)throw uploadError}
    const row={fecha:form.fecha,tipo:form.tipo,categoria_id:form.categoria_id,monto:Number(form.monto),concepto:form.concepto.trim()||null,plaza:form.plaza,metodo_pago:form.metodo_pago||null,...(uploaded?{comprobante_path:uploaded}:{})};
    const{error:saveError}=editing?await sb.from('movimientos_financieros').update(row).eq('id',initial.id):await sb.from('movimientos_financieros').insert(row);
    if(saveError)throw saveError;await onSaved()}catch(err){if(uploaded)await sb.storage.from('comprobantes').remove([uploaded]);setError(err.message||'No se pudo guardar el movimiento.')}finally{setBusy(false)}};
  return <div className="modal"><form className="card appointment-form" onSubmit={save}>
    <div className="row"><h3 style={{flex:1}}>{editing?'Editar movimiento':'Nuevo movimiento'}</h3><button type="button" className="btn ghost" disabled={busy} onClick={onClose}>✕</button></div>
    <label htmlFor="mv-tipo">Tipo</label><select id="mv-tipo" value={form.tipo} onChange={set('tipo')}><option value="egreso">Egreso (salida)</option><option value="ingreso">Ingreso (entrada)</option></select>
    <label htmlFor="mv-cat">Categoría</label><select id="mv-cat" required value={form.categoria_id} onChange={set('categoria_id')}><option value="">Elige una categoría</option>{options.map(item=><option key={item.id} value={item.id}>{item.nombre} · {item.naturaleza}</option>)}</select>
    <label htmlFor="mv-fecha">Fecha</label><input id="mv-fecha" type="date" required value={form.fecha} onChange={set('fecha')}/>
    <label htmlFor="mv-monto">Monto</label><input id="mv-monto" type="number" min="0.01" step="0.01" required value={form.monto} onChange={set('monto')}/>
    <label htmlFor="mv-con">Concepto</label><input id="mv-con" maxLength={200} value={form.concepto} onChange={set('concepto')} placeholder="Ej. compra de guantes, renta de bodega…"/>
    <label htmlFor="mv-plaza">Plaza</label><select id="mv-plaza" value={form.plaza} onChange={set('plaza')}>{plazas.map(name=><option key={name}>{name}</option>)}</select>
    <label htmlFor="mv-metodo">Método de pago <span>(opcional)</span></label><select id="mv-metodo" value={form.metodo_pago} onChange={set('metodo_pago')}><option value="">—</option>{METODOS.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
    <label htmlFor="mv-file">Foto o PDF del comprobante <span>(opcional)</span></label><input id="mv-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e=>setFile(e.target.files?.[0]||null)}/>
    {initial?.comprobante_path&&!file&&<small className="field-hint">Ya tiene un comprobante; si subes otro lo reemplaza.</small>}
    {error&&<p className="data-alert" role="alert">{error}</p>}
    <div className="row"><button className="btn" type="submit" disabled={busy}>{busy?'Guardando…':'Guardar'}</button><button className="btn ghost" type="button" disabled={busy} onClick={onClose}>Cancelar</button></div>
  </form></div>;
}

function Libro({readOnly,canDelete}){
  const[month,setMonth]=useState(monthKey());
  const[categorias]=useQuery(()=>sb.from('finanzas_categorias').select('*').order('nombre'),[]);
  const[plazaRows]=useQuery(()=>sb.from('plazas').select('nombre').eq('activa',true).order('nombre'),[]);
  const[rows,load,state]=useQuery(()=>{const[from,to]=monthRange(month);return sb.from('movimientos_financieros').select('*, finanzas_categorias(nombre,naturaleza)').gte('fecha',from).lt('fecha',to).order('fecha',{ascending:false}).order('created_at',{ascending:false})},[month]);
  const[form,setForm]=useState(null);const[error,setError]=useState('');const[busy,setBusy]=useState(false);
  const plazas=plazaRows.length?plazaRows.map(item=>item.nombre):['Morelos'];
  const income=sum(rows.filter(row=>row.tipo==='ingreso'),row=>row.monto);const expenses=sum(rows.filter(row=>row.tipo==='egreso'),row=>row.monto);
  const openReceipt=async path=>{setError('');const{data,error:urlError}=await sb.storage.from('comprobantes').createSignedUrl(path,120);if(urlError||!data?.signedUrl){setError(urlError?.message||'No se pudo abrir el comprobante.');return}window.open(data.signedUrl,'_blank','noopener')};
  const remove=async row=>{if(!confirm('¿Eliminar este movimiento?'))return;setError('');setBusy(true);try{const{error:deleteError}=await sb.from('movimientos_financieros').delete().eq('id',row.id);if(deleteError)throw deleteError;if(row.comprobante_path)await sb.storage.from('comprobantes').remove([row.comprobante_path]);await load()}catch(err){setError(err.message||'No se pudo eliminar.')}finally{setBusy(false)}};
  const exportCsv=async()=>{setError('');setBusy(true);try{await exportMonthCsv(month)}catch(err){setError(err.message)}finally{setBusy(false)}};
  return <div className="card tbl">
    <div className="row"><div style={{flex:1}}><span className="lbl">Libro</span><h3>Ingresos y egresos</h3></div><input type="month" aria-label="Mes" value={month} onChange={e=>e.target.value&&setMonth(e.target.value)}/><button type="button" className="btn ghost" disabled={busy} onClick={exportCsv}>Descargar para el contador (CSV)</button>{!readOnly&&<button type="button" className="btn" onClick={()=>setForm({})}>+ Movimiento</button>}</div>
    <div className="grid kpi-grid"><Kpi label="Ingresos" value={money(income)} tone="ok"/><Kpi label="Egresos" value={money(expenses)} tone="bad"/><Kpi label="Balance" value={money(income-expenses)} tone={income-expenses<0?'bad':'ok'}/></div>
    {error&&<p className="data-alert" role="alert">{error}</p>}<Feedback state={state} empty={!rows.length&&'No hay movimientos en este mes.'}/>
    {rows.length>0&&<table><thead><tr><th>Fecha</th><th>Categoría</th><th>Concepto</th><th>Monto</th><th>Origen</th><th>Comprobante</th>{(!readOnly||canDelete)&&<th>Acciones</th>}</tr></thead><tbody>{rows.map(row=><tr key={row.id}>
      <td>{showDate(row.fecha)}</td><td>{row.finanzas_categorias?.nombre||'—'}<div className="mut">{row.finanzas_categorias?.naturaleza||''}</div></td><td>{row.concepto||'—'}</td>
      <td className={row.tipo==='ingreso'?'amount-in':'amount-out'}>{row.tipo==='ingreso'?'+':'−'}{money(row.monto)}</td><td>{ORIGEN_LABEL[row.origen]||row.origen}</td>
      <td>{row.comprobante_path?<button type="button" className="btn ghost" onClick={()=>openReceipt(row.comprobante_path)}>Ver</button>:<span className="mut">—</span>}</td>
      {(!readOnly||canDelete)&&<td>{!readOnly&&(row.origen==='manual'||canDelete)&&<button type="button" className="btn ghost" disabled={busy} onClick={()=>setForm(row)}>Editar</button>} {canDelete&&<button type="button" className="btn red" disabled={busy} onClick={()=>remove(row)}>Eliminar</button>}</td>}</tr>)}</tbody></table>}
    {form&&<MovementForm categorias={categorias} plazas={plazas} initial={form.id?form:null} onClose={()=>setForm(null)} onSaved={async()=>{setForm(null);await load()}}/>}
  </div>;
}

/* ---------- Caja chica y viáticos ---------- */
function CajaChica({readOnly,canDelete}){
  const[saldos,loadSaldos]=useQuery(()=>sb.from('caja_chica_saldo').select('*'),[]);
  const[rows,load,state]=useQuery(()=>sb.from('caja_chica_movimientos').select('*').order('fecha',{ascending:false}).order('created_at',{ascending:false}).limit(200),[]);
  const[categorias]=useQuery(()=>sb.from('finanzas_categorias').select('id,nombre,tipo,activa').eq('tipo','egreso').eq('activa',true).order('nombre'),[]);
  const[obras]=useQuery(()=>sb.from('obras').select('id,folio,cliente').order('programacion',{ascending:false}).limit(100),[]);
  const[plazaRows]=useQuery(()=>sb.from('plazas').select('nombre').eq('activa',true).order('nombre'),[]);
  const plazas=plazaRows.length?plazaRows.map(item=>item.nombre):['Morelos'];
  const blank=()=>({tipo:'viatico',fecha:todayInput(),monto:'',tecnico:'',obra_id:'',categoria_id:'',concepto:'',plaza:plazas[0]});
  const[form,setForm]=useState(null);const[busy,setBusy]=useState(false);const[error,setError]=useState('');
  const set=key=>event=>setForm(current=>({...current,[key]:event.target.value}));
  const reload=async()=>{await Promise.all([load(),loadSaldos()])};
  const save=async event=>{event.preventDefault();setError('');setBusy(true);try{
    const row={tipo:form.tipo,fecha:form.fecha,monto:Number(form.monto),tecnico:form.tecnico.trim()||null,obra_id:form.obra_id||null,categoria_id:form.tipo==='gasto'&&form.categoria_id?form.categoria_id:null,concepto:form.concepto.trim()||null,plaza:form.plaza||plazas[0]};
    const{error:insertError}=await sb.from('caja_chica_movimientos').insert(row);if(insertError)throw insertError;setForm(null);await reload()}catch(err){setError(err.message||'No se pudo registrar el movimiento.')}finally{setBusy(false)}};
  const remove=async row=>{if(!confirm('¿Eliminar este movimiento? También se quita del libro.'))return;setError('');setBusy(true);try{const{error:deleteError}=await sb.from('caja_chica_movimientos').delete().eq('id',row.id);if(deleteError)throw deleteError;await reload()}catch(err){setError(err.message||'No se pudo eliminar.')}finally{setBusy(false)}};
  const perTech=Object.entries(rows.filter(row=>row.tipo==='viatico').reduce((acc,row)=>{const key=row.tecnico||'Sin nombre';acc[key]=(acc[key]||0)+Number(row.monto);return acc},{})).sort((a,b)=>b[1]-a[1]);
  const label=type=>CAJA_TIPOS.find(([value])=>value===type)?.[1]||type;
  return <div className="finance-stack">
    <div className="card"><div className="row"><div style={{flex:1}}><span className="lbl">Caja chica</span><h3>Saldo disponible</h3></div>{!readOnly&&<button type="button" className="btn" onClick={()=>setForm(blank())}>+ Movimiento de caja</button>}</div>
      <div className="grid kpi-grid">{saldos.length?saldos.map(item=><Kpi key={item.plaza} label={`Saldo · ${item.plaza}`} value={money(item.saldo)} tone={Number(item.saldo)<0?'bad':'ok'}/>):<Kpi label="Saldo" value={money(0)}/>}
        <Kpi label="Viáticos entregados" value={money(sum(saldos,item=>item.viaticos))}/><Kpi label="Gastos de caja" value={money(sum(saldos,item=>item.gastos))}/></div>
      <p className="mut">La reposición y la devolución mueven dinero a la caja. Los viáticos y gastos salen de la caja y se registran solos como egreso en el libro.</p></div>
    {perTech.length>0&&<div className="card tbl"><h3>Viáticos por técnico</h3><table><thead><tr><th>Técnico</th><th>Total entregado</th></tr></thead><tbody>{perTech.map(([name,total])=><tr key={name}><td>{name}</td><td>{money(total)}</td></tr>)}</tbody></table></div>}
    <div className="card tbl"><h3>Movimientos recientes</h3>{error&&<p className="data-alert" role="alert">{error}</p>}<Feedback state={state} empty={!rows.length&&'Aún no hay movimientos de caja.'}/>
      {rows.length>0&&<table><thead><tr><th>Fecha</th><th>Tipo</th><th>Técnico</th><th>Concepto</th><th>Monto</th>{canDelete&&<th>Acciones</th>}</tr></thead><tbody>{rows.map(row=><tr key={row.id}><td>{showDate(row.fecha)}</td><td>{label(row.tipo)}</td><td>{row.tecnico||'—'}</td><td>{row.concepto||'—'}</td><td className={['reposicion','devolucion'].includes(row.tipo)?'amount-in':'amount-out'}>{['reposicion','devolucion'].includes(row.tipo)?'+':'−'}{money(row.monto)}</td>{canDelete&&<td><button type="button" className="btn red" disabled={busy} onClick={()=>remove(row)}>Eliminar</button></td>}</tr>)}</tbody></table>}</div>
    {form&&<div className="modal"><form className="card appointment-form" onSubmit={save}>
      <div className="row"><h3 style={{flex:1}}>Movimiento de caja chica</h3><button type="button" className="btn ghost" disabled={busy} onClick={()=>setForm(null)}>✕</button></div>
      <label htmlFor="cc-tipo">Tipo</label><select id="cc-tipo" value={form.tipo} onChange={set('tipo')}>{CAJA_TIPOS.map(([value,text])=><option key={value} value={value}>{text}</option>)}</select>
      <label htmlFor="cc-fecha">Fecha</label><input id="cc-fecha" type="date" required value={form.fecha} onChange={set('fecha')}/>
      <label htmlFor="cc-monto">Monto</label><input id="cc-monto" type="number" min="0.01" step="0.01" required value={form.monto} onChange={set('monto')}/>
      {['viatico','devolucion'].includes(form.tipo)&&<><label htmlFor="cc-tec">Técnico{form.tipo==='viatico'?'':' (opcional)'}</label><input id="cc-tec" maxLength={80} required={form.tipo==='viatico'} value={form.tecnico} onChange={set('tecnico')}/></>}
      {['viatico','gasto'].includes(form.tipo)&&<><label htmlFor="cc-obra">Obra <span>(opcional)</span></label><select id="cc-obra" value={form.obra_id} onChange={set('obra_id')}><option value="">—</option>{obras.map(item=><option key={item.id} value={item.id}>{item.folio||'Sin folio'} · {item.cliente||''}</option>)}</select></>}
      {form.tipo==='gasto'&&<><label htmlFor="cc-cat">Categoría del gasto</label><select id="cc-cat" value={form.categoria_id} onChange={set('categoria_id')}><option value="">Otros egresos</option>{categorias.map(item=><option key={item.id} value={item.id}>{item.nombre}</option>)}</select></>}
      <label htmlFor="cc-con">Concepto <span>(opcional)</span></label><input id="cc-con" maxLength={200} value={form.concepto} onChange={set('concepto')} placeholder="Ej. gasolina para la obra de Jiutepec"/>
      {plazas.length>1&&<><label htmlFor="cc-plaza">Plaza</label><select id="cc-plaza" value={form.plaza} onChange={set('plaza')}>{plazas.map(name=><option key={name}>{name}</option>)}</select></>}
      {error&&<p className="data-alert" role="alert">{error}</p>}
      <div className="row"><button className="btn" type="submit" disabled={busy}>{busy?'Guardando…':'Registrar'}</button><button className="btn ghost" type="button" disabled={busy} onClick={()=>setForm(null)}>Cancelar</button></div>
    </form></div>}
  </div>;
}

/* ---------- Categorías libres ---------- */
function Categorias({readOnly}){
  const[rows,load,state]=useQuery(()=>sb.from('finanzas_categorias').select('*').order('tipo').order('nombre'),[]);
  const[nombre,setNombre]=useState('');const[tipo,setTipo]=useState('egreso');const[naturaleza,setNaturaleza]=useState('variable');const[busy,setBusy]=useState(false);const[error,setError]=useState('');
  const add=async event=>{event.preventDefault();setError('');setBusy(true);try{const{error:insertError}=await sb.from('finanzas_categorias').insert({nombre:nombre.trim(),tipo,naturaleza});if(insertError)throw new Error(insertError.code==='23505'?'Ya existe una categoría con ese nombre.':insertError.message);setNombre('');await load()}catch(err){setError(err.message)}finally{setBusy(false)}};
  const toggle=async row=>{setError('');setBusy(true);try{const{error:updateError}=await sb.from('finanzas_categorias').update({activa:!row.activa}).eq('id',row.id);if(updateError)throw updateError;await load()}catch(err){setError(err.message)}finally{setBusy(false)}};
  return <div className="card tbl"><span className="lbl">Categorías</span><h3>Tipos de ingreso y gasto</h3><p className="mut">Agrega las que necesites (renta, nómina, gasolina, casetas…). Una categoría desactivada deja de ofrecerse pero conserva su historial.</p>
    {!readOnly&&<form className="row" onSubmit={add}><input aria-label="Nombre de la categoría" required maxLength={80} placeholder="Nueva categoría" value={nombre} onChange={e=>setNombre(e.target.value)}/><select aria-label="Tipo" value={tipo} onChange={e=>setTipo(e.target.value)}><option value="egreso">Egreso</option><option value="ingreso">Ingreso</option></select><select aria-label="Fijo o variable" value={naturaleza} onChange={e=>setNaturaleza(e.target.value)}><option value="variable">Variable</option><option value="fijo">Fijo</option></select><button className="btn" type="submit" disabled={busy||!nombre.trim()}>Agregar</button></form>}
    {error&&<p className="data-alert" role="alert">{error}</p>}<Feedback state={state}/>
    {rows.length>0&&<table><thead><tr><th>Nombre</th><th>Tipo</th><th>Fijo / variable</th><th>Estado</th>{!readOnly&&<th>Acciones</th>}</tr></thead><tbody>{rows.map(row=><tr key={row.id}><td>{row.nombre}</td><td>{row.tipo}</td><td>{row.naturaleza}</td><td>{row.activa?'Activa':'Desactivada'}</td>{!readOnly&&<td><button type="button" className="btn ghost" disabled={busy} onClick={()=>toggle(row)}>{row.activa?'Desactivar':'Activar'}</button></td>}</tr>)}</tbody></table>}
  </div>;
}

export function Finanzas({readOnly=false,canDelete=false}){
  const[sub,setSub]=useState('libro');
  const tabs=[['libro','Libro'],['caja','Caja chica'],['categorias','Categorías']];
  return <div className="finance-page"><div className="subtabs" role="tablist" aria-label="Finanzas">{tabs.map(([key,label])=><button key={key} type="button" role="tab" aria-selected={sub===key} className={sub===key?'on':''} onClick={()=>setSub(key)}>{label}</button>)}</div>
    {readOnly&&<p className="mut">Vista de solo lectura.</p>}
    {sub==='libro'&&<Libro readOnly={readOnly} canDelete={canDelete}/>}{sub==='caja'&&<CajaChica readOnly={readOnly} canDelete={canDelete}/>}{sub==='categorias'&&<Categorias readOnly={readOnly}/>}</div>;
}

/* ---------- Stock por medición (barriles) y artículos por reponer ---------- */
export function StockMedicion({canMeasure=false,canConfigure=false}){
  const[resumen,loadResumen,resumenState]=useQuery(()=>sb.from('stock_resumen').select('*').order('tipo'),[]);
  const[barriles,loadBarriles,state]=useQuery(()=>sb.from('barriles').select('*').order('entrada',{ascending:false}),[]);
  const[articulos]=useQuery(()=>sb.from('articulos_inventario').select('id,nombre,tipo,cantidad,minimo,unidad'),[]);
  const[minimos,loadMinimos]=useQuery(()=>sb.from('stock_minimos').select('*'),[]);
  const[heights,setHeights]=useState({});const[notes,setNotes]=useState({});const[busyId,setBusyId]=useState(null);const[error,setError]=useState('');const[showEmpty,setShowEmpty]=useState(false);
  const low=articulos.filter(item=>Number(item.minimo)>0&&Number(item.cantidad)<=Number(item.minimo));
  const visible=barriles.filter(item=>showEmpty||item.estado!=='vacío');
  const reload=async()=>{await Promise.all([loadBarriles(),loadResumen()])};
  const measure=async barril=>{const value=heights[barril.id];if(value===undefined||value===''){setError('Captura la altura en cm.');return}setError('');setBusyId(barril.id);try{const{error:insertError}=await sb.from('barril_mediciones').insert({barril_id:barril.id,altura_cm:Number(value),nota:(notes[barril.id]||'').trim()||null});if(insertError)throw insertError;setHeights(current=>({...current,[barril.id]:''}));setNotes(current=>({...current,[barril.id]:''}));await reload()}catch(err){setError(err.message||'No se pudo registrar la medición.')}finally{setBusyId(null)}};
  const saveMin=async(tipo,value)=>{setError('');try{const{error:updateError}=await sb.from('stock_minimos').update({minimo_litros:Number(value)||0}).eq('tipo',tipo);if(updateError)throw updateError;await Promise.all([loadMinimos(),loadResumen()])}catch(err){setError(err.message||'No se pudo guardar el mínimo.')}};
  return <div className="finance-stack">
    <div className="card"><span className="lbl">Material</span><h3>Stock estimado por medición</h3>
      <p className="mut">Un barril cerrado cuenta completo. Uno abierto cuenta según su última medición con regla.</p>
      <Feedback state={resumenState} empty={!resumen.length&&'Sin barriles registrados.'}/>
      <div className="grid kpi-grid">{resumen.map(item=>{const needs=Number(item.minimo_litros)>0&&Number(item.litros_estimados)<=Number(item.minimo_litros);return <div key={item.plaza+item.tipo} className={'card kpi'+(needs?' bad':'')}><span className="lbl">{item.tipo} · {item.plaza}</span><strong className="big">{Number(item.litros_estimados).toLocaleString('es-MX')} L</strong><span className="mut">{item.barriles_activos} barriles{Number(item.sin_medir)>0?` · ${item.sin_medir} abiertos sin medir`:''}</span>{needs&&<span className="stock-alert">Por debajo del mínimo: conviene comprar</span>}</div>})}</div>
      {canConfigure&&<div className="row stock-min">{['isocianato','poliol'].map(tipo=>{const current=minimos.find(item=>item.tipo===tipo);return <label key={tipo}>Mínimo de {tipo} (L)<input type="number" min="0" step="1" defaultValue={current?.minimo_litros??0} key={tipo+(current?.minimo_litros??0)} onBlur={e=>Number(e.target.value)!==Number(current?.minimo_litros??0)&&saveMin(tipo,e.target.value)}/></label>})}<span className="mut">0 desactiva el aviso.</span></div>}
    </div>
    {low.length>0&&<div className="card"><h3>EPP y herramientas por reponer</h3><ul className="plain-list">{low.map(item=><li key={item.id}><strong>{item.nombre}</strong> · quedan {item.cantidad} {item.unidad||''} (mínimo {item.minimo})</li>)}</ul></div>}
    <div className="card tbl"><div className="row"><div style={{flex:1}}><span className="lbl">Medición</span><h3>Barriles</h3></div><label className="inline-check"><input type="checkbox" checked={showEmpty} onChange={e=>setShowEmpty(e.target.checked)}/> Mostrar vacíos</label></div>
      {error&&<p className="data-alert" role="alert">{error}</p>}<Feedback state={state} empty={!visible.length&&'No hay barriles para mostrar.'}/>
      {visible.length>0&&<table><thead><tr><th>Material</th><th>Lote</th><th>Plaza</th><th>Estado</th><th>Último nivel</th>{canMeasure&&<th>Nueva medición</th>}</tr></thead><tbody>{visible.map(barril=><tr key={barril.id}>
        <td>{barril.tipo}</td><td>{barril.lote||'—'}</td><td>{barril.plaza||'—'}</td><td>{barril.estado}</td>
        <td>{barril.nivel_cm==null?<span className="mut">Sin medir</span>:<>{barril.nivel_cm} cm · {barril.nivel_litros} L<div className="mut">{showDate(barril.medido_at)}</div></>}</td>
        {canMeasure&&<td>{barril.estado==='cerrado'?<span className="mut">Cerrado: ábrelo para medir</span>:<div className="measure-row"><input type="number" min="0" max={barril.altura_total_cm||100} step="0.5" aria-label="Altura en cm" placeholder="cm" value={heights[barril.id]??''} onChange={e=>setHeights(current=>({...current,[barril.id]:e.target.value}))}/><input aria-label="Nota" placeholder="Nota (opcional)" maxLength={120} value={notes[barril.id]??''} onChange={e=>setNotes(current=>({...current,[barril.id]:e.target.value}))}/><button type="button" className="btn" disabled={busyId===barril.id} onClick={()=>measure(barril)}>{busyId===barril.id?'…':'Registrar'}</button></div>}</td>}</tr>)}</tbody></table>}
      <p className="mut">Para medir un barril cerrado, primero cámbialo a «abierto» con Editar en la tabla de arriba. La altura del barril y su capacidad se editan ahí mismo (por defecto 100 cm y 200 L).</p>
    </div>
  </div>;
}

/* ---------- Reportes (gerente y contador) ---------- */
export function Reportes(){
  const[month,setMonth]=useState(monthKey());
  const[resumen,,state]=useQuery(()=>sb.from('finanzas_resumen_mensual').select('*').order('mes',{ascending:false}),[]);
  const[cierres,,cierresState]=useQuery(()=>sb.from('cierres').select('status,anticipo_status,anticipo_monto,confirmado_at'),[]);
  const[busy,setBusy]=useState(false);const[error,setError]=useState('');
  const current=resumen.filter(row=>String(row.mes).startsWith(month));
  const income=sum(current.filter(row=>row.tipo==='ingreso'),row=>row.total);const expenses=sum(current.filter(row=>row.tipo==='egreso'),row=>row.total);
  const group=type=>Object.values(current.filter(row=>row.tipo===type).reduce((acc,row)=>{const key=row.categoria;acc[key]=acc[key]||{categoria:row.categoria,naturaleza:row.naturaleza,total:0};acc[key].total+=Number(row.total);return acc},{})).sort((a,b)=>b.total-a.total);
  const fixed=sum(current.filter(row=>row.tipo==='egreso'&&row.naturaleza==='fijo'),row=>row.total);
  const months=[...new Set(resumen.map(row=>String(row.mes).slice(0,7)))].sort().reverse().slice(0,6);
  const monthTotals=key=>{const rows=resumen.filter(row=>String(row.mes).startsWith(key));const inc=sum(rows.filter(row=>row.tipo==='ingreso'),row=>row.total);const exp=sum(rows.filter(row=>row.tipo==='egreso'),row=>row.total);return{inc,exp}};
  const closedThisMonth=cierres.filter(row=>row.status==='confirmado'&&String(row.confirmado_at||'').startsWith(month));
  const exportCsv=async()=>{setError('');setBusy(true);try{await exportMonthCsv(month)}catch(err){setError(err.message)}finally{setBusy(false)}};
  const table=(title,rows)=><div className="card tbl"><h3>{title}</h3>{rows.length?<table><thead><tr><th>Categoría</th><th>Fijo / variable</th><th>Total</th></tr></thead><tbody>{rows.map(row=><tr key={row.categoria}><td>{row.categoria}</td><td>{row.naturaleza}</td><td>{money(row.total)}</td></tr>)}</tbody></table>:<p className="mut">Sin movimientos.</p>}</div>;
  return <div className="finance-stack">
    <div className="card"><div className="row"><div style={{flex:1}}><span className="lbl">Reportes</span><h2>Resumen del mes</h2></div><input type="month" aria-label="Mes" value={month} onChange={e=>e.target.value&&setMonth(e.target.value)}/><button type="button" className="btn" disabled={busy} onClick={exportCsv}>Descargar para el contador (CSV)</button></div>
      {error&&<p className="data-alert" role="alert">{error}</p>}<Feedback state={state}/>
      <div className="grid kpi-grid"><Kpi label="Ingresos" value={money(income)} tone="ok"/><Kpi label="Egresos" value={money(expenses)} tone="bad"/><Kpi label="Balance" value={money(income-expenses)} tone={income-expenses<0?'bad':'ok'}/><Kpi label="Gastos fijos" value={money(fixed)}/><Kpi label="Gastos variables" value={money(expenses-fixed)}/></div></div>
    <div className="grid report-grid">{table('Ingresos por categoría',group('ingreso'))}{table('Egresos por categoría',group('egreso'))}</div>
    <div className="card tbl"><h3>Anticipos y cierres del mes</h3><Feedback state={cierresState}/>
      <div className="grid kpi-grid"><Kpi label="Cierres confirmados" value={closedThisMonth.length}/><Kpi label="Anticipos recibidos" value={money(sum(closedThisMonth.filter(row=>row.anticipo_status==='recibido'),row=>row.anticipo_monto))}/><Kpi label="Anticipos perdonados" value={closedThisMonth.filter(row=>row.anticipo_status==='perdonado').length}/><Kpi label="Cierres por confirmar" value={cierres.filter(row=>row.status==='pendiente').length}/></div></div>
    <div className="card tbl"><h3>Últimos meses</h3>{months.length?<table><thead><tr><th>Mes</th><th>Ingresos</th><th>Egresos</th><th>Balance</th></tr></thead><tbody>{months.map(key=>{const{inc,exp}=monthTotals(key);return <tr key={key}><td>{key}</td><td>{money(inc)}</td><td>{money(exp)}</td><td className={inc-exp<0?'amount-out':'amount-in'}>{money(inc-exp)}</td></tr>})}</tbody></table>:<p className="mut">Aún no hay movimientos registrados.</p>}</div>
  </div>;
}
