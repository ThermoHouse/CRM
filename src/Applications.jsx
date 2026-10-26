import {useCallback,useEffect,useMemo,useState} from 'react';
import {sb} from './supabase';

const dateKey=value=>value?String(value).slice(0,10):'';
const localDateKey=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const displayDate=value=>value?new Date(`${dateKey(value)}T12:00:00`).toLocaleDateString('es-MX',{dateStyle:'medium'}):'Sin fecha';
const emptyForm=()=>({source:'new',leadId:'',cliente:'',whatsapp:'',email:'',sistema:'',vendedor:'',programacion:'',direccion:'',m2:'',status:'por_iniciar',intervalo:'2'});

function Applications({canManage}) {
 const[works,setWorks]=useState([]);
 const[warranties,setWarranties]=useState([]);
 const[closedLeads,setClosedLeads]=useState([]);
 const[month,setMonth]=useState(()=>new Date());
 const[day,setDay]=useState(()=>localDateKey(new Date()));
 const[form,setForm]=useState(null);
 const[maintenance,setMaintenance]=useState(null);
 const[maintenanceDate,setMaintenanceDate]=useState('');
 const[loading,setLoading]=useState(true);
 const[loadError,setLoadError]=useState('');
 const[leadError,setLeadError]=useState('');
 const[error,setError]=useState('');
 const[busy,setBusy]=useState(false);

 const load=useCallback(async()=>{
  setLoading(true);setLoadError('');setLeadError('');
  const[worksResult,warrantiesResult,leadsResult]=await Promise.all([
   sb.from('obras').select('*').order('programacion',{ascending:true}),
   sb.from('garantias').select('*').order('proximo_mtto',{ascending:true}),
   canManage?sb.rpc('available_closed_leads_for_application'):Promise.resolve({data:[],error:null})
  ]);
  const errors=[worksResult.error,warrantiesResult.error].filter(Boolean).map(item=>item.message);
  if(errors.length)setLoadError(errors.join(' · '));
  setWorks(worksResult.data||[]);setWarranties(warrantiesResult.data||[]);
  if(leadsResult.error){setLeadError(leadsResult.error.message);setClosedLeads([])}
  else setClosedLeads(leadsResult.data||[]);
  setLoading(false);
 },[canManage]);
 useEffect(()=>{load()},[load]);

 const year=month.getFullYear(),monthIndex=month.getMonth();
 const dates=useMemo(()=>{const firstDay=new Date(year,monthIndex,1);const offset=firstDay.getDay();return Array.from({length:42},(_,index)=>new Date(year,monthIndex,1-offset+index))},[year,monthIndex]);
 const eventsByDay=useMemo(()=>{
  const events=new Map();
  const add=(date,event)=>{const key=dateKey(date);if(!key)return;const items=events.get(key)||[];items.push(event);events.set(key,items)};
  works.forEach(work=>add(work.programacion,{kind:'application',record:work}));
  warranties.forEach(item=>add(item.proximo_mtto,{kind:'maintenance',record:item}));
  return events;
 },[works,warranties]);
 const dayEvents=eventsByDay.get(day)||[];
 const selectedDate=new Date(`${day}T12:00:00`);
 const selectedLead=closedLeads.find(lead=>lead.id===form?.leadId);

 const openNew=()=>{setError('');setForm(emptyForm())};
 const openEdit=work=>{setError('');setForm({source:'edit',id:work.id,leadId:work.lead_id||'',folio:work.folio||'',cliente:work.cliente||'',whatsapp:work.whatsapp||'',email:work.email||'',sistema:work.sistema||'',vendedor:work.vendedor||'',programacion:dateKey(work.programacion),direccion:work.direccion||'',m2:work.m2??'',status:work.status||'por_iniciar',intervalo:String(work.intervalo_mtto_anios||2)})};
 const selectLead=id=>{const lead=closedLeads.find(item=>item.id===id);setForm(current=>({...current,leadId:id,direccion:lead?.direccion||''}))};
 const setField=(name,value)=>setForm(current=>({...current,[name]:value}));

 const save=async event=>{
  event.preventDefault();setError('');
  if(!form.programacion){setError('Indica la fecha de aplicación para agregarla al calendario y programar su mantenimiento.');return}
  if(form.source==='lead'&&!form.leadId){setError('Selecciona una venta cerrada.');return}
  if(form.source!=='lead'&&!form.cliente.trim()){setError('El nombre del cliente es obligatorio.');return}
  if(form.m2!==''&&(!Number.isFinite(Number(form.m2))||Number(form.m2)<0)){setError('La superficie debe ser un número igual o mayor que cero.');return}
  setBusy(true);
  try{
   const interval=Number(form.intervalo);
   if(form.source==='edit'){
    const{error:saveError}=await sb.from('obras').update({
     folio:form.folio||null,cliente:form.cliente.trim(),whatsapp:form.whatsapp||null,
     email:form.email||null,sistema:form.sistema||null,vendedor:form.vendedor||null,
     programacion:form.programacion,direccion:form.direccion||null,m2:Number(form.m2)||0,
     status:form.status,intervalo_mtto_anios:interval
    }).eq('id',form.id);
    if(saveError)throw saveError;
   }else if(form.source==='lead'){
    const{error:saveError}=await sb.rpc('create_application_from_closed_lead',{
     p_lead_id:form.leadId,p_programacion:form.programacion,p_direccion:form.direccion||null,
     p_intervalo_mtto_anios:interval
    });
    if(saveError)throw saveError;
   }else{
    const{error:saveError}=await sb.rpc('create_manual_application',{
     p_cliente:form.cliente,p_whatsapp:form.whatsapp||null,p_email:form.email||null,
     p_sistema:form.sistema||null,p_vendedor:form.vendedor||null,
     p_programacion:form.programacion,p_direccion:form.direccion||null,
     p_m2:Number(form.m2)||0,p_intervalo_mtto_anios:interval
    });
    if(saveError)throw saveError;
   }
   const createdDay=form.programacion;setForm(null);setDay(createdDay);
   setMonth(new Date(`${createdDay}T12:00:00`));await load();
  }catch(saveError){setError(saveError.message||'No se pudo guardar la aplicación.')}
  finally{setBusy(false)}
 };

 const remove=async work=>{
  if(!window.confirm(`¿Eliminar la aplicación de ${work.cliente||'este cliente'}? También se eliminará su agenda de mantenimiento.`))return;
  setError('');setBusy(true);
  try{const{error:deleteError}=await sb.from('obras').delete().eq('id',work.id);if(deleteError)throw deleteError;await load()}
  catch(deleteError){setError(deleteError.message||'No se pudo eliminar la aplicación.')}
  finally{setBusy(false)}
 };

 const openMaintenance=item=>{setError('');setMaintenance(item);setMaintenanceDate(dateKey(item.proximo_mtto))};
 const saveMaintenance=async event=>{
  event.preventDefault();setError('');
  if(!maintenanceDate){setError('Indica la fecha del mantenimiento.');return}
  setBusy(true);
  try{const{error:scheduleError}=await sb.rpc('schedule_application_maintenance',{p_garantia_id:maintenance.id,p_fecha:maintenanceDate});if(scheduleError)throw scheduleError;setDay(maintenanceDate);setMonth(new Date(`${maintenanceDate}T12:00:00`));setMaintenance(null);await load()}
  catch(scheduleError){setError(scheduleError.message||'No se pudo agendar el mantenimiento.')}
  finally{setBusy(false)}
 };

 return <section className="applications-page">
  <div className="applications-heading"><div><span className="lbl">Agenda de instalaciones</span><h2>Aplicaciones</h2><p className="mut">Consulta fechas de aplicación y agenda los mantenimientos de cada cliente.</p></div>{canManage&&<button type="button" className="btn" onClick={openNew}>+ Nueva aplicación</button>}</div>
  {loadError&&<p className="data-alert" role="alert">No se pudieron cargar las aplicaciones o mantenimientos: {loadError}</p>}
  {leadError&&canManage&&<p className="migration-hint" role="status">No se pudieron cargar las ventas cerradas para el formulario. Ejecuta <code>supabase/32_applications_calendar_and_maintenance.sql</code>. Aún puedes capturar un nuevo cliente.</p>}
  {error&&!form&&!maintenance&&<p className="data-alert" role="alert">{error}</p>}
  <section className="applications-calendar">
   <div className="applications-calendar-header"><div><span className="lbl">Calendario de aplicaciones y mantenimiento</span><h3>{month.toLocaleDateString('es-MX',{month:'long',year:'numeric'})}</h3></div><div className="calendar-nav"><button type="button" className="btn ghost" aria-label="Mes anterior" onClick={()=>setMonth(new Date(year,monthIndex-1,1))}>‹</button><button type="button" className="btn ghost" onClick={()=>{const today=localDateKey(new Date());setMonth(new Date());setDay(today)}}>Hoy</button><button type="button" className="btn ghost" aria-label="Mes siguiente" onClick={()=>setMonth(new Date(year,monthIndex+1,1))}>›</button></div></div>
   {loading&&!works.length&&!warranties.length?<p className="mut">Cargando calendario…</p>:<div className="applications-calendar-layout">
    <div className="applications-calendar-grid">{['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map(name=><span className="calendar-weekday" key={name}>{name}</span>)}{dates.map(date=>{const key=localDateKey(date);const events=eventsByDay.get(key)||[];return <button type="button" key={key} className={`calendar-day ${date.getMonth()!==monthIndex?'outside':''} ${key===day?'selected':''} ${key===localDateKey(new Date())?'today':''} ${events.length?'has-events':''}`} aria-label={`${date.toLocaleDateString('es-MX')}, ${events.length} eventos`} onClick={()=>{setDay(key);if(date.getMonth()!==monthIndex)setMonth(new Date(date.getFullYear(),date.getMonth(),1))}}><span>{date.getDate()}</span>{events.length>0&&<small>{events.length}</small>}</button>})}</div>
    <aside className="applications-agenda"><div className="calendar-day-heading"><div><span className="lbl">Agenda del día</span><h4>{selectedDate.toLocaleDateString('es-MX',{weekday:'long',day:'numeric',month:'long'})}</h4></div></div>
     {dayEvents.length?dayEvents.map((event,index)=>event.kind==='application'?<article className="application-calendar-event" key={`app-${event.record.id}-${index}`}><span className="application-event-tag">Aplicación</span><strong>{event.record.cliente||'Cliente sin nombre'}</strong><small>{event.record.folio||'Sin folio'} · {event.record.direccion||'Sin dirección'}</small><small>{event.record.status||'por_iniciar'} · {event.record.m2||0} m²</small>{canManage&&<div className="application-event-actions"><button type="button" className="btn ghost" onClick={()=>openEdit(event.record)}>Editar aplicación</button><button type="button" className="btn red" disabled={busy} onClick={()=>remove(event.record)}>Eliminar</button></div>}</article>:<article className="application-calendar-event maintenance-event" key={`mtto-${event.record.id}-${index}`}><span className="application-event-tag">Mantenimiento</span><strong>{event.record.cliente||'Cliente sin nombre'}</strong><small>{event.record.folio||'Sin folio'} · Cada {event.record.intervalo_anios||2} años</small><small>{event.record.ultimo_mtto?`Último: ${displayDate(event.record.ultimo_mtto)}`:'Mantenimiento programado'}</small>{canManage&&<button type="button" className="btn ghost" onClick={()=>openMaintenance(event.record)}>Agendar mantenimiento</button>}</article>):<p className="mut">No hay aplicaciones ni mantenimientos programados para este día.</p>}
    </aside>
   </div>}
   <div className="applications-legend"><span><i className="application-dot"/> Aplicación</span><span><i className="maintenance-dot"/> Mantenimiento</span><span>{works.length} aplicaciones · {warranties.length} mantenimientos</span></div>
  </section>
  {form&&<div className="modal"><form className="card application-form" onSubmit={save}><div className="row"><div style={{flex:1}}><span className="lbl">{form.source==='edit'?'Editar registro':'Alta de instalación'}</span><h3>{form.source==='edit'?'Editar aplicación':'Nueva aplicación'}</h3></div><button type="button" className="btn ghost" disabled={busy} onClick={()=>setForm(null)}>✕</button></div>
   {form.source!=='edit'&&<><label htmlFor="application-source">Origen del cliente</label><select id="application-source" value={form.source} onChange={event=>{setField('source',event.target.value);setField('leadId','')}}><option value="new">Nuevo cliente</option><option value="lead">Venta cerrada existente</option></select></>}
   {form.source==='lead'?<><label htmlFor="application-lead">Lead con venta cerrada</label><select id="application-lead" value={form.leadId} onChange={event=>selectLead(event.target.value)} required><option value="">Selecciona un cliente</option>{closedLeads.map(lead=><option key={lead.id} value={lead.id}>{lead.nombre} · {lead.folio||'Sin folio'}{lead.asesor?` · ${lead.asesor}`:''}</option>)}</select>{!closedLeads.length&&<p className="mut">No hay leads con venta cerrada disponibles; puedes elegir “Nuevo cliente”.</p>}{selectedLead&&<div className="application-lead-summary"><strong>{selectedLead.nombre}</strong><span>{selectedLead.whatsapp||'Sin teléfono'} · {selectedLead.email||'Sin correo'}</span><span>{selectedLead.sistema||'Sistema pendiente'} · {selectedLead.area_m2||0} m² · {selectedLead.ciudad||'Sin zona'}</span></div>}</>:<div className="application-fields">
    <div><label htmlFor="application-client">Nombre del cliente</label><input id="application-client" value={form.cliente} onChange={event=>setField('cliente',event.target.value)} required maxLength={160}/></div>
    <div><label htmlFor="application-phone">Teléfono</label><input id="application-phone" value={form.whatsapp} onChange={event=>setField('whatsapp',event.target.value)} maxLength={40}/></div>
    <div><label htmlFor="application-email">Correo</label><input id="application-email" type="email" value={form.email} onChange={event=>setField('email',event.target.value)} maxLength={254}/></div>
    <div><label htmlFor="application-system">Sistema</label><input id="application-system" value={form.sistema} onChange={event=>setField('sistema',event.target.value)} maxLength={120}/></div>
    <div><label htmlFor="application-salesperson">Vendedor</label><input id="application-salesperson" value={form.vendedor} onChange={event=>setField('vendedor',event.target.value)} maxLength={160}/></div>
    <div><label htmlFor="application-area">Superficie (m²)</label><input id="application-area" type="number" min="0" step="0.01" value={form.m2} onChange={event=>setField('m2',event.target.value)}/></div>
   </div>}
   <label htmlFor="application-date">Fecha de aplicación</label><input id="application-date" type="date" value={form.programacion} onChange={event=>setField('programacion',event.target.value)} required/>
   <label htmlFor="application-address">Dirección</label><input id="application-address" value={form.direccion} onChange={event=>setField('direccion',event.target.value)} maxLength={500}/>
   {form.source==='edit'&&<><label htmlFor="application-status">Estado</label><select id="application-status" value={form.status} onChange={event=>setField('status',event.target.value)}>{[['por_iniciar','Por iniciar'],['en_proceso','En proceso'],['entregada','Entregada']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></>}
   <label htmlFor="application-maintenance-interval">Mantenimiento cada</label><select id="application-maintenance-interval" value={form.intervalo} onChange={event=>setField('intervalo',event.target.value)}>{[2,3,4].map(years=><option key={years} value={years}>{years} años</option>)}</select>
   <p className="mut">El calendario programará automáticamente el próximo mantenimiento desde la fecha de aplicación. Al marcarlo como realizado, se calculará el siguiente ciclo.</p>
   {error&&<p className="data-alert" role="alert">{error}</p>}<div className="row"><button type="submit" className="btn" disabled={busy}>{busy?'Guardando…':'Guardar aplicación'}</button><button type="button" className="btn ghost" disabled={busy} onClick={()=>setForm(null)}>Cancelar</button></div>
  </form></div>}
  {maintenance&&<div className="modal"><form className="card application-form" onSubmit={saveMaintenance}><div className="row"><div style={{flex:1}}><span className="lbl">Agenda de mantenimiento</span><h3>{maintenance.cliente||'Cliente'}</h3></div><button type="button" className="btn ghost" disabled={busy} onClick={()=>setMaintenance(null)}>✕</button></div><p className="mut">Cada {maintenance.intervalo_anios||2} años · {maintenance.folio||'Sin folio'}</p><label htmlFor="scheduled-maintenance-date">Próxima fecha de mantenimiento</label><input id="scheduled-maintenance-date" type="date" value={maintenanceDate} onChange={event=>setMaintenanceDate(event.target.value)} required/>{error&&<p className="data-alert" role="alert">{error}</p>}<div className="row"><button type="submit" className="btn" disabled={busy}>{busy?'Guardando…':'Guardar fecha'}</button><button type="button" className="btn ghost" disabled={busy} onClick={()=>setMaintenance(null)}>Cancelar</button></div></form></div>}
 </section>;
}

export default Applications;
