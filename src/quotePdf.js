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
  quote.style.cssText += 'width:210mm;margin:0;background:#fff;';
  quote.querySelectorAll('.quote-page').forEach(page => {
    page.style.cssText += 'width:210mm;height:auto;min-height:0;padding:9mm 10mm;break-before:auto!important;page-break-before:auto!important;break-after:auto!important;page-break-after:auto!important;';
  });
  document.body.append(wrapper);
  wrapper.append(quote);

  if (button) {
    button.setAttribute('disabled', '');
    button.textContent = 'Generando PDF…';
  }

  try {
    const { default: html2pdf } = await import('html2pdf.js');
    await html2pdf()
      .set({
        margin: 0,
        filename: `cotizacion-${fileName}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'], before: '.quote-page-two' },
      })
      .from(quote)
      .save();
  } finally {
    wrapper.remove();
    if (button) {
      button.removeAttribute('disabled');
      button.textContent = originalLabel;
    }
  }
}
