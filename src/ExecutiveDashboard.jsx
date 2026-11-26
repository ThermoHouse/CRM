import {useCallback,useEffect,useMemo,useState} from 'react';
import {sb} from './supabase';
import {buildAlerts} from './leadAlerts';

const DAY=86400000;
export const PERIODS=[
  {id:'semana',label:'Semana',days:7,buckets:7},
  {id:'mes',label:'Mes',days:30,buckets:6},
  {id:'trimestre',label:'Trimestre',days:90,buckets:9},
  {id:'semestre',label:'Semestre',days:180,buckets:6},
  {id:'anio',label:'Año',days:365,buckets:12},
];
const SOURCE_LABELS={leads:'Leads',open:'Seguimientos',mov:'Finanzas',caja:'Caja chica',stock:'Stock',imper:'Impermeabilizante',visitas:'Visitas',obras:'Instalaciones',garantias:'Garantías',cierres:'Cierres',solicitudes:'Solicitudes'};
const CAT_COLORS=['var(--or)','var(--info)','var(--vio)','var(--warn)','var(--ok)','var(--bad)'];

const toTime=v=>{if(!v)return null;const m=String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);const d=m?new Date(+m[1],+m[2]-1,+m[3]):new Date(v);const t=d.getTime();return Number.isNaN(t)?null:t};
const isoDate=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const advisorKey=v=>String(v||'').trim().toLowerCase();
const advisorLabel=(v,advisors)=>advisors.find(a=>a.lookup_key===advisorKey(v))?.display_name||(v?'Nombre no disponible':'Sin asignar');
const money=n=>'$'+Math.round(n||0).toLocaleString('es-MX');
const compact=n=>{const a=Math.abs(n||0),s=n<0?'−':'';return a>=1e6?`${s}$${(a/1e6).toFixed(a>=1e7?0:1)} M`:a>=1e3?`${s}$${Math.round(a/1e3)} k`:`${s}$${Math.round(a)}`};
const pct=(c,p)=>p>0?Math.round((c-p)/p*1000)/10:null;
const sum=a=>a.reduce((x,y)=>x+y,0);

export function analyze(d,periodId,nowMs){
  const p=PERIODS.find(x=>x.id===periodId)||PERIODS[1];
  const end=new Date(nowMs);end.setHours(0,0,0,0);end.setDate(end.getDate()+1);
  const start=new Date(end);start.setDate(start.getDate()-p.days);
  const prev=new Date(start);prev.setDate(prev.getDate()-p.days);
  const today=new Date(end);today.setDate(today.getDate()-1);
  const E=end.getTime(),S=start.getTime(),P=prev.getTime(),T=today.getTime(),step=(E-S)/p.buckets;
  const inCur=t=>t!==null&&t>=S&&t<E,inPrev=t=>t!==null&&t>=P&&t<S;
  const bucket=t=>Math.min(p.buckets-1,Math.floor((t-S)/step));
  const zeros=()=>Array(p.buckets).fill(0);
  const labels=Array.from({length:p.buckets},(_,i)=>{const dt=new Date(S+i*step);return p.days<=7?dt.toLocaleDateString('es-MX',{weekday:'short',day:'numeric'}):p.days<=90?dt.toLocaleDateString('es-MX',{day:'numeric',month:'short'}):dt.toLocaleDateString('es-MX',{month:'short'})});

  const ing=zeros(),egr=zeros(),cats={};let ingP=0,egrP=0;
  for(const m of d.mov||[]){const t=toTime(m.fecha),v=Number(m.monto)||0;
    if(inCur(t)){const b=bucket(t);if(m.tipo==='ingreso')ing[b]+=v;else{egr[b]+=v;const n=m.finanzas_categorias?.nombre||'Sin categoría';cats[n]=(cats[n]||0)+v}}
    else if(inPrev(t)){if(m.tipo==='ingreso')ingP+=v;else egrP+=v}}
  const ingT=sum(ing),egrT=sum(egr);
  const catRows=Object.entries(cats).sort((a,b)=>b[1]-a[1]);
  const top=catRows.slice(0,5),rest=sum(catRows.slice(5).map(x=>x[1]));
  const egrCats=[...top,...(rest>0?[['Otras',rest]]:[])].map(([n,v],i)=>[n,v,CAT_COLORS[i]]);

  const L=[],LP=[],leadsB=zeros(),salesB=zeros();
  for(const l of d.leads||[]){const t=toTime(l.fecha_contacto)??toTime(l.created_at);
    if(inCur(t)){L.push(l);leadsB[bucket(t)]++;if(l.status==='cerrado')salesB[bucket(t)]++}else if(inPrev(t))LP.push(l)}
  const sold=L.filter(l=>l.status==='cerrado'),soldP=LP.filter(l=>l.status==='cerrado');
  const conv=L.length?sold.length/L.length*100:0,convP=LP.length?soldP.length/LP.length*100:0;
  const has=(l,list)=>list.includes(l.status||'nuevo');
  const funnel=[['Leads',L.length],
    ['Contactados',L.filter(l=>!has(l,['nuevo','rescatar'])).length],
    ['Interesados',L.filter(l=>has(l,['interesado','en_proceso','confirmado','visita','visitado','cerrado'])).length],
    ['Con visita',L.filter(l=>has(l,['visita','visitado','cerrado'])).length],
    ['Cerrados',sold.length]];

  const bySeller={};
  for(const l of L){const k=advisorKey(l.asesor)||'_';const s=bySeller[k]||(bySeller[k]={key:k,asesor:l.asesor,leads:0,ventas:0,monto:0});s.leads++;if(l.status==='cerrado'){s.ventas++;s.monto+=Number(l.total)||0}}
  const sellers=Object.values(bySeller).sort((a,b)=>b.monto-a.monto||b.leads-a.leads).slice(0,6);

  const visB=zeros();let visT=0,visP=0;
  for(const v of d.visitas||[]){if(v.status!=='realizada')continue;const t=toTime(v.programacion);if(inCur(t)){visT++;visB[bucket(t)]++}else if(inPrev(t))visP++}
  const obrB=zeros();let obrT=0,obrP=0;const upcoming=[];
  for(const o of d.obras||[]){const t=toTime(o.programacion);if(inCur(t)){obrT++;obrB[bucket(t)]++}else if(inPrev(t))obrP++;
    if(t!==null&&t>=T&&t<T+7*DAY)upcoming.push({...o,t})}
  upcoming.sort((a,b)=>a.t-b.t);

  const open=d.open||[];
  const overdue=buildAlerts(open,[],nowMs).filter(x=>x.flags.includes('llamada_vencida')).length;
  const rescatar=open.filter(l=>l.status==='rescatar').length;
  const cierres=d.cierres||[];
  const cierresPend=cierres.filter(c=>c.status==='pendiente').length;
  const anticiposPend=cierres.filter(c=>c.status==='confirmado'&&c.anticipo_status==='pendiente').length;
  const stock={};
  for(const r of d.stock||[]){const s=stock[r.tipo]||(stock[r.tipo]={tipo:r.tipo,litros:0,minimo:0,sinMedir:0});s.litros+=Number(r.litros_estimados)||0;s.minimo+=Number(r.minimo_litros)||0;s.sinMedir+=Number(r.sin_medir)||0}
  const stockRows=Object.values(stock);
  const stockBajo=stockRows.filter(s=>s.minimo>0&&s.litros<=s.minimo*1.3);
  const mtto=(d.garantias||[]).filter(g=>{const t=toTime(g.proximo_mtto);return t!==null&&t>=T-365*DAY&&t<T+15*DAY}).length;
  const caja=(d.caja||[]).reduce((a,r)=>({saldo:a.saldo+(Number(r.saldo)||0),viaticos:a.viaticos+(Number(r.viaticos)||0),gastos:a.gastos+(Number(r.gastos)||0)}),{saldo:0,viaticos:0,gastos:0});

  return {p,labels,start,end:today,ing,egr,ingT,egrT,ingP,egrP,utilB:ing.map((v,i)=>v-egr[i]),egrCats,
    leadsN:L.length,leadsB,salesN:sold.length,salesP:soldP.length,salesB,conv,convP,funnel,sellers,
    visT,visP,visB,obrT,obrP,obrB,upcoming,today:T,
    overdue,rescatar,cierresPend,anticiposPend,solicitudes:d.solicitudes||0,stockRows,stockBajo,mtto,caja,
    imper:d.imper?.[0]||null};
}

function Spark({data,color='var(--or)',w=84,h=28}){
  if(!data||data.length<2)return null;
  const mx=Math.max(...data),mn=Math.min(...data),r=mx-mn||1;
  const pts=data.map((v,i)=>[i/(data.length-1)*w,h-3-(v-mn)/r*(h-6)]);
  return <svg className="xd-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><polyline fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" points={pts.map(q=>q.join(',')).join(' ')}/><circle cx={pts.at(-1)[0]} cy={pts.at(-1)[1]} r="3" fill={color}/></svg>;
}
const Delta=({v,suffix=' %',invert=false,label='vs. periodo anterior'})=>v===null?<span className="mut">sin periodo previo</span>:<span className={(v>=0)!==invert?'up':'dn'}>{v>0?'+':v<0?'−':''}{Math.abs(v)}{suffix} <span className="mut">{label}</span></span>;
const Kpi=({label,value,children,series,color})=><div className="card xd-kpi"><span className="mut xd-kl">{label}</span><b>{value}</b><span className="xd-kd">{children}</span><Spark data={series} color={color}/></div>;

function FlowChart({labels,ing,egr,util}){
  const W=640,H=250,pl=44,pb=26,pt=10,n=labels.length;
  const hi=Math.max(...ing,...egr,1)*1.1,lo=Math.min(0,...util);
  const Y=v=>pt+(H-pb-pt)*(1-(v-lo)/(hi-lo||1)),X=i=>pl+(i+.5)*(W-pl)/n,bw=Math.min(30,(W-pl)/n/2.6);
  const ticks=[0,1,2,3,4].map(g=>hi-(hi-lo)*g/4);
  const up=util.map((v,i)=>[X(i),Y(v)]);
  return <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Ingresos, egresos y utilidad por periodo">
    {ticks.map((t,g)=><g key={g}><line x1={pl} x2={W} y1={Y(t)} y2={Y(t)} stroke="var(--line)"/><text x="0" y={Y(t)+4}>{compact(t)}</text></g>)}
    {labels.map((l,i)=><g key={i}>
      <rect x={X(i)-bw-1} y={Math.min(Y(ing[i]),Y(0))} width={bw} height={Math.abs(Y(0)-Y(ing[i]))} rx="3" fill="var(--or)"><title>{`${l} · ingresos ${money(ing[i])}`}</title></rect>
      <rect x={X(i)+1} y={Math.min(Y(egr[i]),Y(0))} width={bw} height={Math.abs(Y(0)-Y(egr[i]))} rx="3" fill="var(--info)" opacity=".85"><title>{`${l} · egresos ${money(egr[i])}`}</title></rect>
      <text x={X(i)} y={H-8} textAnchor="middle">{l}</text></g>)}
    <polyline fill="none" stroke="var(--ok)" strokeWidth="2.5" points={up.map(q=>q.join(',')).join(' ')}/>
    {up.map((q,i)=><circle key={i} cx={q[0]} cy={q[1]} r="3.5" fill="var(--ok)"><title>{`${labels[i]} · utilidad ${money(util[i])}`}</title></circle>)}
  </svg>;
}
function Donut({items}){
  const total=sum(items.map(x=>x[1]));let a0=-Math.PI/2;
  const pt=(r,a)=>[60+r*Math.cos(a),60+r*Math.sin(a)];
  return <svg viewBox="0 0 120 120" width="150" role="img" aria-label="Egresos por categoría">
    {!total&&<circle cx="60" cy="60" r="42" fill="none" stroke="var(--line)" strokeWidth="20"/>}
    {total>0&&items.map(([n,v,c])=>{const a1=a0+Math.min(.9999,v/total)*2*Math.PI,big=v/total>.5?1:0;const[x0,y0]=pt(52,a0),[x1,y1]=pt(52,a1),[x2,y2]=pt(32,a1),[x3,y3]=pt(32,a0);const d=`M${x0} ${y0}A52 52 0 ${big} 1 ${x1} ${y1}L${x2} ${y2}A32 32 0 ${big} 0 ${x3} ${y3}Z`;a0=a1;return <path key={n} d={d} fill={c}><title>{`${n} · ${money(v)}`}</title></path>})}
    <text x="60" y="58" textAnchor="middle" style={{fontSize:14,fontWeight:800,fill:'var(--tx)'}}>{compact(total)}</text>
    <text x="60" y="72" textAnchor="middle">egresos</text>
  </svg>;
}

export function ExecutiveView({data,period,now,advisors=[],onGo}){
  const a=useMemo(()=>analyze(data,period,now),[data,period,now]);
  const fmt=d=>d.toLocaleDateString('es-MX',{day:'numeric',month:'short'});
  const util=a.ingT-a.egrT,utilP=a.ingP-a.egrP;
  const alerts=[
    a.overdue&&['bad',`${a.overdue} seguimiento${a.overdue>1?'s':''} vencido${a.overdue>1?'s':''}`,'Ventas','Leads'],
    a.rescatar&&['warn',`${a.rescatar} lead${a.rescatar>1?'s':''} por rescatar`,'Ventas','Leads'],
    a.cierresPend&&['warn',`${a.cierresPend} cierre${a.cierresPend>1?'s':''} sin confirmar agenda`,'Administrativo','Cierres'],
    a.anticiposPend&&['warn',`${a.anticiposPend} anticipo${a.anticiposPend>1?'s':''} pendiente${a.anticiposPend>1?'s':''}`,'Administrativo','Cierres'],
    a.solicitudes&&['info',`${a.solicitudes} solicitud${a.solicitudes>1?'es':''} de corrección financiera`,'Gerente / Root','Solicitudes'],
    ...a.stockBajo.map(s=>['bad',`${s.tipo==='isocianato'?'Isocianato':'Poliol'} cerca del mínimo (${Math.round(s.litros)} L)`,'Inventario','Inventario']),
    a.mtto&&['info',`${a.mtto} mantenimiento${a.mtto>1?'s':''} por vencer o vencido${a.mtto>1?'s':''}`,'Garantías','Mantenimiento'],
  ].filter(Boolean);
  const mx=a.funnel[0][1]||1;
  const stockScale=s=>Math.max(s.litros,s.minimo*3,1);
  const dayName=t=>t===a.today?'Hoy':new Date(t).toLocaleDateString('es-MX',{weekday:'short',day:'numeric'});
  return <>
    <div className="xd-kpis">
      <Kpi label="Ingresos" value={compact(a.ingT)} series={a.ing} color="var(--or)"><Delta v={pct(a.ingT,a.ingP)}/></Kpi>
      <Kpi label="Utilidad" value={compact(util)} series={a.utilB} color="var(--ok)"><Delta v={pct(util,utilP>0?utilP:0)}/></Kpi>
      <Kpi label="Ventas cerradas" value={a.salesN} series={a.salesB} color="var(--info)"><Delta v={pct(a.salesN,a.salesP)}/></Kpi>
      <Kpi label="Conversión" value={`${a.conv.toFixed(1)} %`} series={a.leadsB} color="var(--vio)"><Delta v={a.convP?Math.round((a.conv-a.convP)*10)/10:null} suffix=" pts"/></Kpi>
      <Kpi label="Visitas realizadas" value={a.visT} series={a.visB} color="var(--warn)"><Delta v={pct(a.visT,a.visP)}/></Kpi>
      <Kpi label="Instalaciones" value={a.obrT} series={a.obrB} color="var(--or)"><Delta v={pct(a.obrT,a.obrP)}/></Kpi>
      <Kpi label="Caja chica hoy" value={money(a.caja.saldo)}><span className="mut">viáticos {money(a.caja.viaticos)} · gastos {money(a.caja.gastos)}</span></Kpi>
    </div>
    <div className="xd-grid">
      <div className="card xd-s8"><h3>Ingresos, egresos y utilidad</h3><p className="sub">Barras naranja: ingresos. Barras azules: egresos. Línea verde: utilidad. {fmt(a.start)} al {fmt(a.end)}.</p><FlowChart labels={a.labels} ing={a.ing} egr={a.egr} util={a.utilB}/></div>
      <div className="card xd-s4"><h3>Requiere atención</h3><p className="sub">Estado de hoy, sin importar el periodo</p>
        {alerts.length?alerts.map(([tone,text,who,tab])=><button type="button" key={text} className="xd-alert" onClick={()=>onGo&&onGo(tab)}><span className="pill" style={{color:`var(--${tone})`}}>{who}</span><span>{text}</span></button>):<p className="mut">Todo al día: no hay pendientes.</p>}</div>
      <div className="card xd-s5"><h3>Embudo comercial</h3><p className="sub">Leads del periodo según su estado actual</p>
        {a.funnel.map(([n,v],j)=><div className="xd-row" key={n}><span className="xd-fn">{n}</span><div className="xd-bar"><i style={{width:v/mx*100+'%',background:`color-mix(in srgb,var(--or) ${100-j*15}%,var(--info))`}}/></div><b>{v}</b><span className="mut xd-fp">{j&&a.funnel[j-1][1]?Math.round(v/a.funnel[j-1][1]*100)+' %':''}</span></div>)}</div>
      <div className="card xd-s7"><h3>Rendimiento de vendedores</h3><p className="sub">Leads del periodo por vendedor</p>
        {a.sellers.length?<div className="tbl"><table><thead><tr><th>Vendedor</th><th>Leads</th><th>Ventas</th><th>Conversión</th><th>Monto</th></tr></thead><tbody>{a.sellers.map(s=><tr key={s.key}><td><b>{advisorLabel(s.asesor,advisors)}</b></td><td>{s.leads}</td><td>{s.ventas}</td><td className="xd-conv"><div className="xd-bar"><i style={{width:Math.min(100,s.ventas/s.leads*100)+'%'}}/></div><span className="mut">{Math.round(s.ventas/s.leads*100)} %</span></td><td>{compact(s.monto)}</td></tr>)}</tbody></table></div>:<p className="mut">No hay leads en este periodo.</p>}</div>
      <div className="card xd-s4"><h3>A dónde se va el dinero</h3><p className="sub">Egresos por categoría</p>
        <div className="xd-donut"><Donut items={a.egrCats}/><div>{a.egrCats.length?a.egrCats.map(([n,v,c])=><div className="xd-leg" key={n}><i style={{background:c}}/><span>{n}</span><b>{compact(v)}</b></div>):<p className="mut">Sin egresos en este periodo.</p>}</div></div></div>
      <div className="card xd-s4"><h3>Stock de químicos</h3><p className="sub">Última medición con regla en barril</p>
        {a.stockRows.map(s=>{const low=s.minimo>0&&s.litros<=s.minimo*1.3;return <div className="xd-stock" key={s.tipo}><div className="xd-sh"><span>{s.tipo==='isocianato'?'Isocianato':'Poliol'}</span><b>{Math.round(s.litros)} L</b></div><div className="xd-bar xd-rel"><i style={{width:s.litros/stockScale(s)*100+'%',background:low?'var(--bad)':'var(--ok)'}}/>{s.minimo>0&&<u style={{left:s.minimo/stockScale(s)*100+'%'}}/>}</div><span className="mut">{s.minimo>0?`Mínimo ${Math.round(s.minimo)} L · ${low?'conviene comprar':'nivel sano'}`:'Sin mínimo configurado'}{s.sinMedir?` · ${s.sinMedir} barril${s.sinMedir>1?'es':''} sin medir`:''}</span></div>})}
        {!a.stockRows.length&&<p className="mut">Aún no hay barriles registrados.</p>}
        {a.imper&&<div className="xd-stock"><div className="xd-sh"><span>Impermeabilizante</span><b>{Number(a.imper.inventario_final)||0} cubetas</b></div><span className="mut">Último movimiento registrado</span></div>}</div>
      <div className="card xd-s4"><h3>Instalaciones próximas</h3><p className="sub">Siguientes 7 días</p>
        {a.upcoming.length?a.upcoming.slice(0,8).map(o=><div className="xd-row xd-ins" key={o.id}><b>{dayName(o.t)}</b><span>{o.cliente||'Sin cliente'}{o.m2?` · ${Math.round(o.m2)} m²`:''}</span></div>):<p className="mut">No hay instalaciones programadas.</p>}</div>
    </div>
  </>;
}

export default function ExecutiveDashboard({advisors=[],now=Date.now(),onGo}){
  const[period,setPeriod]=useState(()=>{try{const v=sessionStorage.getItem('xd-period');return PERIODS.some(x=>x.id===v)?v:'mes'}catch{return 'mes'}});
  const[state,setState]=useState({loading:true,data:null,failed:[]});
  const choose=id=>{setPeriod(id);try{sessionStorage.setItem('xd-period',id)}catch{}};
  const load=useCallback(async()=>{
    setState(s=>({...s,loading:true}));
    const t0=new Date();t0.setHours(0,0,0,0);const back=new Date(t0);back.setDate(back.getDate()-740);
    const jobs=[
      ['leads',sb.from('leads').select('id,status,total,asesor,plaza,created_at,fecha_contacto').gte('created_at',back.toISOString()).order('created_at',{ascending:false}).range(0,4999)],
      ['open',sb.from('leads').select('id,status,next_call_at,last_contact_at,fecha_contacto,created_at').not('status','in','(cerrado,no)').range(0,4999)],
      ['mov',sb.from('movimientos_financieros_vigentes').select('fecha,tipo,monto,finanzas_categorias(nombre,naturaleza)').gte('fecha',isoDate(back)).range(0,9999)],
      ['caja',sb.from('caja_chica_saldo').select('*')],
      ['stock',sb.from('stock_resumen').select('*')],
      ['imper',sb.from('impermeabilizante_movimientos').select('inventario_final,fecha').order('fecha',{ascending:false}).order('numero',{ascending:false}).limit(1)],
      ['visitas',sb.from('visitas').select('id,status,programacion').gte('programacion',back.toISOString()).range(0,4999)],
      ['obras',sb.from('obras').select('id,cliente,m2,status,programacion').gte('programacion',isoDate(back)).range(0,4999)],
      ['garantias',sb.from('garantias').select('id,proximo_mtto').not('proximo_mtto','is',null).range(0,4999)],
      ['cierres',sb.from('cierres').select('id,status,anticipo_status').neq('status','cancelado').range(0,4999)],
      ['solicitudes',sb.from('finance_change_requests').select('id',{count:'exact',head:true}).eq('status','pending')],
    ];
    const results=await Promise.allSettled(jobs.map(j=>j[1]));
    const data={},failed=[];
    results.forEach((r,i)=>{const key=jobs[i][0];if(r.status==='fulfilled'&&!r.value.error)data[key]=key==='solicitudes'?(r.value.count||0):(r.value.data||[]);else failed.push(SOURCE_LABELS[key])});
    setState({loading:false,data,failed});
  },[]);
  useEffect(()=>{load();const t=setInterval(load,300000);return()=>clearInterval(t)},[load]);
  const p=PERIODS.find(x=>x.id===period)||PERIODS[1];
  return <section className="xd" aria-busy={state.loading}>
    <div className="xd-head">
      <div><h2>Dashboard ejecutivo</h2><p className="mut">Todo el negocio en un lugar. Cada número se compara con los {p.days} días anteriores.</p></div>
      <div className="xd-controls">
        <div className="xd-period" role="group" aria-label="Periodo">{PERIODS.map(x=><button type="button" key={x.id} aria-pressed={x.id===period} className={x.id===period?'on':''} onClick={()=>choose(x.id)}>{x.label}</button>)}</div>
        <button type="button" className="btn ghost" onClick={load} disabled={state.loading}>{state.loading?'Actualizando…':'Actualizar'}</button>
      </div>
    </div>
    {state.failed.length>0&&<p className="data-alert" role="alert">No se pudieron cargar: {state.failed.join(', ')}. Revisa que las migraciones de esas secciones estén aplicadas y que tu rol tenga acceso.</p>}
    {!state.data?<div className="panel-feedback">Cargando dashboard…</div>:<ExecutiveView data={state.data} period={period} now={now} advisors={advisors} onGo={onGo}/>}
  </section>;
}
