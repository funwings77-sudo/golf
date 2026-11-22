// 🗺️ 구글 지도 층(js/core/gleaflet.js)의 좌표 계산: Leaflet·구글 래스터 지도와 같은 웹 메르카토르
import test from 'node:test';
import assert from 'node:assert/strict';
import { worldPx, worldLL, LatLng, LatLngBounds, toLL } from '../js/core/gleaflet.js';

test('세계 픽셀 ↔ 위경도: 왕복 오차 없음 · 확대 1단계마다 2배', () => {
  const p = new LatLng(37.3856201, 127.1792936);
  for (const z of [3, 12, 17, 21]) { const q = worldLL(worldPx(p, z), z); assert.ok(Math.abs(q.lat - p.lat) < 1e-9 && Math.abs(q.lng - p.lng) < 1e-9); }
  const a = worldPx(p, 17), b = worldPx(p, 18);
  assert.ok(Math.abs(b.x - 2 * a.x) < 1e-6 && Math.abs(b.y - 2 * a.y) < 1e-6);
  // 적도·경도 0 = 세계 가운데
  const c = worldPx(new LatLng(0, 0), 0); assert.ok(Math.abs(c.x - 128) < 1e-9 && Math.abs(c.y - 128) < 1e-9);
  // 확대 17에서 1픽셀 ≈ 1.19m × cos(위도)
  const e = worldPx(new LatLng(37.5, 127.0001), 17), w = worldPx(new LatLng(37.5, 127), 17), m = new LatLng(37.5, 127).distanceTo([37.5, 127.0001]);
  assert.ok(Math.abs(m / (e.x - w.x) - 1.1943 * Math.cos(37.5 * Math.PI / 180)) < 0.01);
});

test('위경도 형식: [lat, lng] · {lat, lng} · {lat, lon} 모두 받음 · 범위 계산', () => {
  assert.deepEqual([toLL([1, 2]).lat, toLL([1, 2]).lng], [1, 2]);
  assert.equal(toLL({ lat: 1, lon: 3 }).lng, 3);
  assert.equal(toLL({ lat: 1, lng: 4 }).lng, 4);
  const b = new LatLngBounds([[37.38, 127.17], [37.39, 127.19], { lat: 37.385, lon: 127.2 }]);
  assert.equal(b.getNorth(), 37.39); assert.equal(b.getEast(), 127.2); assert.equal(b.getSouth(), 37.38);
  assert.ok(b.contains([37.385, 127.18])); assert.ok(!b.contains([37.4, 127.18]));
  const c = b.getCenter(); assert.ok(Math.abs(c.lat - 37.385) < 1e-12 && Math.abs(c.lng - 127.185) < 1e-12);
  assert.ok(!new LatLngBounds().isValid());
  // 거리: 위도 0.001° ≈ 111m
  assert.ok(Math.abs(new LatLng(37, 127).distanceTo([37.001, 127]) - 111.2) < 0.5);
});
