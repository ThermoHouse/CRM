import fs from 'fs';
const path = 'src/finance.jsx';
let s = fs.readFileSync(path, 'utf8');
const old = `export function Finanzas({readOnly=false,canDelete=false,canDeletePettyCash=canDelete,canRequestChanges=false}){
  const[sub,setSub]=useState('libro');
  const tabs=[['libro','Libro'],['caja','Caja chica'],['categorias','Categorías']];
  return <div className="finance-page"><div className="subtabs" role="tablist" aria-label="Finanzas">{tabs.map(([key,label])=><button key={key} type="button" role="tab" aria-selected={sub===key} className={sub===key?'on':''} onClick={()=>setSub(key)}>{label}</button>)}</div>
    {readOnly&&<p className="mut">Vista de solo lectura.</p>}
    {sub==='libro'&&<Libro readOnly={readOnly} canDelete={canDelete} canRequestChanges={canRequestChanges}/>}
    {sub==='caja'&&<CajaChica readOnly={readOnly} canDelete={canDeletePettyCash} canRequestChanges={canRequestChanges}/>}
    {sub==='categorias'&&<Categorias readOnly={readOnly}/>}
  </div>}`;
if (!s.includes(old)) { console.error('NOT FOUND'); process.exit(1); }
const nomina = `function Nomina({readOnly=false,canDelete=false}){
  const[rows,load,state]=useQuery(()=>sb.from('nomina_registros').select('*').order('created_at',{ascending:false}),[]);
  const[profiles,setProfiles]=useState([]);
  const[profilesError,setProfilesError]=useState('');
  const[form,setForm]=useState(null);
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState('');
  const[pendingDelete,setPendingDelete]=useState(null);

  useEffect(()=>{let alive=true;sb.rpc('nomina_profiles_directory').then(({data,error:rpcError})=>{
    if(!alive)return;
    if(rpcError){setProfiles([]);setProfilesError(rpcError.message||'');return}
    setProfiles(data||[]);setProfilesError('');
  });return()=>{alive=false}},[]);

  const blank=()=>({profile_id:'',nombre:'',cargo:'',salario_base_diario:'',bono_puntualidad:'',bono_desempeno:'',comisiones:'',multa_penalizaciones:''});
  const toNum=value=>{const n=Number(value);return Number.isFinite(n)?n:0};
  const calcTotal=data=>toNum(data.salario_base_diario)+toNum(data.bono_puntualidad)+toNum(data.bono_desempeno)+toNum(data.comisiones)-toNum(data.multa_penalizaciones);
  const set=key=>event=>setForm(current=>({...current,[key]:event.target.value}));
  const pickProfile=event=>{
    const id=event.target.value;
    if(!id){setForm(current=>({...current,profile_id:''}));return}
    const profile=profiles.find(item=>item.id===id);
    setForm(current=>({
      ...current,
      profile_id:id,
      nombre:profile?.display_name||current.nombre||'',
      cargo:profile?.cargo||current.cargo||''
    }));
  };
  const openEdit=row=>setForm({
    id:row.id,
    profile_id:row.profile_id||'',
    nombre:row.nombre||'',
    cargo:row.cargo||'',
    salario_base_diario:row.salario_base_diario??'',
    bono_puntualidad:row.bono_puntualidad??'',
    bono_desempeno:row.bono_desempeno??'',
    comisiones:row.comisiones??'',
    multa_penalizaciones:row.multa_penalizaciones??''
  });
  const save=async event=>{
    event.preventDefault();
    setError('');setBusy(true);
    try{
      const row={
        profile_id:form.profile_id||null,
        nombre:(form.nombre||'').trim(),
        cargo:(form.cargo||'').trim()||null,
        salario_base_diario:toNum(form.salario_base_diario),
        bono_puntualidad:toNum(form.bono_puntualidad),
        bono_desempeno:toNum(form.bono_desempeno),
        comisiones:toNum(form.comisiones),
        multa_penalizaciones:toNum(form.multa_penalizaciones)
      };
      if(!row.nombre)throw new Error('Escribe el nombre.');
      const query=form.id
        ?sb.from('nomina_registros').update(row).eq('id',form.id)
        :sb.from('nomina_registros').insert(row);
      const{error:saveError}=await query;
      if(saveError)throw saveError;
      setForm(null);await load();
    }catch(err){setError(err.message||'No se pudo guardar el registro de nómina.')}finally{setBusy(false)}
  };
  const confirmRemove=async()=>{
    const row=pendingDelete;if(!row)return;
    setError('');setBusy(true);
    try{
      const{error:deleteError}=await sb.from('nomina_registros').delete().eq('id',row.id);
      if(deleteError)throw deleteError;
      setPendingDelete(null);await load();
    }catch(err){setError(err.message||'No se pudo eliminar.')}finally{setBusy(false)}
  };

  const tableMissing=/nomina_registros|nomina_profiles_directory|Could not find/i.test(state.error||profilesError||error);
  const totalNomina=sum(rows,row=>row.total);

  return <div className="card tbl">
    <div className="row"><div style={{flex:1}}><span className="lbl">Nómina</span><h3>Perfiles y registro de nómina</h3><p className="mut" style={{margin:'4px 0 0'}}>Crea perfiles manualmente o retoma usuarios que ya usan el CRM para precargar su información.</p></div>{!readOnly&&<button type="button" className="btn" onClick={()=>setForm(blank())}>+ Registro</button>}</div>
    <div className="grid4" style={{marginBottom:12}}>
      <Kpi label="Registros" value={rows.length}/>
      <Kpi label="Total nómina" value={money(totalNomina)}/>
    </div>
    {error&&<p className="data-alert" role="alert">{error}</p>}
    {profilesError&&!state.error&&<p className="mut">No se pudieron cargar perfiles del CRM para precarga: {profilesError}{/nomina_profiles_directory|function|No autorizado/i.test(profilesError)?' (puedes dar de alta manualmente; ejecuta supabase/48_nomina.sql si falta la función).':''}</p>}
    <Feedback state={state} empty={tableMissing?'':'No hay registros de nómina.'}/>
    {tableMissing&&<p className="mut">Ejecuta <code>supabase/48_nomina.sql</code> en Supabase para habilitar Nómina.</p>}
    {rows.length>0&&<div style={{overflowX:'auto'}}><table><thead><tr><th>Nombre</th><th>Cargo o posición</th><th>Salario base diario</th><th>Bono puntualidad</th><th>Bono desempeño</th><th>Comisiones</th><th>Multa o penalizaciones</th><th>Total</th>{!readOnly&&<th>Acciones</th>}</tr></thead><tbody>
      {rows.map(row=><tr key={row.id}>
        <td><strong>{row.nombre||'—'}</strong>{row.profile_id&&<div className="mut">Perfil CRM vinculado</div>}</td>
        <td>{row.cargo||'—'}</td>
        <td>{money(row.salario_base_diario)}</td>
        <td>{money(row.bono_puntualidad)}</td>
        <td>{money(row.bono_desempeno)}</td>
        <td>{money(row.comisiones)}</td>
        <td>{money(row.multa_penalizaciones)}</td>
        <td><strong>{money(row.total)}</strong></td>
        {!readOnly&&<td className="row"><button type="button" className="btn ghost" onClick={()=>openEdit(row)}>Editar</button>{canDelete&&<button type="button" className="btn red ghost" onClick={()=>setPendingDelete(row)}>Eliminar</button>}</td>}
      </tr>)}
    </tbody></table></div>}

    {form&&<div className="modal-bg" role="dialog" aria-modal="true" aria-label={form.id?'Editar registro de nómina':'Nuevo registro de nómina'} onClick={event=>{if(event.target===event.currentTarget&&!busy)setForm(null)}}>
      <form className="modal-card finance-form" onSubmit={save}>
        <div className="row"><h3 style={{flex:1}}>{form.id?'Editar registro de nómina':'Nuevo registro de nómina'}</h3><button type="button" className="btn ghost" disabled={busy} onClick={()=>setForm(null)}>Cerrar</button></div>
        {profiles.length>0&&<><label htmlFor="nomina-profile">Retomar perfil del CRM (opcional)</label><select id="nomina-profile" value={form.profile_id||''} onChange={pickProfile} disabled={busy}><option value="">— Alta manual —</option>{profiles.map(profile=><option key={profile.id} value={profile.id}>{profile.display_name}{profile.email?\` · \${profile.email}\`:''}{profile.cargo?\` · \${profile.cargo}\`:''}</option>)}</select></>}
        <label htmlFor="nomina-nombre">Nombre</label><input id="nomina-nombre" required maxLength={120} value={form.nombre} onChange={set('nombre')} disabled={busy}/>
        <label htmlFor="nomina-cargo">Cargo o posición</label><input id="nomina-cargo" maxLength={120} value={form.cargo} onChange={set('cargo')} disabled={busy}/>
        <label htmlFor="nomina-salario">Salario base diario</label><input id="nomina-salario" type="number" min="0" step="0.01" value={form.salario_base_diario} onChange={set('salario_base_diario')} disabled={busy}/>
        <label htmlFor="nomina-puntualidad">Bono de puntualidad</label><input id="nomina-puntualidad" type="number" min="0" step="0.01" value={form.bono_puntualidad} onChange={set('bono_puntualidad')} disabled={busy}/>
        <label htmlFor="nomina-desempeno">Bono de desempeño</label><input id="nomina-desempeno" type="number" min="0" step="0.01" value={form.bono_desempeno} onChange={set('bono_desempeno')} disabled={busy}/>
        <label htmlFor="nomina-comisiones">Comisiones</label><input id="nomina-comisiones" type="number" min="0" step="0.01" value={form.comisiones} onChange={set('comisiones')} disabled={busy}/>
        <label htmlFor="nomina-multa">Multa o penalizaciones</label><input id="nomina-multa" type="number" min="0" step="0.01" value={form.multa_penalizaciones} onChange={set('multa_penalizaciones')} disabled={busy}/>
        <div className="card" style={{marginTop:8}}><span className="lbl">Total</span><strong className="big">{money(calcTotal(form))}</strong></div>
        {error&&<p className="data-alert" role="alert">{error}</p>}
        <div className="row" style={{justifyContent:'flex-end'}}><button type="button" className="btn ghost" disabled={busy} onClick={()=>setForm(null)}>Cancelar</button><button className="btn" type="submit" disabled={busy}>{busy?'Guardando…':form.id?'Guardar cambios':'Crear registro'}</button></div>
      </form>
    </div>}
    <ConfirmDialog open={Boolean(pendingDelete)} title="Eliminar registro de nómina" message={pendingDelete?\`¿Eliminar el registro de \${pendingDelete.nombre||'nómina'}?\`:' '} confirmLabel="Eliminar" tone="danger" busy={busy} onConfirm={confirmRemove} onCancel={()=>{if(!busy)setPendingDelete(null)}}/>
  </div>;
}

`;
const neu = `export function Finanzas({readOnly=false,canDelete=false,canDeletePettyCash=canDelete,canRequestChanges=false}){
  const[sub,setSub]=useState('libro');
  const tabs=[['libro','Libro'],['caja','Caja chica'],['categorias','Categorías'],['nomina','Nómina']];
  return <div className="finance-page"><div className="subtabs" role="tablist" aria-label="Finanzas">{tabs.map(([key,label])=><button key={key} type="button" role="tab" aria-selected={sub===key} className={sub===key?'on':''} onClick={()=>setSub(key)}>{label}</button>)}</div>
    {readOnly&&<p className="mut">Vista de solo lectura.</p>}
    {sub==='libro'&&<Libro readOnly={readOnly} canDelete={canDelete} canRequestChanges={canRequestChanges}/>}
    {sub==='caja'&&<CajaChica readOnly={readOnly} canDelete={canDeletePettyCash} canRequestChanges={canRequestChanges}/>}
    {sub==='categorias'&&<Categorias readOnly={readOnly}/>}
    {sub==='nomina'&&<Nomina readOnly={readOnly} canDelete={canDelete}/>}
  </div>}`;
s = s.replace(old, nomina + neu);
fs.writeFileSync(path, s);
console.log('patched');
