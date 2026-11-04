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

  wrapper.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm;height:297mm;overflow:hidden;background:#fff;';
  quote.style.cssText += 'width:210mm;margin:0;background:#fff;transform-origin:top left;';
  const compactStyles = document.createElement('style');
  compactStyles.textContent = `
    .quote-document{box-sizing:border-box;font-size:8px!important;line-height:1.08!important}
    .quote-page{box-sizing:border-box;width:100%!important;height:auto!important;min-height:0!important;max-height:none!important;padding:3mm!important;overflow:visible!important;break-before:auto!important;page-break-before:auto!important;break-after:auto!important;page-break-after:auto!important}
    .quote-page-one{display:block!important}
    .quote-page-two{position:static!important;display:grid!important;grid-template-columns:1fr 1fr!important;gap:2mm!important}
    .quote-page-two>.quote-billing-print,.quote-page-two>.quote-advance-note,.quote-page-two>.quote-signatures,.quote-page-two>.quote-footer-brand{grid-column:1/-1}
    .quote-header{grid-template-columns:1fr 70mm!important;gap:3mm!important;margin-bottom:2mm!important}
    .quote-brand-mark{width:14mm!important;height:14mm!important;font-size:13px!important}
    .quote-brand strong{font-size:14px!important}
    .quote-contact-table{font-size:7px!important}
    .quote-contact-table th,.quote-contact-table td{padding:.5mm 1mm!important}
    .quote-check-row{min-height:3.5mm!important;gap:1mm!important}
    .quote-check-box{width:3mm!important;height:3mm!important;flex-basis:3mm!important;font-size:7px!important}
    .quote-customer-grid{gap:1mm 3mm!important;padding:1mm 0 2mm!important}
    .quote-customer-grid>div{grid-template-columns:27mm minmax(0,1fr)!important;gap:1mm!important}
    .quote-main-grid{gap:3mm!important;margin:2mm 0!important}
    .quote-price-inputs{grid-template-columns:29mm 1fr!important}
    .quote-price-inputs b,.quote-price-inputs span{padding:.7mm!important}
    .quote-selection-area{gap:2mm!important}
    .quote-selection-area h3{font-size:7px!important;padding:.7mm!important}
    .quote-applications>.quote-check-row,.quote-tones>.quote-check-row{padding:.4mm 1mm!important}
    .quote-totals{grid-template-columns:1fr 30mm!important;margin:2mm 0 2mm 38%!important;font-size:8px!important}
    .quote-totals b,.quote-totals span{padding:.7mm 1mm!important}
    .quote-specifications{margin:2mm 0!important}
    .quote-specifications h3,.quote-billing-print h3,.quote-benefits h3{margin:0 0 1mm!important;font-size:8px!important}
    .quote-specifications p{line-height:1.12!important}
    .quote-checklist-title{text-align:center;margin:2mm 0 1mm!important;font-size:8px!important}
    .quote-checklists{gap:2mm!important}
    .quote-checklists h4{margin:0 0 .5mm!important;font-size:7px!important}
    .quote-checklists>div .quote-check-row{min-height:3.5mm!important;padding:0!important}
    .quote-observations{grid-template-columns:22mm 1fr!important;gap:1mm!important;min-height:10mm!important;margin-top:2mm!important}
    .quote-page-two>.quote-billing-print>div{gap:1mm 2mm!important}
    .quote-page-two .quote-billing-print span{min-height:4mm!important}
    .quote-page-two .quote-benefits p,.quote-page-two .quote-benefits ul{margin:1mm 0!important}
    .quote-page-two .quote-benefits li{margin:.5mm 0!important}
    .quote-page-two .quote-advance-note{margin:0!important;padding:1.5mm!important;font-size:7px!important}
    .quote-page-two .quote-receipt{gap:1mm!important}
    .quote-page-two .quote-receipt>div{grid-template-columns:25mm minmax(0,1fr)!important;gap:1mm!important}
    .quote-page-two .quote-receipt span{min-height:4mm!important}
    .quote-page-two .quote-receipt p{margin:1mm 0!important}
    .quote-page-two .quote-signatures{gap:8mm!important;margin-top:0!important}
    .quote-page-two .quote-signatures span{height:6mm!important}
    .quote-page-two .quote-footer-brand{margin-top:0!important;padding:1mm!important;font-size:9px!important}
    .quote-presentations-print th,.quote-presentations-print td{padding:1mm!important;font-size:7px!important}
  `;
  quote.prepend(compactStyles);
  quote.querySelectorAll('.quote-page').forEach(page => {
    page.style.cssText += 'width:100%;height:auto;min-height:0;max-height:none;padding:3mm;break-before:auto!important;page-break-before:auto!important;break-after:auto!important;page-break-after:auto!important;';
  });
  document.body.append(wrapper);
  wrapper.append(quote);

  if (button) {
    button.setAttribute('disabled', '');
    button.textContent = 'Generando PDF…';
  }

  try {
    const targetHeight = 285;
    let scale = 1;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const heightMm = quote.offsetHeight * 25.4 / 96;
      scale = Math.min(1, targetHeight / heightMm);
      quote.style.width = `${210 / scale}mm`;
    }
    quote.style.transform = `scale(${scale})`;

    const { default: html2pdf } = await import('html2pdf.js');
    await html2pdf()
      .set({
        margin: 0,
        filename: `cotizacion-${fileName}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all'] },
      })
      .from(wrapper)
      .save();
  } finally {
    wrapper.remove();
    if (button) {
      button.removeAttribute('disabled');
      button.textContent = originalLabel;
    }
  }
}
