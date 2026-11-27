import {useCallback,useEffect,useMemo,useState} from 'react';
import {sb} from './supabase';
import {ConfirmDialog} from './ui';

const dateKey=value=>value?String(value).slice(0,10):'';
const localDateKey=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const displayDate=value=>value?new Date(`${dateKey(value)}T12:00:00`).toLocaleDateString('es-MX',{dateStyle:'medium'}):'Sin fecha';
const VISIT_TYPES={tecnica:'Visita técnica',garantia:'Visita de garantía'};
const VISIT_STATUS={por_visitar:'Por visitar',realizada:'Realizada',cancelada:'Cancelada'};
const toLocalInput=value=>{if(!value)return'';const d=new Date(value);if(Number.isNaN(d.getTime()))return'';return `${localDateKey(d)}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`};
const visitDay=value=>{if(!value)return'';const d=new Date(value);return Number.isNaN(d.getTime())?'':localDateKey(d)};
const visitTime=value=>{if(!value)return'';const d=new Date(value);return Number.isNaN(d.getTime())?'':d.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})};
const emptyVisit=(day='')=>({id:'',tipo:'tecnica',cliente:'',tecnico:'',ubicacion:'',programacion:day?`${day}T09:00`:'',status:'por_visitar',notas:''});
const emptyForm=()=>({source:'new',leadId:'',cliente:'',whatsapp:'',email:'',sistema:'',vendedor:'',programacion:'',direccion:'',m2:'',status:'por_iniciar',intervalo:'2'});

function Applications({canManage,canManageMaintenance=canManage,isRoot=false}) {
 const[works,setWorks]=useState([]);
 const[warranties,setWarranties]=useState([]);
 const[visits,setVisits]=useState([]);
 const[visitForm,setVisitForm]=useState(null);
 const[pendingVisitDelete,setPendingVisitDelete]=useState(null);
 const[filter,setFilter]=useState('todo');
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
 const[pendingDelete,setPendingDelete]=useState(null);

 const load=useCallback(async()=>{
  setLoading(true);setLoadError('');setLeadError('');
  const[worksResult,warrantiesResult,leadsResult,visitsResult]=await Promise.all([
   sb.from('obras').select('*').order('programacion',{ascending:true}),
   sb.from('garantias').select('*').order('proximo_mtto',{ascending:true}),
   canManage?sb.rpc('available_closed_leads_for_application'):Promise.resolve({data:[],error:null}),
   sb.from('visitas').select('*').order('programacion',{ascending:true})
  ]);
  const errors=[worksResult.error,warrantiesResult.error,visitsResult.error].filter(Boolean).map(item=>item.message);
  if(errors.length)setLoadError(errors.join(' · '));
  setWorks(worksResult.data||[]);setWarranties(warrantiesResult.data||[]);setVisits(visitsResult.data||[]);
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
  visits.forEach(item=>{if(item.status==='cancelada')return;add(visitDay(item.programacion),{kind:item.tipo==='garantia'?'visit_warranty':'visit_technical',record:item})});
  return events;
 },[works,warranties,visits]);
 const matches=event=>filter==='todo'||(filter==='aplicacion'&&event.kind==='application')||(filter==='mantenimiento'&&event.kind==='maintenance')||(filter==='tecnica'&&event.kind==='visit_technical')||(filter==='garantia'&&event.kind==='visit_warranty');
 const dayEvents=(eventsByDay.get(day)||[]).filter(matches).slice().sort((a,b)=>{const ta=a.kind.startsWith('visit')?new Date(a.record.programacion).getTime():0;const tb=b.kind.startsWith('visit')?new Date(b.record.programacion).getTime():0;return ta-tb});
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

 const remove=work=>{setError('');setPendingDelete(work)};
 const confirmRemove=async()=>{
  const work=pendingDelete;if(!work)return;
  setError('');setBusy(true);
  try{const{error:deleteError}=await sb.from('obras').delete().eq('id',work.id);if(deleteError)throw deleteError;setPendingDelete(null);await load()}
  catch(deleteError){setError(deleteError.message||'No se pudo eliminar la aplicación.')}
  finally{setBusy(false)}
 };

 const openNewVisit=type=>{setError('');setVisitForm({...emptyVisit(day),tipo:type||'tecnica'})};
 const openEditVisit=visit=>{setError('');setVisitForm({id:visit.id,tipo:visit.tipo||'tecnica',cliente:visit.cliente||'',tecnico:visit.tecnico||'',ubicacion:visit.ubicacion||'',programacion:toLocalInput(visit.programacion),status:visit.status||'por_visitar',notas:visit.notas||''})};
 const setVisitField=(name,value)=>setVisitForm(current=>({...current,[name]:value}));
 const saveVisit=async event=>{
  event.preventDefault();setError('');
  if(!visitForm.cliente.trim()){setError('El nombre del cliente es obligatorio.');return}
  if(!visitForm.programacion){setError('Indica la fecha y hora de la visita.');return}
  setBusy(true);
  try{
   const row={tipo:visitForm.tipo,cliente:visitForm.cliente.trim(),tecnico:visitForm.tecnico.trim()||null,ubicacion:visitForm.ubicacion.trim()||null,programacion:new Date(visitForm.programacion).toISOString(),status:visitForm.status,notas:visitForm.notas.trim()||null};
   const{error:saveError}=visitForm.id?await sb.from('visitas').update(row).eq('id',visitForm.id):await sb.from('visitas').insert(row);
   if(saveError)throw saveError;
   const visitDate=visitForm.programacion.slice(0,10);setVisitForm(null);setDay(visitDate);setMonth(new Date(`${visitDate}T12:00:00`));await load();
  }catch(saveError){
   const missing=/tipo|notas/.test(saveError.message||'')&&/column|schema/.test(saveError.message||'');
   setError(missing?(isRoot?'Falta aplicar supabase/52_visit_types_calendar.sql para guardar el tipo de visita.':'No se pudo guardar la visita en este momento.'):saveError.message||'No se pudo guardar la visita.');
  }finally{setBusy(false)}
 };
 const completeVisit=async visit=>{
  setError('');setBusy(true);
  try{const{error:completeError}=await sb.rpc('complete_visit',{visit_id:visit.id});if(completeError)throw completeError;await load()}
  catch(completeError){setError(completeError.message||'No se pudo marcar la visita como realizada.')}
  finally{setBusy(false)}
 };
 const confirmRemoveVisit=async()=>{
  const visit=pendingVisitDelete;if(!visit)return;
  setError('');setBusy(true);
  try{const{error:deleteError}=await sb.from('visitas').delete().eq('id',visit.id);if(deleteError)throw deleteError;setPendingVisitDelete(null);await load()}
  catch(deleteError){setError(deleteError.message||'No se pudo eliminar la visita.')}
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
  <div className="applications-heading"><div><span className="lbl">Agenda de instalaciones</span><h2>Aplicaciones</h2><p className="mut">Aplicaciones, visitas técnicas, visitas de garantía y mantenimientos en un solo calendario.</p></div>{canManage&&<div className="applications-heading-actions"><button type="button" className="btn" onClick={openNew}>+ Nueva aplicación</button><button type="button" className="btn ghost" onClick={()=>openNewVisit('tecnica')}>+ Visita técnica</button><button type="button" className="btn ghost" onClick={()=>openNewVisit('garantia')}>+ Visita de garantía</button></div>}</div>
  {loadError&&<p className="data-alert" role="alert">No se pudieron cargar las aplicaciones o mantenimientos: {loadError}</p>}
  {leadError&&canManage&&isRoot&&<p className="migration-hint" role="status">No se pudieron cargar las ventas cerradas para el formulario. Ejecuta <code>supabase/32_applications_calendar_and_maintenance.sql</code>. Aún puedes capturar un nuevo cliente.</p>}
  {error&&!form&&!maintenance&&!visitForm&&<p className="data-alert" role="alert">{error}</p>}
  <section className="applications-calendar">
   <div className="applications-calendar-header"><div><span className="lbl">Calendario de aplicaciones, visitas y mantenimiento</span><h3>{month.toLocaleDateString('es-MX',{month:'long',year:'numeric'})}</h3></div><div className="calendar-nav"><button type="button" className="btn ghost" aria-label="Mes anterior" onClick={()=>setMonth(new Date(year,monthIndex-1,1))}>‹</button><button type="button" className="btn ghost" onClick={()=>{const today=localDateKey(new Date());setMonth(new Date());setDay(today)}}>Hoy</button><button type="button" className="btn ghost" aria-label="Mes siguiente" onClick={()=>setMonth(new Date(year,monthIndex+1,1))}>›</button></div></div>
   <div className="applications-filters" role="group" aria-label="Filtrar calendario">{[['todo','Todo'],['aplicacion','Aplicaciones'],['tecnica','Visitas técnicas'],['garantia','Visitas de garantía'],['mantenimiento','Mantenimientos']].map(([value,label])=><button type="button" key={value} className={`btn ghost ${filter===value?'active':''}`} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}</button>)}</div>
   {loading&&!works.length&&!warranties.length&&!visits.length?<p className="mut">Cargando calendario…</p>:<div className="applications-calendar-layout">
    <div className="applications-calendar-grid">{['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map(name=><span className="calendar-weekday" key={name}>{name}</span>)}{dates.map(date=>{const key=localDateKey(date);const events=(eventsByDay.get(key)||[]).filter(matches);return <button type="button" key={key} className={`calendar-day ${date.getMonth()!==monthIndex?'outside':''} ${key===day?'selected':''} ${key===localDateKey(new Date())?'today':''} ${events.length?'has-events':''}`} aria-label={`${date.toLocaleDateString('es-MX')}, ${events.length} eventos`} onClick={()=>{setDay(key);if(date.getMonth()!==monthIndex)setMonth(new Date(date.getFullYear(),date.getMonth(),1))}}><span>{date.getDate()}</span>{events.length>0&&<small>{events.length}</small>}</button>})}</div>
    <aside className="applications-agenda"><div className="calendar-day-heading"><div><span className="lbl">Agenda del día</span><h4>{selectedDate.toLocaleDateString('es-MX',{weekday:'long',day:'numeric',month:'long'})}</h4></div></div>
     {dayEvents.length?dayEvents.map((event,index)=>{
      if(event.kind==='application')return <article className="application-calendar-event" key={`app-${event.record.id}-${index}`}><span className="application-event-tag">Aplicación</span><strong>{event.record.cliente||'Cliente sin nombre'}</strong><small>{event.record.folio||'Sin folio'} · {event.record.direccion||'Sin dirección'}</small><small>{event.record.status||'por_iniciar'} · {event.record.m2||0} m²</small>{canManage&&<div className="application-event-actions"><button type="button" className="btn ghost" onClick={()=>openEdit(event.record)}>Editar aplicación</button><button type="button" className="btn red" disabled={busy} onClick={()=>remove(event.record)}>Eliminar</button></div>}</article>;
      if(event.kind==='maintenance')return <article className="application-calendar-event maintenance-event" key={`mtto-${event.record.id}-${index}`}><span className="application-event-tag">Mantenimiento</span><strong>{event.record.cliente||'Cliente sin nombre'}</strong><small>{event.record.folio||'Sin folio'} · Cada {event.record.intervalo_anios||2} años</small><small>{event.record.ultimo_mtto?`Último: ${displayDate(event.record.ultimo_mtto)}`:'Mantenimiento programado'}</small>{canManageMaintenance&&<button type="button" className="btn ghost" onClick={()=>openMaintenance(event.record)}>Agendar mantenimiento</button>}</article>;
      const visit=event.record;const warranty=event.kind==='visit_warranty';
      return <article className={`application-calendar-event ${warranty?'visit-warranty-event':'visit-technical-event'}`} key={`visit-${visit.id}-${index}`}><span className="application-event-tag">{warranty?VISIT_TYPES.garantia:VISIT_TYPES.tecnica}</span><strong>{visit.cliente||'Cliente sin nombre'}</strong><small>{visitTime(visit.programacion)||'Sin hora'} · {visit.ubicacion||'Sin ubicación'}</small><small>{VISIT_STATUS[visit.status]||visit.status} · {visit.tecnico||'Técnico no asignado'}</small>{visit.notas&&<small>{visit.notas}</small>}{canManage&&<div className="application-event-actions">{visit.status==='por_visitar'&&<button type="button" className="btn" disabled={busy} onClick={()=>completeVisit(visit)}>Marcar hecha</button>}<button type="button" className="btn ghost" onClick={()=>openEditVisit(visit)}>Editar visita</button><button type="button" className="btn red" disabled={busy} onClick={()=>setPendingVisitDelete(visit)}>Eliminar</button></div>}</article>;
     }):<p className="mut">No hay aplicaciones, visitas ni mantenimientos para este día.</p>}
    </aside>
   </div>}
   <div className="applications-legend"><span><i className="application-dot"/> Aplicación</span><span><i className="technical-dot"/> Visita técnica</span><span><i className="warranty-dot"/> Visita de garantía</span><span><i className="maintenance-dot"/> Mantenimiento</span><span>{works.length} aplicaciones · {visits.filter(v=>v.status!=='cancelada'&&v.tipo!=='garantia').length} visitas técnicas · {visits.filter(v=>v.status!=='cancelada'&&v.tipo==='garantia').length} de garantía · {warranties.length} mantenimientos</span></div>
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
  {visitForm&&<div className="modal"><form className="card application-form" onSubmit={saveVisit}><div className="row"><div style={{flex:1}}><span className="lbl">{visitForm.id?'Editar visita':'Alta de visita'}</span><h3>{VISIT_TYPES[visitForm.tipo]}</h3></div><button type="button" className="btn ghost" disabled={busy} onClick={()=>setVisitForm(null)}>✕</button></div>
   <label htmlFor="visit-type">Tipo de visita</label><select id="visit-type" value={visitForm.tipo} onChange={event=>setVisitField('tipo',event.target.value)}><option value="tecnica">Visita técnica</option><option value="garantia">Visita de garantía</option></select>
   <label htmlFor="visit-client">Cliente</label><input id="visit-client" value={visitForm.cliente} onChange={event=>setVisitField('cliente',event.target.value)} required maxLength={160}/>
   <label htmlFor="visit-date">Fecha y hora</label><input id="visit-date" type="datetime-local" value={visitForm.programacion} onChange={event=>setVisitField('programacion',event.target.value)} required/>
   <label htmlFor="visit-location">Ubicación</label><input id="visit-location" value={visitForm.ubicacion} onChange={event=>setVisitField('ubicacion',event.target.value)} maxLength={500}/>
   <label htmlFor="visit-tech">Técnico</label><input id="visit-tech" value={visitForm.tecnico} onChange={event=>setVisitField('tecnico',event.target.value)} maxLength={160}/>
   {visitForm.id&&<><label htmlFor="visit-status">Estado</label><select id="visit-status" value={visitForm.status} onChange={event=>setVisitField('status',event.target.value)}>{Object.entries(VISIT_STATUS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></>}
   <label htmlFor="visit-notes">Notas</label><textarea id="visit-notes" rows={3} value={visitForm.notas} onChange={event=>setVisitField('notas',event.target.value)} maxLength={1000}/>
   {error&&<p className="data-alert" role="alert">{error}</p>}<div className="row"><button type="submit" className="btn" disabled={busy}>{busy?'Guardando…':'Guardar visita'}</button><button type="button" className="btn ghost" disabled={busy} onClick={()=>setVisitForm(null)}>Cancelar</button></div>
  </form></div>}
  <ConfirmDialog open={Boolean(pendingVisitDelete)} title="Eliminar visita" message={pendingVisitDelete?`¿Eliminar la ${(VISIT_TYPES[pendingVisitDelete.tipo]||'visita').toLowerCase()} de ${pendingVisitDelete.cliente||'este cliente'}?`:''} confirmLabel="Eliminar" tone="danger" busy={busy} onConfirm={confirmRemoveVisit} onCancel={()=>{if(!busy)setPendingVisitDelete(null)}}/>
  {maintenance&&<div className="modal"><form className="card application-form" onSubmit={saveMaintenance}><div className="row"><div style={{flex:1}}><span className="lbl">Agenda de mantenimiento</span><h3>{maintenance.cliente||'Cliente'}</h3></div><button type="button" className="btn ghost" disabled={busy} onClick={()=>setMaintenance(null)}>✕</button></div><p className="mut">Cada {maintenance.intervalo_anios||2} años · {maintenance.folio||'Sin folio'}</p><label htmlFor="scheduled-maintenance-date">Próxima fecha de mantenimiento</label><input id="scheduled-maintenance-date" type="date" value={maintenanceDate} onChange={event=>setMaintenanceDate(event.target.value)} required/>{error&&<p className="data-alert" role="alert">{error}</p>}<div className="row"><button type="submit" className="btn" disabled={busy}>{busy?'Guardando…':'Guardar fecha'}</button><button type="button" className="btn ghost" disabled={busy} onClick={()=>setMaintenance(null)}>Cancelar</button></div></form></div>}
  <ConfirmDialog open={Boolean(pendingDelete)} title="Eliminar aplicación" message={pendingDelete?`¿Eliminar la aplicación de ${pendingDelete.cliente||'este cliente'}? También se eliminará su agenda de mantenimiento.`:''} confirmLabel="Eliminar" tone="danger" busy={busy} onConfirm={confirmRemove} onCancel={()=>{if(!busy)setPendingDelete(null)}}/>
 </section>;
}

export default Applications;
