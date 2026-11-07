export interface GeographicCoordinate {
  latitude: number;
  longitude: number;
}

// The base map uses the EPSG:3857 tile world.
export const MAX_MERCATOR_LATITUDE = 85.0511287798066;

type CoordinateField = keyof GeographicCoordinate;
type CoordinateResult =
  | { ok: true; coordinate: GeographicCoordinate }
  | { ok: false; field: CoordinateField; error: string };

const decimal = /^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/;

export function parseCoordinateInputs(latitude: string, longitude: string): CoordinateResult {
  const coordinate = { latitude: 0, longitude: 0 };
  const fields = [
    { field: 'latitude', text: latitude, label: 'Enlem', limit: 90, example: '41,0082' },
    { field: 'longitude', text: longitude, label: 'Boylam', limit: 180, example: '28,9784' },
  ] as const;

  for (const { field, text, label, limit, example } of fields) {
    const input = text.trim();
    if (!input) return { ok: false, field, error: `${label} girin.` };
    if (!decimal.test(input)) {
      return { ok: false, field, error: `${label} için geçerli bir sayı girin (örnek ${example}).` };
    }
    const value = Number(input.replace(',', '.'));
    if (!Number.isFinite(value) || Math.abs(value) > limit) {
      return { ok: false, field, error: `${label} -${limit} ile ${limit} arasında olmalı.` };
    }
    coordinate[field] = value;
  }

  return { ok: true, coordinate };
}
