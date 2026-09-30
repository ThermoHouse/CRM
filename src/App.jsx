import {useEffect,useState,useCallback} from 'react';import {sb} from './supabase';
const TABS=['Dashboard','Leads','Inbox Bot','Visitas','Instalaciones','Mantenimiento','Operaciones','Inventario'];
const STAT=['nuevo','contactado','visita','visitado','cerrado','rescatar','no'];
const PLAZAS=['Cuernavaca','Chihuahua','Playa del Carmen','Mérida'];
const PER=[['Histórico',0],['Hoy',1],['7 días',7],['30 días',30]];
const wa=n=>'https://wa.me/52'+String(n||'').replace(/\D/g,'').slice(-10);
const inPer=(x,d)=>!d||new Date(x.created_at)>=new Date(Date.now()-d*864e5);
const Filt=({plaza,setPlaza,per,setPer})=><div className="row"><select style={{width:160}} value={plaza} onChange={e=>setPlaza(e.target.value)}><option value="">Todas las plazas</option>{PLAZAS.map(p=><option key={p}>{p}</option>)}</select><select style={{width:130}} value={per} onChange={e=>setPer(+e.target.value)}>{PER.map(([n,d])=><option key={n} value={d}>{n}</option>)}</select></div>;
const Bars=({rows})=>{const m=Math.max(1,...rows.map(r=>r[1]));return rows.map(([k,v])=><div key={k} style={{marginTop:10}}><div className="row" style={{margin:0,justifyContent:'space-between'}}><span className="mut">{k}</span><b>{v}</b></div><div className="bar"><i style={{width:v/m*100+'%'}}/></div></div>)};
const tally=(l,f)=>Object.entries(l.reduce((a,x)=>{const k=f(x)||'Sin dato';a[k]=(a[k]||0)+1;return a},{})).sort((a,b)=>b[1]-a[1]);
const money=n=>'$'+Number(n||0).toLocaleString('es-MX');
const useRows=(t,order='created_at')=>{const[r,setR]=useState([]);const load=useCallback(async()=>{const{data}=await sb.from(t).select('*').order(order,{ascending:false});setR(data||[])},[t,order]);useEffect(()=>{load()},[load]);return[r,load]};

function Login(){const[e,setE]=useState('');const[p,setP]=useState('');const[m,setM]=useState('');
 return <div className="login"><h1>NEXUS <b>ADMIN</b></h1><input placeholder="Correo" value={e} onChange={x=>setE(x.target.value)}/>
 <input type="password" placeholder="Contraseña" value={p} onChange={x=>setP(x.target.value)}/>
 <button className="btn" onClick={async()=>{const{error}=await sb.auth.signInWithPassword({email:e,password:p});if(error)setM(error.message)}}>Entrar</button><span className="mut">{m}</span></div>}

function Dashboard(){const[all]=useRows('leads');const[plaza,setPlaza]=useState('');const[per,setPer]=useState(0);
 const l=all.filter(x=>inPer(x,per)&&(!plaza||(x.ciudad||'').includes(plaza)));const n=l.length||1;const c=s=>l.filter(x=>x.status===s).length;
 const cerr=c('cerrado'),sin=l.filter(x=>x.status==='nuevo'),pag=tally(l.filter(x=>x.tipo_precio),x=>x.tipo_precio==='efectivo'?'Contado':'12 MSI'),ases=[...new Set(l.map(x=>x.asesor).filter(Boolean))];
 const P=[['rescatar','Por rescatar'],['nuevo','Nuevo'],['contactado','Contactado'],['visita','Visita técnica'],['cerrado','Cerrado']];
 return <><div className="row"><h2 style={{flex:1,margin:0}}>Dashboard general</h2><Filt {...{plaza,setPlaza,per,setPer}}/></div>
 <div className="grid">{P.map(([s,t])=><div className="card" key={s}><span className="lbl">{t}</span><div className={'big '+(s==='cerrado'?'or':'')}>{c(s)}</div><span className="mut">{Math.round(c(s)/n*100)}% del total</span><div className="bar"><i style={{width:c(s)/n*100+'%'}}/></div></div>)}</div>
 <div className="grid">{[['Total leads',l.length],['Ventas cerradas',cerr],['Tasa de conversión',(l.length?Math.round(cerr/l.length*100):0)+'%'],['Sin atender',sin.length]].map(([t,v])=><div className="card" key={t}><span className="lbl">{t}</span><div className="big or">{v}</div></div>)}</div>
 <div className="grid"><div className="card"><h3><span className="ico">📊</span>Sistemas más solicitados</h3><Bars rows={tally(l,x=>x.sistema)}/></div>
 <div className="card"><h3><span className="ico">💳</span>Preferencias de pago</h3><Bars rows={pag}/></div>
 <div className="card"><h3><span className="ico">📍</span>Por ciudad</h3><table><tbody>{tally(l,x=>(x.ciudad||'').split(',')[0].trim()).slice(0,8).map(([k,v])=><tr key={k}><td>{k}</td><td><b>{v}</b></td></tr>)}</tbody></table></div></div>
 <div className="card" style={{marginBottom:16}}><h3><span className="ico">🔔</span>Atención prioritaria</h3>{sin.slice(0,6).map(x=><div key={x.id} className="row"><span className="av">{(x.nombre||'?')[0]}</span><span style={{flex:1}}>{x.nombre}</span><span className="pill nuevo">sin atender</span></div>)}{!sin.length&&<p className="mut">Todo atendido.</p>}</div>
 <div className="grid">{ases.map(a=>{const m=l.filter(x=>x.asesor===a);const k=s=>m.filter(x=>x.status===s).length;return <div className="card" key={a}><span className="lbl">{a}</span><div className="mut" style={{margin:'8px 0'}}>Nuevos {k('nuevo')} · Contactados {k('contactado')} · Visita {k('visita')} · Cerrados {k('cerrado')}</div><div className="big or">{Math.round(k('cerrado')/(m.length||1)*100)}%</div><span className="mut">% de cierre</span></div>})}</div></>}

function Quote({onClose,onSaved,init}){const[t,setT]=useState([]);useEffect(()=>{sb.from('tarifas').select('*').eq('ciudad','Cuernavaca').then(({data})=>setT(data||[]))},[]);
 const[f,setF]=useState({nombre:'',whatsapp:'',email:'',origen:'',ciudad:'Cuernavaca',cp:'',direccion:'',area_m2:0,tipo_precio:'efectivo',sistema:'TH FIX',costo_logistico:0,notas:'',voltaje:'',canal_venta:'',presentacion:'',fecha_contacto:'',...Object.fromEntries(Object.entries(init||{}).map(([k,v])=>[k,v??'']))});
 const s=k=>e=>setF({...f,[k]:e.target.value});const tar=t.find(x=>x.producto_id===f.sistema);
 const unit=tar?(f.tipo_precio==='efectivo'?tar.precio_contado:tar.precio_msi):0;
 const sub=f.area_m2>0?Math.max(unit*f.area_m2,tar?.minimo||0):0;const total=sub+Number(f.costo_logistico||0);
 const save=async()=>{const{data:{user}}=await sb.auth.getUser();const{id,created_at,...rest}=f;const row={...rest,area_m2:+f.area_m2||0,costo_logistico:+f.costo_logistico||0,total:tar?total:Number(init?.total||0),fecha_contacto:f.fecha_contacto||null,fecha_kam:f.fecha_kam||null,fecha_nacimiento:f.fecha_nacimiento||null};if(init?.id)await sb.from('leads').update(row).eq('id',init.id);else await sb.from('leads').insert({...row,asesor:user.email,folio:'QT-'+Date.now().toString().slice(-4)});onSaved();onClose()};
 return <div className="modal"><div className="card"><div className="row"><h3 style={{flex:1}}>Nueva cotización manual</h3><button className="btn ghost" onClick={onClose}>✕</button></div>
 <div className="f"><div><label>Nombre</label><input value={f.nombre} onChange={s('nombre')}/></div><div><label>WhatsApp</label><input value={f.whatsapp} onChange={s('whatsapp')}/></div>
 <div><label>Correo</label><input value={f.email} onChange={s('email')}/></div><div><label>Origen</label><select value={f.origen} onChange={s('origen')}><option value="">Seleccione…</option>{['WhatsApp','Facebook','Referido','Otro'].map(o=><option key={o}>{o}</option>)}</select></div>
 <div><label>Código postal</label><input value={f.cp} onChange={s('cp')}/></div><div><label>Zona de presupuesto</label><input value={f.ciudad} onChange={s('ciudad')}/></div>
 <div className="w"><label>Dirección exacta</label><input value={f.direccion} onChange={s('direccion')}/></div>
 <div><label>Área verificada (m²)</label><input type="number" value={f.area_m2} onChange={s('area_m2')}/></div>
 <div><label>Tipo de precio</label><select value={f.tipo_precio} onChange={s('tipo_precio')}><option value="efectivo">Efectivo</option><option value="msi">Lista/Promoción (MSI)</option></select></div>
 <div><label>Sistema</label><select value={f.sistema} onChange={s('sistema')}><option value="">—</option>{t.map(x=><option key={x.id} value={x.producto_id}>{x.producto_id}</option>)}</select></div>
 <div><label>Costo logístico (foráneo)</label><input type="number" value={f.costo_logistico} onChange={s('costo_logistico')}/></div>
 <div><label>Voltaje</label><input value={f.voltaje} onChange={s('voltaje')}/></div><div><label>Canal de venta</label><select value={f.canal_venta} onChange={s('canal_venta')}><option value="">—</option><option>Servicio al Cliente</option><option>KAM</option></select></div><div><label>Presentación contratada</label><input value={f.presentacion} onChange={s('presentacion')}/></div><div><label>Fecha de contacto</label><input type="date" value={f.fecha_contacto} onChange={s('fecha_contacto')}/></div>
 <div className="w"><label>Notas internas</label><textarea value={f.notas} onChange={s('notas')}/></div></div>
 <p className="big">Total estimado: {money(total)}</p><button className="btn" onClick={save} disabled={!f.nombre}>Guardar cotización</button></div></div>}

function Report({l,onClose}){return <div className="modal"><div className="card" style={{background:'#fff',color:'#000'}}><div className="print" style={{background:'#fff',color:'#000'}}>
 <h2 style={{color:'#ff7a1a'}}>THERMO HOUSE · Cotización {l.folio}</h2><p>{[l.nombre,l.whatsapp&&'+52 '+l.whatsapp].filter(Boolean).join(' · ')}<br/>{[l.direccion,l.ciudad].filter(Boolean).join(', ')}</p>
 <table><tbody><tr><td>{l.sistema} ({l.tipo_precio})</td><td>{l.area_m2} m²</td><td>{money(l.total)}</td></tr></tbody></table>
 <p>Precios en pesos mexicanos. Válidos 7 días hábiles. Atendido por: {l.asesor}</p></div>
 <div className="row"><button className="btn" onClick={()=>window.print()}>Generar PDF</button><button className="btn ghost" onClick={onClose}>Cerrar</button></div></div></div>}

function Leads(){const[l,load]=useRows('leads');const[q,setQ]=useState('');const[fs,setFs]=useState('');const[m,setM]=useState(false);const[rep,setRep]=useState(null);const[ed,setEd]=useState(null);const[plaza,setPlaza]=useState('');const[per,setPer]=useState(0);
 const rows=l.filter(x=>(!fs||x.status===fs)&&inPer(x,per)&&(!plaza||(x.ciudad||'').includes(plaza))&&((x.nombre||'')+(x.whatsapp||'')).toLowerCase().includes(q.toLowerCase()));
 return <><div className="row"><button className="btn" onClick={()=>setM(true)}>+ Nuevo cliente</button><input style={{maxWidth:240}} placeholder="Buscar cliente" value={q} onChange={e=>setQ(e.target.value)}/><Filt {...{plaza,setPlaza,per,setPer}}/>
 {['',...STAT].map(s=><button key={s} className={'btn chip '+(fs===s?'':'ghost')} onClick={()=>setFs(s)}>{s||'todos'}</button>)}</div>
 <div className="card tbl"><table><thead><tr><th>Cliente</th><th>Ubicación</th><th>Cotización</th><th>Asesor</th><th>Status</th><th/></tr></thead><tbody>
 {rows.map(x=><tr key={x.id}><td><span className="av">{(x.nombre||'?').split(' ').map(w=>w[0]).slice(0,2).join('')}</span>{x.nombre}<div className="mut">{x.whatsapp} · {x.folio}</div></td><td>{x.ciudad}<div className="mut">{x.area_m2} m² · {x.sistema}</div></td><td>{money(x.total)}</td><td>{x.asesor||'Sin asignar'}</td>
 <td><select value={x.status} onChange={async e=>{await sb.from('leads').update({status:e.target.value}).eq('id',x.id);load()}}>{STAT.map(s=><option key={s}>{s}</option>)}</select></td>
 <td><a className="btn ghost" style={{textDecoration:'none'}} href={wa(x.whatsapp)} target="_blank" rel="noreferrer">WhatsApp</a> <button className="btn ghost" onClick={()=>setEd(x)}>Editar</button> <button className="btn ghost" onClick={()=>setRep(x)}>PDF</button> <button className="btn red" onClick={async()=>{if(confirm('¿Eliminar este lead?')){await sb.from('leads').delete().eq('id',x.id);load()}}}>Eliminar</button></td></tr>)}</tbody></table></div>
 {m&&<Quote onClose={()=>setM(false)} onSaved={load}/>}{ed&&<Quote init={ed} onClose={()=>setEd(null)} onSaved={load}/>}{rep&&<Report l={rep} onClose={()=>setRep(null)}/>}</>}

function Crud({table,title,order,fields,extra}){const[r,load]=useRows(table,order);const[ed,setEd]=useState(null);const[e,setE]=useState({});
 const open=x=>{setEd(x);setE(Object.fromEntries(fields.map(([k])=>[k,x[k]??''])))};
 const save=async()=>{const row=Object.fromEntries(Object.entries(e).map(([k,v])=>[k,v===''?null:v]));const{error}=ed.id?await sb.from(table).update(row).eq('id',ed.id):await sb.from(table).insert(row);if(error)alert(error.message);else{setEd(null);load()}};
 const del=async()=>{if(confirm('¿Eliminar registro?')){await sb.from(table).delete().eq('id',ed.id);setEd(null);load()}};
 return <div className="card tbl"><div className="row"><h3 style={{flex:1}}>{title}</h3><button className="btn" onClick={()=>open({})}>+ Agregar</button></div>
 <table><thead><tr>{fields.map(f=><th key={f[0]}>{f[1]}</th>)}<th/></tr></thead><tbody>{r.map(x=><tr key={x.id}>{fields.map(f=><td key={f[0]}>{String(x[f[0]]??'')}</td>)}<td><button className="btn ghost" onClick={()=>open(x)}>Editar</button> {extra?.(x,load)}</td></tr>)}</tbody></table>
 {!r.length&&<p className="mut">Sin registros todavía. Usa "+ Agregar".</p>}
 {ed&&<div className="modal"><div className="card"><h3>{ed.id?'Editar':'Nuevo'} · {title}</h3><div className="f">{fields.map(([k,l,t,o])=><div key={k}><label>{l}</label>{t==='select'?<select value={e[k]} onChange={x=>setE({...e,[k]:x.target.value})}><option value="">—</option>{o.map(v=><option key={v}>{v}</option>)}</select>:<input type={t||'text'} value={e[k]} onChange={x=>setE({...e,[k]:x.target.value})}/>}</div>)}</div>
 <div className="row" style={{marginTop:14}}><button className="btn" onClick={save}>Guardar</button><button className="btn ghost" onClick={()=>setEd(null)}>Cancelar</button>{ed.id&&<button className="btn ghost" onClick={del}>Eliminar</button>}</div></div></div>}</div>}

function Precios(){const[r,load]=useRows('tarifas','producto_id');
 const up=async(id,k,v)=>{await sb.from('tarifas').update({[k]:+v}).eq('id',id);load()};
 return <div className="card"><h3>Lista de tarifas regionales</h3><table><thead><tr><th>Ciudad</th><th>Sistema</th><th>Contado /m²</th><th>MSI /m²</th><th>Mínimo</th></tr></thead><tbody>
 {r.map(x=><tr key={x.id}><td>{x.ciudad}</td><td>{x.producto_id}</td>{['precio_contado','precio_msi','minimo'].map(k=><td key={k}><input style={{width:90}} defaultValue={x[k]} onBlur={e=>up(x.id,k,e.target.value)}/></td>)}</tr>)}</tbody></table></div>}

export default function App(){const[s,setS]=useState(null);const[tab,setTab]=useState('Dashboard');
 useEffect(()=>{sb.auth.getSession().then(({data})=>setS(data.session));const{data:{subscription}}=sb.auth.onAuthStateChange((_,x)=>setS(x));return()=>subscription.unsubscribe()},[]);
 if(!s)return <Login/>;
 const V={Dashboard:<Dashboard/>,Leads:<Leads/>,
 'Inbox Bot':<Crud table="bot_inbox" title="Buzón bot" extra={(x,ld)=>x.status!=='convertido'&&<button className="btn" onClick={async()=>{const{data:{user}}=await sb.auth.getUser();const{error}=await sb.from('leads').insert({nombre:x.nombre,whatsapp:x.telefono,ciudad:x.ciudad,sistema:x.sistema,total:x.monto||0,origen:'Bot WhatsApp',notas:x.notas,asesor:user.email,folio:'QT-'+Date.now().toString().slice(-4)});if(error)return alert(error.message);await sb.from('bot_inbox').update({status:'convertido'}).eq('id',x.id);ld()}}>Convertir</button>} fields={[['nombre','Nombre'],['telefono','Teléfono'],['ciudad','Ciudad'],['sistema','Sistema'],['monto','Monto','number'],['status','Status','select',['pendiente','contactado','convertido','descartado']],['notas','Notas']]}/>,
 Visitas:<Crud table="visitas" title="Visitas" extra={(x,ld)=>x.status==='por_visitar'&&<button className="btn" onClick={async()=>{await sb.from('visitas').update({status:'realizada'}).eq('id',x.id);if(x.lead_id)await sb.from('leads').update({status:'visitado'}).eq('id',x.lead_id);ld()}}>Marcar hecha</button>} order="programacion" fields={[['cliente','Cliente'],['ubicacion','Ubicación'],['programacion','Programación','datetime-local'],['status','Status','select',['por_visitar','realizada','cancelada']]]}/>,
 Instalaciones:<Crud table="obras" title="Obras" order="programacion" fields={[['folio','Folio'],['cliente','Cliente'],['programacion','Programación','date'],['direccion','Dirección'],['m2','m²','number'],['status','Status','select',['por_iniciar','en_proceso','entregada']]]}/>,
 Mantenimiento:<Crud table="garantias" title="Gestión de garantías" order="proximo_mtto" fields={[['cliente','Cliente'],['folio','Folio'],['sistema','Sistema'],['instalacion','Instalación','date'],['proximo_mtto','Próximo mtto.','date'],['status','Status','select',['activa','vencida','mantenimiento_hecho']]]}/>,
 Operaciones:<Precios/>,
 Inventario:<Crud table="barriles" title="Control de inventario · barriles" order="entrada" fields={[['plaza','Plaza','select',['Cuernavaca','Chihuahua','Playa del Carmen','Mérida']],['tipo','Tipo','select',['isocianato','poliol']],['lote','Lote'],['estado','Estado','select',['cerrado','abierto','vacío']],['entrada','Entrada','date']]}/>};
 const[dk,setDk]=useState(()=>localStorage.getItem('th')||'dark');useEffect(()=>{document.documentElement.dataset.theme=dk;localStorage.setItem('th',dk)},[dk]);
 return <><header><div className="brand"><span className="logo">N</span><div><h1>NEXUS <b>ADMIN</b> <span className="mut">V1.1</span></h1><span className="badge">Acceso total</span> <span className="mut">{s.user?.email}</span></div></div><nav>{TABS.map(t=><button key={t} className={t===tab?'on':''} onClick={()=>setTab(t)}>{t}</button>)}</nav><div className="row" style={{margin:0}}><button className="btn ghost" onClick={()=>setDk(dk==='dark'?'light':'dark')}>{dk==='dark'?'☀️ Claro':'🌙 Oscuro'}</button><button className="btn red" onClick={()=>sb.auth.signOut()}>Salir</button></div></header><main>{V[tab]}</main></>}
