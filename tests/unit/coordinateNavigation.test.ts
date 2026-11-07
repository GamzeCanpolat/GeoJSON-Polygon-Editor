import { describe, expect, it } from 'vitest';
import { parseCoordinateInputs } from '../../src/domain/coordinateNavigation';

describe('parseCoordinateInputs', () => {
  it.each([
    ['41.0082', '28.9784', 41.0082, 28.9784],
    [' -33,86 ', '+151,21', -33.86, 151.21],
    [',5', '-.25', 0.5, -0.25],
    ['90', '-180', 90, -180],
    ['-90', '180', -90, 180],
    ['0', '0', 0, 0],
  ])('parses latitude %s and longitude %s in input order', (lat, lon, latitude, longitude) => {
    expect(parseCoordinateInputs(lat, lon)).toEqual({ ok: true, coordinate: { latitude, longitude } });
  });

  it.each([
    ['', '28', 'latitude', 'Enlem girin.'],
    ['41', '  ', 'longitude', 'Boylam girin.'],
    ['90,0001', '28', 'latitude', 'Enlem -90 ile 90 arasında olmalı.'],
    ['41', '-180.01', 'longitude', 'Boylam -180 ile 180 arasında olmalı.'],
  ])('reports the field and error for %j and %j', (latitude, longitude, field, error) => {
    expect(parseCoordinateInputs(latitude, longitude)).toEqual({ ok: false, field, error });
  });

  it.each(['NaN', 'Infinity', '1e2', '0x10', '41,008.2', '28 978', '.', '-'])(
    'rejects malformed or non-finite input %s',
    (input) => expect(parseCoordinateInputs(input, '28')).toMatchObject({ ok: false, field: 'latitude' }),
  );
});
