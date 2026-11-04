export async function downloadQuotePdf(lead) {
  const source = document.querySelector('.quote-document');
  if (!(source instanceof HTMLElement)) {
    throw new Error('No se encontró la cotización para generar el PDF.');
  }

  const button = document.querySelector('.quote-preview-actions .btn');
  const originalLabel = button?.textContent;
  const wrapper = document.createElement('div');
  const quote = source.cloneNode(true);
  const fileName = String(lead.folio || lead.nombre || 'cotizacion')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '') || 'cotizacion';

  wrapper.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm;background:#fff;';
  quote.style.cssText += 'position:relative;left:auto;top:auto;width:190mm;margin:0 auto;background:#fff;';
  const compactStyles = document.createElement('style');
  compactStyles.textContent = `
    .quote-document{box-sizing:border-box;font-size:9px!important;line-height:1.15!important}
    .quote-page{box-sizing:border-box;width:100%!important;height:auto!important;min-height:0!important;max-height:none!important;padding:3mm!important;overflow:visible!important;break-before:auto!important;page-break-before:auto!important;break-after:auto!important;page-break-after:auto!important}
    .quote-page-one{display:grid!important;grid-template-columns:1fr 1fr!important;align-content:start!important;gap:2mm 4mm!important}
    .quote-page-one>.quote-header,.quote-page-one>.quote-customer-grid,.quote-page-one>.quote-main-grid,.quote-page-one>.quote-presentations-print,.quote-page-one>.quote-summary-grid,.quote-page-one>.quote-checklist-title,.quote-page-one>.quote-checklists,.quote-page-one>.quote-observations{grid-column:1/-1}
    .quote-summary-grid{display:grid!important;grid-template-columns:1.1fr .9fr!important;align-items:start!important;gap:4mm!important}
    .quote-page-two{position:static!important;display:grid!important;grid-template-columns:1fr 1fr!important;align-content:start!important;gap:2mm 4mm!important}
    .quote-page-two>.quote-billing-print,.quote-page-two>.quote-terms-grid,.quote-page-two>.quote-advance-note,.quote-page-two>.quote-signatures,.quote-page-two>.quote-footer-brand{grid-column:1/-1}
    .quote-terms-grid{display:grid!important;grid-template-columns:1fr 1fr!important;align-items:start!important;gap:4mm!important}
    .quote-header{grid-template-columns:1fr 62mm!important;gap:4mm!important;margin-bottom:0!important;padding-bottom:2mm!important;border-bottom:1px solid #f36b14!important}
    .quote-brand{gap:3mm!important}
    .quote-brand-mark{width:17mm!important;height:17mm!important;font-size:15px!important}
    .quote-brand strong{font-size:16px!important}
    .quote-contact-table{font-size:8px!important}
    .quote-contact-table th,.quote-contact-table td{padding:.7mm 1mm!important}
    .quote-check-row{justify-content:flex-start!important;min-height:3.8mm!important;gap:1.5mm!important}
    .quote-check-box{width:3mm!important;height:3mm!important;flex:0 0 3mm!important;font-size:7px!important}
    .quote-customer-grid{grid-template-columns:1.2fr 1fr!important;gap:1mm 4mm!important;padding:1mm 0 2mm!important;border-bottom:1px solid #d5dbe1!important}
    .quote-customer-grid>div{grid-template-columns:29mm minmax(0,1fr)!important;gap:1mm!important}
    .quote-main-grid{grid-template-columns:1fr 1.1fr!important;gap:4mm!important;margin:0!important}
    .quote-price-inputs{grid-template-columns:32mm minmax(0,1fr)!important}
    .quote-price-inputs b,.quote-price-inputs span{padding:.8mm!important}
    .quote-selection-area{gap:2mm!important}
    .quote-selection-area h3{font-size:8px!important;padding:.8mm!important}
    .quote-applications>.quote-check-row,.quote-tones>.quote-check-row{padding:.5mm 1mm!important}
    .quote-totals{grid-template-columns:1fr 30mm!important;width:100%!important;margin:0!important;font-size:8px!important}
    .quote-totals b,.quote-totals span{padding:.8mm 1mm!important}
    .quote-specifications{margin:0!important;padding:0!important}
    .quote-specifications h3,.quote-billing-print h3,.quote-benefits h3{margin:0 0 1mm!important;font-size:9px!important}
    .quote-specifications p{line-height:1.15!important}
    .quote-checklist-title{text-align:left!important;margin:0!important;font-size:9px!important}
    .quote-checklists{gap:3mm!important}
    .quote-checklists h4{margin:0 0 .7mm!important;padding-bottom:.5mm!important;font-size:7px!important}
    .quote-checklists>div .quote-check-row{min-height:3.6mm!important;padding:0!important}
    .quote-observations{grid-template-columns:24mm minmax(0,1fr)!important;gap:1.5mm!important;min-height:8mm!important;margin-top:0!important}
    .quote-page-two>.quote-billing-print>div{gap:1mm 3mm!important}
    .quote-page-two .quote-billing-print span{min-height:4mm!important}
    .quote-page-two .quote-benefits p,.quote-page-two .quote-benefits ul{margin:1mm 0!important}
    .quote-page-two .quote-benefits li{margin:.6mm 0!important}
    .quote-page-two .quote-receipt{align-content:start!important;gap:1mm!important}
    .quote-page-two .quote-advance-note{margin:0!important;padding:1.5mm!important;font-size:8px!important}
    .quote-page-two .quote-receipt>div{grid-template-columns:25mm minmax(0,1fr)!important;gap:1mm!important}
    .quote-page-two .quote-receipt span{min-height:4mm!important}
    .quote-page-two .quote-receipt p{margin:1mm 0!important}
    .quote-page-two .quote-signatures{gap:10mm!important;margin-top:0!important}
    .quote-page-two .quote-signatures span{height:7mm!important}
    .quote-page-two .quote-footer-brand{margin-top:0!important;padding:1mm!important;font-size:10px!important}
    .quote-presentations-print th,.quote-presentations-print td{padding:1mm!important;font-size:7px!important}
  `;
  quote.prepend(compactStyles);
  const quotePageOne = quote.querySelector('.quote-page-one');
  const totals = quote.querySelector('.quote-totals');
  const specifications = quote.querySelector('.quote-specifications');
  if (quotePageOne && totals && specifications) {
    const summary = document.createElement('div');
    summary.className = 'quote-summary-grid';
    quotePageOne.insertBefore(summary, totals);
    summary.append(totals, specifications);
  }
  const quotePageTwo = quote.querySelector('.quote-page-two');
  const benefits = quote.querySelector('.quote-benefits');
  const receipt = quote.querySelector('.quote-receipt');
  if (quotePageTwo && benefits && receipt) {
    const terms = document.createElement('div');
    terms.className = 'quote-terms-grid';
    quotePageTwo.insertBefore(terms, benefits);
    terms.append(benefits, receipt);
  }
  document.body.append(wrapper);
  wrapper.append(quote);

  if (button) {
    button.setAttribute('disabled', '');
    button.textContent = 'Generando PDF…';
  }

  try {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import('html2canvas'),
      import('jspdf'),
    ]);
    const canvas = await html2canvas(quote, {
      backgroundColor: '#ffffff',
      height: quote.scrollHeight,
      scale: 2,
      useCORS: true,
      width: quote.scrollWidth,
      windowHeight: quote.scrollHeight,
      windowWidth: quote.scrollWidth,
    });
    if (!canvas.width || !canvas.height) {
      throw new Error('No se pudo capturar el contenido de la cotización.');
    }

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 7;
    const fitScale = Math.min(
      (pageWidth - margin * 2) / canvas.width,
      (pageHeight - margin * 2) / canvas.height,
    );
    const imageWidth = canvas.width * fitScale;
    const imageHeight = canvas.height * fitScale;
    const image = canvas.toDataURL('image/jpeg', 0.98);
    pdf.addImage(
      image,
      'JPEG',
      (pageWidth - imageWidth) / 2,
      (pageHeight - imageHeight) / 2,
      imageWidth,
      imageHeight,
      undefined,
      'FAST',
    );
    pdf.save(`cotizacion-${fileName}.pdf`);
  } finally {
    wrapper.remove();
    if (button) {
      button.removeAttribute('disabled');
      button.textContent = originalLabel;
    }
  }
}
