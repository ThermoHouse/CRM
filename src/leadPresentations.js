const PRESENTATION_DETAILS = {
  'TH FIX': {name: 'TH FIX', detail: 'impermeabilizante acrílico elastomérico, sin espuma de poliuretano'},
  'TH LIGHT': {name: 'TH LITE', detail: 'espuma de poliuretano de 1/2 cm (5 mm) con recubrimiento acrílico'},
  'TH FORTE': {name: 'TH FORTE', detail: 'espuma de poliuretano de 1 cm (10 mm) con recubrimiento acrílico'},
  'TH 3/4': {name: 'TH 3/4', detail: 'espuma de poliuretano de 3/4 de pulgada (19 mm) con recubrimiento acrílico'},
  'TH INGLES': {name: 'TH Inglés', detail: 'espuma de poliuretano de 1 pulgada (25 mm) con recubrimiento acrílico'},
};

export function presentationLabel(system) {
  return PRESENTATION_DETAILS[system]?.name || system || '';
}

export function buildLeadSpecifications(lines, defaultTone, applications) {
  const description = lines
    .filter(line => line.sistema)
    .map(line => {
      const details = PRESENTATION_DETAILS[line.sistema]?.detail || 'espuma de poliuretano con recubrimiento acrílico';
      const area = Number(line.area_m2) > 0 ? ` en ${Number(line.area_m2).toLocaleString('es-MX')} m²` : '';
      const tone = line.sistema === 'TH FIX' ? (line.tono_acrilico || defaultTone) : (line.tono_acrilico || defaultTone);
      const color = tone && tone !== 'No aplica' ? `, tono ${tone.toLowerCase()}` : '';
      return `${presentationLabel(line.sistema)}: ${details}${area}${color}.`;
    });
  const surfaces = applications?.length ? `Superficie: ${applications.join(', ').toLowerCase()}.` : '';
  return [
    'Suministro y aplicación de los sistemas seleccionados:',
    ...(description.length ? description : ['Presentación y espesor por definir.']),
    surfaces,
    'Incluye mano de obra y material.',
  ].filter(Boolean).join('\n');
}
