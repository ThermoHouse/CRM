import {useCallback,useEffect,useMemo,useState} from 'react';
import {sb} from './supabase';
import {downloadWarrantyReportPdf} from './warrantyReportPdf';

const dateKey=value=>value?String(value).slice(0,10):'';
const today=()=>{const date=new Date();return`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`};
const displayDate=value=>value?new Date(`${dateKey(value)}T12:00:00`).toLocaleDateString('es-MX',{dateStyle:'medium'}):'Sin fecha';
const safeFileName=value=>String(value||'archivo')
  .replace(/[^\w.\-]+/g,'_')
  .replace(/^\.+/,'')
  .slice(-80)||'archivo';
const newFolio=()=>`GAR-${today().replaceAll('-','')}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;

function createReportForm(guarantee,work,report){
 return{
  id:report?.id||null,
  guarantee_id:guarantee.id,
  folio:report?.folio||newFolio(),
  cliente:report?.cliente||guarantee.cliente||work?.cliente||'',
  domicilio:report?.domicilio||work?.direccion||'',
  sistema_instalado:report?.sistema_instalado||guarantee.sistema||work?.sistema||'',
  fecha_instalacion:dateKey(report?.fecha_instalacion||guarantee.instalacion||work?.programacion),
  fecha_visita:dateKey(report?.fecha_visita)||today(),
  tipo_visita:report?.tipo_visita||'Revisión por garantía',
  tecnico_responsable:report?.tecnico_responsable||'',
  motivo_visita:report?.motivo_visita||'',
  hallazgos:report?.hallazgos||'',
  analisis_tecnico:report?.analisis_tecnico||'',
  dictamen:report?.dictamen||'',
  recomendaciones:report?.recomendaciones||'',
  foto_paths:Array.from({length:4},(_,index)=>report?.foto_paths?.[index]||null),
  foto_files:Array(4).fill(null),
  pdf_path:report?.pdf_path||null,
  pdf_file:null,
 };
}

function WarrantyReports({canEdit,canManageMaintenance=false,userId}){
 const[guarantees,setGuarantees]=useState([]);
 const[works,setWorks]=useState([]);
 const[reports,setReports]=useState([]);
 const[loading,setLoading]=useState(true);
 const[loadError,setLoadError]=useState('');
 const[form,setForm]=useState(null);
 const[busy,setBusy]=useState(false);
 const[maintenanceBusy,setMaintenanceBusy]=useState(null);
 const[pdfBusy,setPdfBusy]=useState(null);
 const[message,setMessage]=useState('');
 const[error,setError]=useState('');
 const workById=useMemo(()=>new Map(works.map(work=>[work.id,work])),[works]);
 const reportsByGuarantee=useMemo(()=>reports.reduce((groups,report)=>{
  const grouped=groups.get(report.guarantee_id)||[];
  grouped.push(report);groups.set(report.guarantee_id,grouped);return groups;
 },new Map()),[reports]);
 const canEditReport=report=>canEdit&&(canManageMaintenance||report.created_by===userId);

 const load=useCallback(async()=>{
  setLoading(true);setLoadError('');
  const[guaranteesResult,worksResult,reportsResult]=await Promise.all([
   sb.from('garantias').select('*').order('proximo_mtto',{ascending:true}),
   sb.from('obras').select('*'),
   sb.from('warranty_reports').select('*').order('fecha_visita',{ascending:false}),
  ]);
  const failures=[guaranteesResult.error,worksResult.error,reportsResult.error].filter(Boolean);
  if(failures.length){
   const missingReportTable=failures.some(item=>/warranty_reports|schema cache/i.test(item.message||''));
   setLoadError(missingReportTable
    ?'Falta ejecutar supabase/39_warranty_report_workflow.sql para habilitar los reportes técnicos de garantía.'
    :failures.map(item=>item.message).join(' · '));
  }else{
   setGuarantees(guaranteesResult.data||[]);
   setWorks(worksResult.data||[]);
   setReports(reportsResult.data||[]);
  }
  setLoading(false);
 },[]);
 useEffect(()=>{load()},[load]);

 const beginCreate=guarantee=>{setError('');setMessage('');setForm(createReportForm(guarantee,workById.get(guarantee.obra_id),null))};
 const beginEdit=(guarantee,report)=>{setError('');setMessage('');setForm(createReportForm(guarantee,workById.get(guarantee.obra_id),report))};
 const setField=(key,value)=>setForm(current=>({...current,[key]:value}));
 const setPhotoFile=(index,file)=>setForm(current=>({...current,foto_files:current.foto_files.map((item,itemIndex)=>itemIndex===index?file:item)}));

 const save=async event=>{
  event.preventDefault();setError('');setMessage('');
  if(!form.cliente.trim()){setError('El nombre del cliente es obligatorio.');return}
  if(!form.folio.trim()){setError('El folio del reporte es obligatorio.');return}
  if(!form.fecha_visita){setError('La fecha de visita es obligatoria.');return}
  if(form.foto_files.some(file=>file&&(file.size>15*1024*1024||!['image/jpeg','image/png','image/webp'].includes(file.type)))){
   setError('Las evidencias deben ser JPG, PNG o WebP de máximo 15 MB cada una.');return;
  }
  if(form.pdf_file&&(form.pdf_file.type!=='application/pdf'||form.pdf_file.size>15*1024*1024)){
   setError('El archivo adjunto debe ser un PDF de máximo 15 MB.');return;
  }
  setBusy(true);
  let savedId=form.id;
  try{
   const{data:{user},error:userError}=await sb.auth.getUser();
   if(userError)throw userError;
   if(!user)throw new Error('La sesión expiró. Inicia sesión de nuevo.');
   const row={
    guarantee_id:form.guarantee_id,folio:form.folio.trim(),cliente:form.cliente.trim(),
    domicilio:form.domicilio.trim()||null,sistema_instalado:form.sistema_instalado.trim()||null,
    fecha_instalacion:form.fecha_instalacion||null,fecha_visita:form.fecha_visita,
    tipo_visita:form.tipo_visita,tecnico_responsable:form.tecnico_responsable.trim()||null,
    motivo_visita:form.motivo_visita.trim()||null,hallazgos:form.hallazgos.trim()||null,
    analisis_tecnico:form.analisis_tecnico.trim()||null,dictamen:form.dictamen.trim()||null,
    recomendaciones:form.recomendaciones.trim()||null,
   };
   if(savedId){
    const{error:saveError}=await sb.from('warranty_reports').update(row).eq('id',savedId);
    if(saveError)throw saveError;
   }else{
    const{data,error:saveError}=await sb.from('warranty_reports').insert({...row,created_by:user.id}).select('id').single();
    if(saveError)throw saveError;
    savedId=data.id;
    setForm(current=>current?{...current,id:data.id}:current);
   }

   const photoPaths=[...form.foto_paths];
   const uploadedPaths=[];
   const replacedPaths=[];
   let pdfPath=form.pdf_path;
   try{
    for(let index=0;index<form.foto_files.length;index++){
     const file=form.foto_files[index];
     if(!file)continue;
     const oldPath=photoPaths[index];
     const path=`${savedId}/fotos/${index+1}-${Date.now()}-${safeFileName(file.name)}`;
     const{error:uploadError}=await sb.storage.from('warranty-reports').upload(path,file,{contentType:file.type,upsert:false});
     if(uploadError)throw uploadError;
     uploadedPaths.push(path);photoPaths[index]=path;if(oldPath)replacedPaths.push(oldPath);
    }
    if(form.pdf_file){
     const oldPath=pdfPath;
     const path=`${savedId}/pdf/${Date.now()}-${safeFileName(form.pdf_file.name)}`;
     const{error:uploadError}=await sb.storage.from('warranty-reports').upload(path,form.pdf_file,{contentType:'application/pdf',upsert:false});
     if(uploadError)throw uploadError;
     uploadedPaths.push(path);pdfPath=path;if(oldPath)replacedPaths.push(oldPath);
    }
    if(uploadedPaths.length){
     const{error:attachmentError}=await sb.from('warranty_reports').update({foto_paths:photoPaths,pdf_path:pdfPath}).eq('id',savedId);
     if(attachmentError)throw attachmentError;
    }
   }catch(attachmentError){
    if(uploadedPaths.length){
     const{error:cleanupError}=await sb.storage.from('warranty-reports').remove(uploadedPaths);
     if(cleanupError)throw new Error(`El reporte se guardó, pero falló un adjunto: ${attachmentError.message}. No se pudo limpiar el archivo temporal: ${cleanupError.message}`);
    }
    setForm(current=>current?{...current,id:savedId}:current);
    throw new Error(`El reporte se guardó, pero falló un adjunto. Corrige el archivo y vuelve a guardar: ${attachmentError.message}`);
   }
   let cleanupWarning='';
   if(replacedPaths.length){
    const{error:removeError}=await sb.storage.from('warranty-reports').remove(replacedPaths);
    if(removeError)cleanupWarning=`El reporte se guardó, pero no se pudo retirar el adjunto anterior: ${removeError.message}`;
   }
   setForm(null);setMessage(cleanupWarning||'Reporte de garantía guardado.');
   if(cleanupWarning)setError(cleanupWarning);
   await load();
  }catch(saveError){
   const message=saveError.message||'No se pudo guardar el reporte de garantía.';
   setError(saveError.code==='42501'||/row-level security|permission denied/i.test(message)
    ?'Supabase rechazó el guardado. Ejecuta supabase/41_sales_warranty_admin_finance_delete.sql para habilitar a Ventas y vuelve a intentarlo.'
    :message);
  }
  finally{setBusy(false)}
 };

 const openAttachedPdf=async report=>{
  setError('');
  const tab=window.open('about:blank','_blank');
  if(!tab){setError('Permite ventanas emergentes para abrir el PDF adjunto.');return}
  tab.opener=null;
  try{
   const{data,error:urlError}=await sb.storage.from('warranty-reports').createSignedUrl(report.pdf_path,300);
   if(urlError)throw urlError;
   if(!data?.signedUrl)throw new Error('No se pudo crear el enlace temporal del PDF.');
   tab.location.href=data.signedUrl;
  }catch(openError){tab.close();setError(openError.message||'No se pudo abrir el PDF adjunto.')}
 };

 const markMaintenanceComplete=async guarantee=>{
  if(!window.confirm(`¿Registrar como realizado el mantenimiento de ${guarantee.cliente||'este cliente'}? Se programará el siguiente ciclo.`))return;
  setError('');setMaintenanceBusy(guarantee.id);
  try{
   const{error:updateError}=await sb.from('garantias').update({status:'mantenimiento_hecho'}).eq('id',guarantee.id);
   if(updateError)throw updateError;
   await load();
   setMessage('Mantenimiento registrado; el siguiente ciclo quedó programado.');
  }catch(updateError){setError(updateError.message||'No se pudo registrar el mantenimiento.')}
  finally{setMaintenanceBusy(null)}
 };

 const generatePdf=async report=>{
  setError('');setPdfBusy(report.id);
  try{
   const photoUrls=await Promise.all((report.foto_paths||[]).map(async path=>{
    if(!path)return null;
    const{data,error:urlError}=await sb.storage.from('warranty-reports').createSignedUrl(path,300);
    if(urlError)throw urlError;
    if(!data?.signedUrl)throw new Error('No se pudo crear un enlace temporal para una fotografía.');
    return data.signedUrl;
   }));
   await downloadWarrantyReportPdf(report,photoUrls);
  }catch(pdfError){setError(pdfError.message||'No se pudo generar el PDF de garantía.')}
  finally{setPdfBusy(null)}
 };

 return <section className="warranty-page">
  <div className="warranty-heading"><div><span className="lbl">Garantías y mantenimientos</span><h2>Reportes técnicos</h2><p className="mut">Consulta el historial por instalación, genera el reporte de garantía o abre el PDF adjunto.</p></div></div>
  {loadError&&<p className="data-alert" role="alert">{loadError}</p>}
  {error&&<p className="data-alert" role="alert">{error}</p>}
  {message&&<p className="panel-feedback" role="status">{message}</p>}
  {loading&&!guarantees.length?<p className="mut">Cargando garantías…</p>:!loadError&&!guarantees.length?<p className="mut">No hay garantías registradas.</p>:<div className="warranty-list">
   {guarantees.map(guarantee=>{
    const work=workById.get(guarantee.obra_id);
    const items=reportsByGuarantee.get(guarantee.id)||[];
    return <article className="card warranty-card" key={guarantee.id}>
     <header className="warranty-card-heading"><div><span className="lbl">Instalación · {guarantee.folio||work?.folio||'Sin folio'}</span><h3>{guarantee.cliente||work?.cliente||'Cliente sin nombre'}</h3><p className="mut">{guarantee.sistema||work?.sistema||'Sistema no especificado'} · Instalación {displayDate(guarantee.instalacion||work?.programacion)}</p></div><div className="warranty-dates"><span>Próximo mantenimiento</span><strong>{displayDate(guarantee.proximo_mtto)}</strong>{canManageMaintenance&&<button type="button" className="btn ghost" disabled={maintenanceBusy===guarantee.id} onClick={()=>markMaintenanceComplete(guarantee)}>{maintenanceBusy===guarantee.id?'Guardando…':'Registrar realizado'}</button>}</div></header>
     <div className="warranty-reports">
      <div className="row"><strong>Historial de reportes ({items.length})</strong>{canEdit&&<button type="button" className="btn" onClick={()=>beginCreate(guarantee)}>+ Nuevo reporte</button>}</div>
      {items.length?items.map(report=><div className="warranty-report-row" key={report.id}>
       <div><strong>{report.folio}</strong><span>{displayDate(report.fecha_visita)} · {report.tipo_visita}</span><small>{report.tecnico_responsable||'Técnico no asignado'} · {report.foto_paths?.filter(Boolean).length||0} evidencias</small></div>
       <div className="row warranty-report-actions"><button type="button" className="btn ghost" disabled={pdfBusy===report.id} onClick={()=>generatePdf(report)}>{pdfBusy===report.id?'Generando…':'Generar PDF'}</button>{report.pdf_path&&<button type="button" className="btn ghost" onClick={()=>openAttachedPdf(report)}>Abrir PDF adjunto</button>}{canEditReport(report)&&<button type="button" className="btn ghost" onClick={()=>beginEdit(guarantee,report)}>Editar</button>}</div>
      </div>):<p className="mut">Aún no hay reportes técnicos para esta garantía.</p>}
     </div>
    </article>
   })}
  </div>}
  {form&&<div className="modal"><form className="card warranty-form" onSubmit={save}>
   <div className="row"><div style={{flex:1}}><span className="lbl">{form.id?'Editar reporte':'Nuevo reporte técnico'}</span><h3>Reporte de garantía</h3></div><button type="button" className="btn ghost" disabled={busy} onClick={()=>setForm(null)}>✕</button></div>
   <div className="warranty-form-grid">
    <div><label>Cliente</label><input maxLength={160} value={form.cliente} onChange={event=>setField('cliente',event.target.value)} required/></div>
    <div><label>Folio / reporte</label><input maxLength={80} value={form.folio} onChange={event=>setField('folio',event.target.value)} required/></div>
    <div className="wide"><label>Domicilio</label><input maxLength={500} value={form.domicilio} onChange={event=>setField('domicilio',event.target.value)}/></div>
    <div><label>Sistema instalado</label><input maxLength={160} value={form.sistema_instalado} onChange={event=>setField('sistema_instalado',event.target.value)}/></div>
    <div><label>Fecha de instalación</label><input type="date" value={form.fecha_instalacion} onChange={event=>setField('fecha_instalacion',event.target.value)}/></div>
    <div><label>Fecha de visita</label><input type="date" value={form.fecha_visita} onChange={event=>setField('fecha_visita',event.target.value)} required/></div>
    <div><label>Tipo de visita</label><select value={form.tipo_visita} onChange={event=>setField('tipo_visita',event.target.value)}>{['Revisión por garantía','Mantenimiento preventivo','Revisión técnica'].map(type=><option key={type}>{type}</option>)}</select></div>
    <div className="wide"><label>Técnico responsable</label><input maxLength={160} value={form.tecnico_responsable} onChange={event=>setField('tecnico_responsable',event.target.value)}/></div>
    <div className="wide"><label>1. Motivo de la visita</label><textarea rows={3} value={form.motivo_visita} onChange={event=>setField('motivo_visita',event.target.value)}/></div>
    <div className="wide"><label>2. Hallazgos de la inspección</label><textarea rows={4} value={form.hallazgos} onChange={event=>setField('hallazgos',event.target.value)}/></div>
    <div className="wide"><label>3. Análisis técnico</label><textarea rows={4} value={form.analisis_tecnico} onChange={event=>setField('analisis_tecnico',event.target.value)}/></div>
    <div className="wide"><label>5. Dictamen</label><textarea rows={3} value={form.dictamen} onChange={event=>setField('dictamen',event.target.value)}/></div>
    <div className="wide"><label>6. Recomendaciones</label><textarea rows={3} value={form.recomendaciones} onChange={event=>setField('recomendaciones',event.target.value)}/></div>
    <div className="wide"><strong>4. Evidencia fotográfica (hasta 4 imágenes)</strong><div className="warranty-photo-inputs">{form.foto_paths.map((path,index)=><div key={index}><label htmlFor={`warranty-photo-${index}`}>Fotografía {index+1}</label><input id={`warranty-photo-${index}`} type="file" accept="image/jpeg,image/png,image/webp" onChange={event=>setPhotoFile(index,event.target.files?.[0]||null)}/><small>{form.foto_files[index]?.name||path?.split('/').pop()||'Sin archivo'}</small></div>)}</div></div>
    <div className="wide"><label htmlFor="warranty-pdf">Adjuntar PDF existente (opcional)</label><input id="warranty-pdf" type="file" accept="application/pdf,.pdf" onChange={event=>setField('pdf_file',event.target.files?.[0]||null)}/><small className="field-hint">{form.pdf_file?.name||form.pdf_path?.split('/').pop()||'Sin PDF adjunto'}</small></div>
   </div>
   {error&&<p className="data-alert" role="alert">{error}</p>}
   <div className="row"><button type="submit" className="btn" disabled={busy}>{busy?'Guardando…':'Guardar reporte'}</button><button type="button" className="btn ghost" disabled={busy} onClick={()=>setForm(null)}>Cancelar</button></div>
  </form></div>}
 </section>;
}

export default WarrantyReports;
