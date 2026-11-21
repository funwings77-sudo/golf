// 먼 거리(10km)·능선 테스트: 타원체 거리 · 곡률 · 지형 광선 · 능선/가려짐 · 타일 범위
import test from 'node:test';
import assert from 'node:assert/strict';
import { geodesic, distance, destination } from '../js/core/geo.js';
import { rayHit, curvDrop } from '../js/core/arproj.js';
import { profile, visibleIn, linkCrests } from '../js/core/horizon.js';
import { tilesFor, tileXY, combine } from '../js/core/terrain.js';

test('타원체 거리(Vincenty): 공개 기준값과 1mm 안 · 구(haversine)와는 10km에서 수십 m까지 차이', () => {
  // Vincenty(1975) 예제: Flinders Peak → Buninyong = 54,972.271 m
  const a = { lat: -(37 + 57 / 60 + 3.72030 / 3600), lon: 144 + 25 / 60 + 29.52440 / 3600 }, b = { lat: -(37 + 39 / 60 + 10.15610 / 3600), lon: 143 + 55 / 60 + 35.38390 / 3600 };
  assert.ok(Math.abs(geodesic(a, b) - 54972.271) < 0.001, String(geodesic(a, b)));
  const p = { lat: 37.5, lon: 127 }, q = { lat: 37.5, lon: 127.113 }; // 동쪽 약 10km
  assert.ok(Math.abs(geodesic(p, q) - distance(p, q)) > 5, '구와 타원체 차이가 있어야 함');
  assert.equal(geodesic(p, p), 0);
});

test('지구 곡률 + 굴절: 10km에서 약 6.8m 낮아 보임', () => {
  assert.ok(Math.abs(curvDrop(10000) - 6.8) < 0.15, String(curvDrop(10000)));
  assert.ok(curvDrop(300) < 0.01);
});

test('지형 광선: 평지는 눈높이/기울기만큼 · 5km 앞 산비탈 · 지평선 위는 null · 10km 넘으면 null', () => {
  const flat = () => 0;
  const d = rayHit({ eye: 1.5, tanEl: -1.5 / 100, ground: flat });
  assert.ok(Math.abs(d - 100) < 0.2, String(d));
  // 5km 앞에서 솟은 산 (높이 300m 벽): 산 중턱(150m)을 조준
  const wall = s => (s >= 5000 ? 300 : 0), t = (150 - 1.5 + curvDrop(5000)) / 5000;
  assert.ok(Math.abs(rayHit({ eye: 1.5, tanEl: t, ground: wall }) - 5000) < 1);
  assert.equal(rayHit({ eye: 1.5, tanEl: 0.001, ground: flat }), null);
  // 12km 앞 산은 10km 제한 밖
  assert.equal(rayHit({ eye: 1.5, tanEl: 0.01, ground: s => (s >= 12000 ? 900 : 0) }), null);
});

test('능선: 가장 높이 올려다보이는 곳 · 앞 마루 · 언덕 뒤는 가려짐', () => {
  // 1km에 높이 40m 언덕, 4km에 300m 산
  const g = s => 40 * Math.exp(-(((s - 1000) / 150) ** 2)) + 300 * Math.exp(-(((s - 4000) / 600) ** 2));
  const pf = profile(g, 1.5);
  assert.ok(Math.abs(pf.sky.s - 4000) < 250, `sky at ${pf.sky.s}`);
  assert.ok(pf.crests.some(c => Math.abs(c.s - 1000) < 120), JSON.stringify(pf.crests));
  const tAt = s => (g(s) - curvDrop(s) - 1.5) / s;
  assert.equal(visibleIn(pf, 900, tAt(900)), true, '언덕 앞쪽 비탈은 보임');
  assert.equal(visibleIn(pf, 1400, tAt(1400)), false, '언덕 바로 뒤 골짜기는 가려짐');
  assert.equal(visibleIn(pf, 4000, tAt(4000)), true, '큰 산 꼭대기는 보임');
});

test('앞 능선 잇기: 옆 방위의 비슷한 거리 마루끼리 한 선으로', () => {
  const profs = Array.from({ length: 360 }, (_, az) => ({ crests: az >= 10 && az <= 20 ? [{ s: 1000 + az, t: 0.02 }] : [] }));
  const lines = linkCrests(profs);
  assert.equal(lines.length, 1); assert.equal(lines[0].length, 11);
});

test('타일 범위: 네모 안 타일을 빠짐없이 (10km 둘레 z12는 몇 개만) · 가까운/먼 지형 합치기', () => {
  const p = { lat: 37.5, lon: 127 };
  const keys = tilesFor([p], 10500, 12);
  const a = tileXY(37.5 + 10500 / 111320, 127 - 10500 / (111320 * Math.cos(37.5 * Math.PI / 180)), 12), b = tileXY(37.5 - 10500 / 111320, 127 + 10500 / (111320 * Math.cos(37.5 * Math.PI / 180)), 12);
  assert.equal(keys.length, (b.tx - a.tx + 1) * (b.ty - a.ty + 1)); assert.ok(keys.length <= 16);
  const e = destination(p, 90, 5000), mid = tileXY(e.lat, e.lon, 12);
  assert.ok(keys.includes(`${mid.tx}/${mid.ty}`));
  const near = (lat) => (lat > 37.6 ? NaN : 10), far = () => 99, both = combine(near, far);
  assert.equal(both(37.5, 127), 10); assert.equal(both(37.7, 127), 99);
});
