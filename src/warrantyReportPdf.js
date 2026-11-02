import logoUrl from './assets/thermo-house-logo.png';

const escapeHtml=value=>String(value||'').replace(/[&<>"']/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
}[char]));
const dateLabel=value=>value?new Date(`${String(value).slice(0,10)}T12:00:00`).toLocaleDateString('es-MX',{dateStyle:'long'}):'Sin fecha';
const fileLabel=value=>String(value||'reporte-garantia')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'')
  .replace(/[^a-zA-Z0-9_-]+/g,'-')
  .replace(/^-|-$/g,'')||'reporte-garantia';

async function dataUrl(url){
  const response=await fetch(url);
  if(!response.ok)throw new Error('No se pudo cargar una imagen de evidencia para el PDF.');
  const blob=await response.blob();
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(new Error('No se pudo preparar una imagen de evidencia para el PDF.'));
    reader.readAsDataURL(blob);
  });
}

export async function downloadWarrantyReportPdf(report,photoUrls=[]){
  const[logo,{default:html2pdf}]=await Promise.all([
    dataUrl(logoUrl),
    import('html2pdf.js'),
  ]);
  const photos=await Promise.all(photoUrls.map(async url=>url?dataUrl(url):null));
  const photoTiles=Array.from({length:4},(_,index)=>photos[index]
    ?`<div class="photo"><img src="${photos[index]}" alt="Evidencia ${index+1}"><span>Fotografía ${index+1}</span></div>`
    :`<div class="photo placeholder"><span>Sin fotografía</span><small>Fotografía ${index+1}</small></div>`).join('');
  const section=(title,body)=>`<section class="section"><h2>${title}</h2><div>${escapeHtml(body)||'Sin información registrada.'}</div></section>`;
  const doc=document.createElement('div');
  doc.className='warranty-pdf';
  doc.innerHTML=`
    <style>
      .warranty-pdf{font-family:Arial,sans-serif;color:#17314c;width:203.2mm;font-size:9pt}
      .page{position:relative;box-sizing:border-box;width:203.2mm;min-height:257mm;padding:9mm 0 8mm;background:#fff}
      .page:before{content:"";position:absolute;top:0;left:0;width:100%;height:3mm;background:linear-gradient(90deg,#075895 0 72%,#f58220 72%)}
      .head{display:flex;align-items:center;justify-content:space-between;margin:1mm 0 6mm}
      .logo{width:37mm;height:auto}
      .title{text-align:right}.title h1{font-size:17pt;line-height:1.12;color:#075895;margin:0 0 2mm}
      .title p{margin:0;color:#6b7b8b;font-size:8pt}
      table{border-collapse:collapse;width:100%;margin-bottom:5mm;font-size:8pt}
      td{border:1px solid #d6dee6;padding:2.2mm;vertical-align:top}
      td.label{font-weight:bold;color:#075895;background:#f1f5f9;width:18%}
      td.value{width:32%;min-height:6mm}
      .section{margin:0 0 4mm;page-break-inside:avoid}
      .section h2{margin:0 0 2mm;padding:2mm 3mm;color:white;background:#075895;border-left:1.5mm solid #f58220;font-size:9pt}
      .section div{white-space:pre-line;line-height:1.35;padding:0 2mm}
      .photo-grid{display:grid;grid-template-columns:1fr 1fr;gap:4mm;margin-bottom:5mm}
      .photo{height:61mm;border:1px solid #d6dee6;background:#f1f5f9;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden}
      .photo img{width:100%;height:54mm;object-fit:contain}
      .photo span,.photo small{color:#718096;font-size:8pt;margin:1mm}
      .signature-row{display:flex;justify-content:space-between;gap:20mm;margin-top:12mm;text-align:center;font-size:8pt}
      .signature{width:50%;border-top:1px solid #52677b;padding-top:2mm}
      .footer{position:absolute;bottom:1mm;left:0;right:0;border-top:1px solid #d6dee6;padding-top:2mm;color:#718096;font-size:7pt;text-align:center}
      .page-two{page-break-before:always}
    </style>
    <article class="page page-one">
      <header class="head"><img class="logo" src="${logo}" alt="ThermoHouse"><div class="title"><h1>REPORTE TÉCNICO<br>DE GARANTÍA</h1><p>Inspección en sitio · Sistema de espuma de poliuretano</p></div></header>
      <table><tbody>
        <tr><td class="label">Cliente</td><td class="value">${escapeHtml(report.cliente)}</td><td class="label">Folio / Reporte</td><td class="value">${escapeHtml(report.folio)}</td></tr>
        <tr><td class="label">Domicilio</td><td class="value">${escapeHtml(report.domicilio)}</td><td class="label">Fecha de visita</td><td class="value">${dateLabel(report.fecha_visita)}</td></tr>
        <tr><td class="label">Sistema instalado</td><td class="value">${escapeHtml(report.sistema_instalado)}</td><td class="label">Fecha de instalación</td><td class="value">${dateLabel(report.fecha_instalacion)}</td></tr>
        <tr><td class="label">Técnico responsable</td><td class="value">${escapeHtml(report.tecnico_responsable)}</td><td class="label">Tipo de visita</td><td class="value">${escapeHtml(report.tipo_visita)}</td></tr>
      </tbody></table>
      ${section('1. Motivo de la visita',report.motivo_visita)}
      ${section('2. Hallazgos de la inspección',report.hallazgos)}
      ${section('3. Análisis técnico',report.analisis_tecnico)}
      <div class="footer">ThermoHouse · Reporte técnico de garantía · ${escapeHtml(report.folio)}</div>
    </article>
    <article class="page page-two">
      <div class="section"><h2>4. Evidencia fotográfica</h2></div>
      <div class="photo-grid">${photoTiles}</div>
      ${section('5. Dictamen',report.dictamen)}
      ${section('6. Recomendaciones',report.recomendaciones)}
      <div class="signature-row"><div class="signature">Técnico responsable · ThermoHouse</div><div class="signature">Recibí · Cliente</div></div>
      <div class="footer">ThermoHouse · Reporte técnico de garantía · ${escapeHtml(report.folio)}</div>
    </article>`;

  const wrapper=document.createElement('div');
  wrapper.style.cssText='position:fixed;left:-10000px;top:0;width:203.2mm;background:#fff;';
  wrapper.append(doc);
  document.body.append(wrapper);
  try{
    await html2pdf().set({
      margin:[10,3.8,10,3.8],
      filename:`reporte-garantia-${fileLabel(report.folio)}.pdf`,
      image:{type:'jpeg',quality:0.96},
      html2canvas:{scale:2,useCORS:true,backgroundColor:'#ffffff'},
      jsPDF:{unit:'mm',format:'letter',orientation:'portrait'},
      pagebreak:{mode:['css','legacy'],before:'.page-two'},
    }).from(doc).save();
  }finally{
    wrapper.remove();
  }
}
