import { expect, it } from 'vitest';
import { createBasemapSource } from '../../src/map/basemaps';

it('uses the correct x/y tile order for the topographic and imagery providers', () => {
  const topo = createBasemapSource('topo')!;
  const satellite = createBasemapSource('satellite')!;
  const coordinate = [12,2469,1554];
  expect(topo.getTileUrlFunction()(coordinate, 1, topo.getProjection()!)).toBe('https://tile.openmaps.fr/opentopomap/12/2469/1554.png');
  expect(satellite.getTileUrlFunction()(coordinate, 1, satellite.getProjection()!)).toBe('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/12/1554/2469');
  expect(topo.getAttributionsCollapsible()).toBe(false);
  expect(satellite.getAttributionsCollapsible()).toBe(false);
  expect(topo.getTileGrid()!.getMaxZoom()).toBe(18);
  expect(createBasemapSource('none')).toBeNull();
  topo.dispose(); satellite.dispose();
});
