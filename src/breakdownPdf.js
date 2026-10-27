import logoUrl from './assets/thermo-house-logo.png';

const LOGO_RATIO = 144 / 300; // alto / ancho del PNG del logo
let logoCache;

async function logoDataUrl() {
  if (logoCache) return logoCache;
  const blob = await (await fetch(logoUrl)).blob();
  logoCache = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('No se pudo cargar el logo para el PDF.'));
    reader.readAsDataURL(blob);
  });
  return logoCache;
}

const safeName = value =>
  String(value || 'servicio')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '') || 'servicio';

/**
 * Genera el PDF "Desglose de servicios profesionales" a partir del documento
 * renderizado (.sb-doc). El logo y el pie de página se dibujan en cada hoja.
 */
export async function downloadBreakdownPdf(source, { name, folio }) {
  if (!(source instanceof HTMLElement)) {
    throw new Error('No se encontró el documento para generar el PDF.');
  }
  const [logo, { default: html2pdf }] = await Promise.all([logoDataUrl(), import('html2pdf.js')]);

  const MARGIN = { top: 30, right: 12, bottom: 16, left: 12 }; // mm
  const wrapper = document.createElement('div');
  const doc = source.cloneNode(true);
  wrapper.style.cssText = 'position:fixed;left:-10000px;top:0;width:186mm;background:#fff;';
  doc.classList.add('sb-pdf');
  doc.style.cssText += 'width:186mm;max-width:none;margin:0;padding:0;box-shadow:none;border:0;';
  wrapper.append(doc);
  document.body.append(wrapper);

  try {
    await html2pdf()
      .set({
        margin: [MARGIN.top, MARGIN.right, MARGIN.bottom, MARGIN.left],
        filename: `desglose-servicios-${safeName(folio || name)}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'], avoid: ['.sb-avoid', 'tr'] },
      })
      .from(doc)
      .toPdf()
      .get('pdf')
      .then(pdf => {
        const pages = pdf.internal.getNumberOfPages();
        const width = pdf.internal.pageSize.getWidth();
        const height = pdf.internal.pageSize.getHeight();
        const logoW = 38;
        for (let page = 1; page <= pages; page += 1) {
          pdf.setPage(page);
          // Encabezado con logo en todas las hojas
          pdf.addImage(logo, 'PNG', MARGIN.left, 6, logoW, logoW * LOGO_RATIO);
          pdf.setTextColor(17, 17, 17);
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(10);
          pdf.text('Desglose de servicios profesionales', width - MARGIN.right, 13, { align: 'right' });
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(8);
          pdf.setTextColor(90, 90, 90);
          pdf.text('ThermoHouse Morelos · Impermeabilización y aislamiento térmico', width - MARGIN.right, 18, { align: 'right' });
          pdf.setDrawColor(245, 130, 32);
          pdf.setLineWidth(0.6);
          pdf.line(MARGIN.left, 26, width - MARGIN.right, 26);
          // Pie de página
          pdf.setDrawColor(210, 210, 210);
          pdf.setLineWidth(0.2);
          pdf.line(MARGIN.left, height - 12, width - MARGIN.right, height - 12);
          pdf.setFontSize(8);
          pdf.text(folio ? `Presupuesto ${folio}` : 'ThermoHouse Morelos', MARGIN.left, height - 7.5);
          pdf.text(`Página ${page} de ${pages}`, width - MARGIN.right, height - 7.5, { align: 'right' });
        }
      })
      .save();
  } finally {
    wrapper.remove();
  }
}
