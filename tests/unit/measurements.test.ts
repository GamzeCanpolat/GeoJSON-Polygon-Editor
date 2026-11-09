import { expect, it } from 'vitest';
import { measureGeometry } from '../../src/domain/measurements';

const square = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
const hole = [[.25, .25], [.25, .75], [.75, .75], [.75, .25], [.25, .25]];
const areaOfSquare = 12_363_718_145;
const perimeterOfSquare = 444_763.385;

it('measures a known equatorial square without changing the geometry', () => {
  const input = { type: 'Polygon' as const, coordinates: [square] };
  const before = JSON.stringify(input);
  const result = measureGeometry(input);
  if (result?.kind !== 'polygon') throw new Error('Expected polygon measurement');
  expect(result.area).toBeCloseTo(areaOfSquare, -1);
  expect(result.perimeter).toBeCloseTo(perimeterOfSquare, 1);
  expect(JSON.stringify(input)).toBe(before);
});

it('subtracts holes, includes their boundaries and sums multipolygon parts', () => {
  const result = measureGeometry({ type: 'MultiPolygon', coordinates: [[square, hole], [square.map(([x, y]) => [x + 10, y])]] });
  if (result?.kind !== 'polygon') throw new Error('Expected polygon measurement');
  expect(result.area / areaOfSquare).toBeCloseTo(1.75, 5);
  expect(result.perimeter).toBeCloseTo(perimeterOfSquare * 2.5, -1);
});

it('takes the short path for polygons crossing the antimeridian', () => {
  const ring = square.map(([x, y]) => [x ? -180 : 179, y]);
  expect(measureGeometry({ type: 'Polygon', coordinates: [ring] }))
    .toEqual(measureGeometry({ type: 'Polygon', coordinates: [square] }));
});

it('measures lines and multilines without connecting parts or including Z', () => {
  const one = [[0, 0, 10], [1, 0, 20]];
  const line = measureGeometry({ type: 'LineString', coordinates: one });
  const multi = measureGeometry({ type: 'MultiLineString', coordinates: [one, [[80, 0], [81, 0]]] });
  if (line?.kind !== 'line' || multi?.kind !== 'line') throw new Error('Expected line measurements');
  expect(line.length).toBeCloseTo(111_195.08, 2);
  expect(multi.length).toBeCloseTo(222_390.16, 2);
});

it('handles empty polygons and omits metrics for missing or point geometry', () => {
  expect(measureGeometry({ type: 'Polygon', coordinates: [] })).toEqual({ kind: 'polygon', area: 0, perimeter: 0 });
  expect(measureGeometry(null)).toBeNull();
  expect(measureGeometry({ type: 'Point', coordinates: [1, 2] })).toBeNull();
});
