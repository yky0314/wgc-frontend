import { calculateDistance, moveTowards } from "./geoUtils";

const DEFAULT_CENTER = {
  lat: 1.2847,
  lon: 103.8522,
};

// 用多个陆地区块覆盖新加坡主要区域，避免司机/乘客掉进海里。
// 这些区块不是精确行政边界，而是用于视觉模拟的“安全生成区”。
const LAND_ZONES = [
  {
    id: "west_outer",
    latMin: 1.306,
    latMax: 1.352,
    lonMin: 103.676,
    lonMax: 103.73,
  },
  {
    id: "west_core",
    latMin: 1.304,
    latMax: 1.342,
    lonMin: 103.73,
    lonMax: 103.79,
  },
  {
    id: "northwest",
    latMin: 1.36,
    latMax: 1.405,
    lonMin: 103.736,
    lonMax: 103.79,
  },
  {
    id: "north",
    latMin: 1.392,
    latMax: 1.446,
    lonMin: 103.785,
    lonMax: 103.855,
  },
  {
    id: "north_central",
    latMin: 1.34,
    latMax: 1.388,
    lonMin: 103.82,
    lonMax: 103.89,
  },
  {
    id: "central",
    latMin: 1.278,
    latMax: 1.332,
    lonMin: 103.82,
    lonMax: 103.882,
  },
  {
    id: "southwest",
    latMin: 1.272,
    latMax: 1.314,
    lonMin: 103.77,
    lonMax: 103.825,
  },
  {
    id: "east_central",
    latMin: 1.3,
    latMax: 1.338,
    lonMin: 103.88,
    lonMax: 103.93,
  },
  {
    id: "northeast",
    latMin: 1.352,
    latMax: 1.41,
    lonMin: 103.885,
    lonMax: 103.94,
  },
  { id: "east", latMin: 1.325, latMax: 1.375, lonMin: 103.93, lonMax: 103.982 },
];

// 邻接区块之间补一些连接线，让司机不是永远困在一个小盒子里。
const ZONE_LINKS = [
  ["west_outer", "west_core"],
  ["west_core", "southwest"],
  ["west_core", "northwest"],
  ["northwest", "north"],
  ["north", "north_central"],
  ["north_central", "northeast"],
  ["north_central", "central"],
  ["central", "southwest"],
  ["central", "east_central"],
  ["east_central", "east"],
  ["east_central", "northeast"],
  ["central", "northwest"],
];

let cachedSyntheticNetwork = null;
let cachedCompositeNetwork = null;
let cachedCompositeKey = "";

// 随机数发生器
export function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function makePoint(lat, lon) {
  return {
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6)),
  };
}

function squareDistanceDeg(lat1, lon1, lat2, lon2) {
  const dLat = lat1 - lat2;
  const dLon = lon1 - lon2;
  return dLat * dLat + dLon * dLon;
}

function zoneCenter(zone) {
  return makePoint(
    (zone.latMin + zone.latMax) / 2,
    (zone.lonMin + zone.lonMax) / 2
  );
}

function findZoneById(zoneId) {
  return LAND_ZONES.find((zone) => zone.id === zoneId) || LAND_ZONES[0];
}

function findZoneForPoint(lat, lon) {
  const containingZone = LAND_ZONES.find(
    (zone) =>
      lat >= zone.latMin &&
      lat <= zone.latMax &&
      lon >= zone.lonMin &&
      lon <= zone.lonMax
  );

  if (containingZone) {
    return containingZone;
  }

  let bestZone = LAND_ZONES[0];
  let bestScore = Infinity;

  for (const zone of LAND_ZONES) {
    const center = zoneCenter(zone);
    const score = squareDistanceDeg(lat, lon, center.lat, center.lon);
    if (score < bestScore) {
      bestScore = score;
      bestZone = zone;
    }
  }

  return bestZone;
}

function densifyPolyline(points, stepsPerSegment = 6) {
  if (!points || points.length < 2) {
    return points || [];
  }

  const dense = [];

  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];

    if (i === 0) {
      dense.push(makePoint(start.lat, start.lon));
    }

    for (let step = 1; step <= stepsPerSegment; step++) {
      const t = step / stepsPerSegment;
      dense.push(
        makePoint(lerp(start.lat, end.lat, t), lerp(start.lon, end.lon, t))
      );
    }
  }

  return dense;
}

function buildZoneRoutes(zone) {
  const routes = [];
  const latPad = (zone.latMax - zone.latMin) * 0.08;
  const lonPad = (zone.lonMax - zone.lonMin) * 0.08;
  const lat1 = zone.latMin + latPad;
  const lat2 = zone.latMax - latPad;
  const lon1 = zone.lonMin + lonPad;
  const lon2 = zone.lonMax - lonPad;

  // 横向“街道”
  for (let i = 1; i <= 4; i++) {
    const lat = lerp(lat1, lat2, i / 5);
    routes.push({
      id: `${zone.id}_h_${i}`,
      zoneId: zone.id,
      kind: "synthetic",
      points: densifyPolyline([makePoint(lat, lon1), makePoint(lat, lon2)], 8),
    });
  }

  // 纵向“街道”
  for (let i = 1; i <= 3; i++) {
    const lon = lerp(lon1, lon2, i / 4);
    routes.push({
      id: `${zone.id}_v_${i}`,
      zoneId: zone.id,
      kind: "synthetic",
      points: densifyPolyline([makePoint(lat1, lon), makePoint(lat2, lon)], 8),
    });
  }

  // 两条斜向干线
  routes.push({
    id: `${zone.id}_diag_a`,
    zoneId: zone.id,
    kind: "synthetic",
    points: densifyPolyline(
      [
        makePoint(lat1, lon1),
        makePoint(lerp(lat1, lat2, 0.55), lerp(lon1, lon2, 0.38)),
        makePoint(lat2, lon2),
      ],
      6
    ),
  });

  routes.push({
    id: `${zone.id}_diag_b`,
    zoneId: zone.id,
    kind: "synthetic",
    points: densifyPolyline(
      [
        makePoint(lat1, lon2),
        makePoint(lerp(lat1, lat2, 0.42), lerp(lon1, lon2, 0.58)),
        makePoint(lat2, lon1),
      ],
      6
    ),
  });

  // 两条 L 型局部巡游线，避免所有车只会横平竖直或长对角
  routes.push({
    id: `${zone.id}_l_a`,
    zoneId: zone.id,
    kind: "synthetic",
    points: densifyPolyline(
      [
        makePoint(lerp(lat1, lat2, 0.22), lon1),
        makePoint(lerp(lat1, lat2, 0.22), lerp(lon1, lon2, 0.58)),
        makePoint(lat2, lerp(lon1, lon2, 0.58)),
      ],
      6
    ),
  });

  routes.push({
    id: `${zone.id}_l_b`,
    zoneId: zone.id,
    kind: "synthetic",
    points: densifyPolyline(
      [
        makePoint(lerp(lat1, lat2, 0.8), lon2),
        makePoint(lerp(lat1, lat2, 0.8), lerp(lon1, lon2, 0.42)),
        makePoint(lat1, lerp(lon1, lon2, 0.42)),
      ],
      6
    ),
  });

  return routes;
}

function buildConnectorRoute(fromZone, toZone, index) {
  const from = zoneCenter(fromZone);
  const to = zoneCenter(toZone);

  if (index % 2 === 0) {
    return {
      id: `conn_${fromZone.id}_${toZone.id}`,
      zoneId: fromZone.id,
      kind: "synthetic",
      points: densifyPolyline(
        [
          from,
          makePoint(from.lat, lerp(from.lon, to.lon, 0.55)),
          makePoint(to.lat, lerp(from.lon, to.lon, 0.55)),
          to,
        ],
        8
      ),
    };
  }

  return {
    id: `conn_${fromZone.id}_${toZone.id}`,
    zoneId: fromZone.id,
    kind: "synthetic",
    points: densifyPolyline(
      [
        from,
        makePoint(lerp(from.lat, to.lat, 0.55), from.lon),
        makePoint(lerp(from.lat, to.lat, 0.55), to.lon),
        to,
      ],
      8
    ),
  };
}

function buildSyntheticNetwork() {
  if (cachedSyntheticNetwork) {
    return cachedSyntheticNetwork;
  }

  const routes = [];

  for (const zone of LAND_ZONES) {
    routes.push(...buildZoneRoutes(zone));
  }

  ZONE_LINKS.forEach(([fromId, toId], index) => {
    const fromZone = findZoneById(fromId);
    const toZone = findZoneById(toId);
    routes.push(buildConnectorRoute(fromZone, toZone, index));
  });

  cachedSyntheticNetwork = routes;
  return cachedSyntheticNetwork;
}

function normalizeExternalRoutes(roadNetwork) {
  if (!Array.isArray(roadNetwork)) {
    return [];
  }

  return roadNetwork
    .map((route, index) => {
      if (!Array.isArray(route) || route.length < 2) {
        return null;
      }

      const points = route
        .filter(
          (pt) =>
            pt &&
            typeof pt.lat === "number" &&
            typeof pt.lon === "number" &&
            Number.isFinite(pt.lat) &&
            Number.isFinite(pt.lon)
        )
        .map((pt) => makePoint(pt.lat, pt.lon));

      if (points.length < 2) {
        return null;
      }

      const midPoint = points[Math.floor(points.length / 2)];
      const zone = findZoneForPoint(midPoint.lat, midPoint.lon);

      return {
        id: `external_${index}`,
        zoneId: zone.id,
        kind: "external",
        points,
      };
    })
    .filter(Boolean);
}

function getCompositeNetwork(roadNetwork) {
  const externalKey = Array.isArray(roadNetwork)
    ? JSON.stringify(
        roadNetwork.map((route) => route?.length || 0).slice(0, 80)
      )
    : "none";

  if (cachedCompositeNetwork && cachedCompositeKey === externalKey) {
    return cachedCompositeNetwork;
  }

  const externalRoutes = normalizeExternalRoutes(roadNetwork);
  const syntheticRoutes = buildSyntheticNetwork();

  cachedCompositeNetwork = [...externalRoutes, ...syntheticRoutes].map(
    (route, index) => ({
      ...route,
      index,
    })
  );
  cachedCompositeKey = externalKey;

  return cachedCompositeNetwork;
}

function approximateRouteDistance(points, lat, lon) {
  if (!points || points.length === 0) {
    return Infinity;
  }

  const stride = Math.max(1, Math.floor(points.length / 10));
  let best = Infinity;

  for (let i = 0; i < points.length; i += stride) {
    const pt = points[i];
    best = Math.min(best, squareDistanceDeg(lat, lon, pt.lat, pt.lon));
  }

  const last = points[points.length - 1];
  best = Math.min(best, squareDistanceDeg(lat, lon, last.lat, last.lon));

  return best;
}

function findClosestPointIndex(points, lat, lon) {
  if (!points || points.length === 0) {
    return 0;
  }

  const stride = Math.max(1, Math.floor(points.length / 24));
  let coarseBestIdx = 0;
  let coarseBestScore = Infinity;

  for (let i = 0; i < points.length; i += stride) {
    const pt = points[i];
    const score = squareDistanceDeg(lat, lon, pt.lat, pt.lon);
    if (score < coarseBestScore) {
      coarseBestScore = score;
      coarseBestIdx = i;
    }
  }

  let bestIdx = coarseBestIdx;
  let bestScore = coarseBestScore;
  const start = Math.max(0, coarseBestIdx - stride);
  const end = Math.min(points.length - 1, coarseBestIdx + stride);

  for (let i = start; i <= end; i++) {
    const pt = points[i];
    const score = squareDistanceDeg(lat, lon, pt.lat, pt.lon);
    if (score < bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx;
}

function pickRouteIndex(
  network,
  rng,
  lat = null,
  lon = null,
  preferredZoneId = null
) {
  if (!network || network.length === 0) {
    return -1;
  }

  if (lat === null || lon === null) {
    const sameZoneRoutes = preferredZoneId
      ? network.filter((route) => route.zoneId === preferredZoneId)
      : [];

    const preferredPool = sameZoneRoutes.length > 0 ? sameZoneRoutes : network;

    const syntheticPool = preferredPool.filter(
      (route) => route.kind === "synthetic"
    );

    const pool =
      syntheticPool.length > 0 && rng() < 0.72 ? syntheticPool : preferredPool;

    return pool[Math.floor(rng() * pool.length)].index;
  }

  const scored = network.map((route) => {
    const zonePenalty =
      preferredZoneId && route.zoneId !== preferredZoneId ? 0.0018 : 0;
    const kindPenalty = route.kind === "external" ? 0.0008 : 0;
    const distance = approximateRouteDistance(route.points, lat, lon);

    return {
      index: route.index,
      score: distance + zonePenalty + kindPenalty,
    };
  });

  scored.sort((a, b) => a.score - b.score);

  const shortlist = scored.slice(0, 10);
  return shortlist[Math.floor(rng() * shortlist.length)].index;
}

function fallbackSpawn(centerLat, centerLon, rng, preferredZoneId = null) {
  const referenceLat = Number.isFinite(centerLat)
    ? centerLat
    : DEFAULT_CENTER.lat;
  const referenceLon = Number.isFinite(centerLon)
    ? centerLon
    : DEFAULT_CENTER.lon;
  const zone = preferredZoneId
    ? findZoneById(preferredZoneId)
    : findZoneForPoint(referenceLat, referenceLon);

  return {
    lat: lerp(zone.latMin, zone.latMax, 0.15 + rng() * 0.7),
    lon: lerp(zone.lonMin, zone.lonMax, 0.15 + rng() * 0.7),
    routeIdx: -1,
    ptIdx: -1,
    direction: rng() > 0.5 ? 1 : -1,
    zoneId: zone.id,
  };
}

function pickSpawnPointOnNetwork(
  rng,
  roadNetwork,
  centerLat,
  centerLon,
  anchorLat = null,
  anchorLon = null,
  preferredZoneId = null
) {
  const network = getCompositeNetwork(roadNetwork);

  if (!network || network.length === 0) {
    return fallbackSpawn(centerLat, centerLon, rng, preferredZoneId);
  }

  const routeIdx = pickRouteIndex(
    network,
    rng,
    anchorLat,
    anchorLon,
    preferredZoneId
  );

  if (
    routeIdx < 0 ||
    !network[routeIdx] ||
    network[routeIdx].points.length < 2
  ) {
    return fallbackSpawn(centerLat, centerLon, rng, preferredZoneId);
  }

  const route = network[routeIdx];
  let ptIdx = 0;

  if (anchorLat !== null && anchorLon !== null) {
    const nearestIdx = findClosestPointIndex(
      route.points,
      anchorLat,
      anchorLon
    );
    ptIdx = clamp(
      nearestIdx + Math.floor(rng() * 5) - 2,
      0,
      route.points.length - 2
    );
  } else {
    ptIdx = Math.floor(rng() * (route.points.length - 1));
  }

  const p1 = route.points[ptIdx];
  const p2 = route.points[ptIdx + 1];
  const ratio =
    anchorLat !== null && anchorLon !== null ? 0.15 + rng() * 0.7 : rng();

  return {
    lat: lerp(p1.lat, p2.lat, ratio),
    lon: lerp(p1.lon, p2.lon, ratio),
    routeIdx,
    ptIdx,
    direction: rng() > 0.5 ? 1 : -1,
    zoneId: route.zoneId || findZoneForPoint(p1.lat, p1.lon).id,
  };
}

function pickRandomTargetOnNetwork(
  rng,
  roadNetwork,
  centerLat,
  centerLon,
  taxi
) {
  // 大部分订单让车辆在本区/附近区短途送客，少量订单跨区，视觉更自然。
  const preferLocal = rng() < 0.78;
  const spawn = pickSpawnPointOnNetwork(
    rng,
    roadNetwork,
    centerLat,
    centerLon,
    taxi.lat,
    taxi.lon,
    preferLocal ? taxi.zoneId : null
  );

  return { lat: spawn.lat, lon: spawn.lon };
}

function attachTaxiToRoute(taxi, spawn) {
  taxi.routeIdx = spawn.routeIdx;
  taxi.ptIdx = spawn.ptIdx;
  taxi.direction = spawn.direction;
  taxi.zoneId = spawn.zoneId;
  taxi.lat = spawn.lat;
  taxi.lon = spawn.lon;
}

function moveIdleTaxiAlongNetwork(
  taxi,
  network,
  rng,
  roadNetwork,
  centerLat,
  centerLon,
  stepMeters
) {
  let remainingMeters = stepMeters;
  let guard = 0;

  while (remainingMeters > 0 && guard < 6) {
    guard += 1;

    const route = network[taxi.routeIdx];
    if (!route || !route.points || route.points.length < 2) {
      attachTaxiToRoute(
        taxi,
        pickSpawnPointOnNetwork(
          rng,
          roadNetwork,
          centerLat,
          centerLon,
          taxi.lat,
          taxi.lon,
          taxi.zoneId
        )
      );
      break;
    }

    const nextPtIdx = taxi.ptIdx + taxi.direction;

    if (nextPtIdx < 0 || nextPtIdx >= route.points.length) {
      attachTaxiToRoute(
        taxi,
        pickSpawnPointOnNetwork(
          rng,
          roadNetwork,
          centerLat,
          centerLon,
          taxi.lat,
          taxi.lon,
          taxi.zoneId
        )
      );
      remainingMeters *= 0.55;
      continue;
    }

    const targetPt = route.points[nextPtIdx];
    const dist = Math.max(
      0.5,
      calculateDistance(taxi.lat, taxi.lon, targetPt.lat, targetPt.lon)
    );

    if (dist <= remainingMeters) {
      taxi.lat = targetPt.lat;
      taxi.lon = targetPt.lon;
      taxi.ptIdx = nextPtIdx;
      taxi.zoneId = route.zoneId || taxi.zoneId;
      remainingMeters -= dist;
    } else {
      const res = moveTowards(
        taxi.lat,
        taxi.lon,
        targetPt.lat,
        targetPt.lon,
        remainingMeters
      );
      taxi.lat = res.lat;
      taxi.lon = res.lon;
      remainingMeters = 0;
    }
  }
}

// 创建背景司机
export function createBgTaxi(id, centerLat, centerLon, rng, roadNetwork = []) {
  const spawn = pickSpawnPointOnNetwork(rng, roadNetwork, centerLat, centerLon);

  return {
    id,
    lat: spawn.lat,
    lon: spawn.lon,
    routeIdx: spawn.routeIdx,
    ptIdx: spawn.ptIdx,
    direction: spawn.direction,
    zoneId: spawn.zoneId,
    targetLat: null,
    targetLon: null,
    targetPassengerId: null,
    status: "idle", // idle | matched | occupied
    matchedTimer: 0,
  };
}

// 创建背景乘客
export function createBgPassenger(
  id,
  centerLat,
  centerLon,
  rng,
  ttlBase,
  roadNetwork = []
) {
  const spawn = pickSpawnPointOnNetwork(rng, roadNetwork, centerLat, centerLon);

  return {
    id,
    lat: spawn.lat,
    lon: spawn.lon,
    age: 0,
    ttl: ttlBase + Math.floor(rng() * 60),
    isMatched: false,
    assignedTaxiId: null,
  };
}

// 模拟一帧
export function tickBgSimulation({
  taxis,
  passengers,
  nextPassengerId,
  rng,
  centerLat,
  centerLon,
  spawnRate,
  speedMps,
  maxMatchDistM,
  matchedStayTicks,
  passengerTTLTicks,
  dtMs,
  roadNetwork = [],
}) {
  const network = getCompositeNetwork(roadNetwork);
  let newPassengers = passengers.map((p) => ({
    ...p,
    age: (p.age || 0) + 1,
  }));
  const newTaxis = taxis.map((t) => ({
    ...t,
    zoneId: t.zoneId || findZoneForPoint(t.lat, t.lon).id,
  }));

  // 1. 生成新乘客
  const baseArrivals = Math.floor(spawnRate);
  const extraArrival = rng() < spawnRate - baseArrivals ? 1 : 0;
  const arrivalsThisTick = baseArrivals + extraArrival;

  let currentNextPassengerId = nextPassengerId;
  for (let i = 0; i < arrivalsThisTick; i++) {
    newPassengers.push(
      createBgPassenger(
        currentNextPassengerId++,
        centerLat,
        centerLon,
        rng,
        passengerTTLTicks,
        roadNetwork
      )
    );
  }

  // 移除超时乘客
  newPassengers = newPassengers.filter((p) => p.age < p.ttl);

  // 每帧移动步长
  const visualSpeedFactor = 1.85;
  const stepMeters = speedMps * (dtMs / 1000) * visualSpeedFactor;

  const pickedUpPassengerIds = new Set();
  const releasedPassengerIds = new Set();

  // 2. 移动
  for (const taxi of newTaxis) {
    // matched 时，如果目标乘客已经消失，则回到 idle
    if (taxi.status === "matched") {
      const pax = newPassengers.find((p) => p.id === taxi.targetPassengerId);
      if (!pax) {
        taxi.status = "idle";
        taxi.matchedTimer = 0;
        taxi.targetLat = null;
        taxi.targetLon = null;
        taxi.targetPassengerId = null;
        attachTaxiToRoute(
          taxi,
          pickSpawnPointOnNetwork(
            rng,
            roadNetwork,
            centerLat,
            centerLon,
            taxi.lat,
            taxi.lon,
            taxi.zoneId
          )
        );
      }
    }

    if (taxi.status === "matched") {
      const pax = newPassengers.find((p) => p.id === taxi.targetPassengerId);
      if (!pax) {
        continue;
      }

      taxi.matchedTimer -= 1;
      taxi.targetLat = pax.lat;
      taxi.targetLon = pax.lon;

      const res = moveTowards(
        taxi.lat,
        taxi.lon,
        taxi.targetLat,
        taxi.targetLon,
        stepMeters
      );
      taxi.lat = res.lat;
      taxi.lon = res.lon;
      taxi.zoneId = findZoneForPoint(taxi.lat, taxi.lon).id;

      if (res.arrived) {
        pickedUpPassengerIds.add(pax.id);
        taxi.status = "occupied";
        taxi.matchedTimer = Math.max(
          12,
          Math.floor(matchedStayTicks * (1.4 + rng() * 0.6))
        );
        const dest = pickRandomTargetOnNetwork(
          rng,
          roadNetwork,
          centerLat,
          centerLon,
          taxi
        );
        taxi.targetLat = dest.lat;
        taxi.targetLon = dest.lon;
        taxi.targetPassengerId = null;
      } else if (taxi.matchedTimer <= 0) {
        releasedPassengerIds.add(pax.id);
        taxi.status = "idle";
        taxi.matchedTimer = 0;
        taxi.targetLat = null;
        taxi.targetLon = null;
        taxi.targetPassengerId = null;
        attachTaxiToRoute(
          taxi,
          pickSpawnPointOnNetwork(
            rng,
            roadNetwork,
            centerLat,
            centerLon,
            taxi.lat,
            taxi.lon,
            taxi.zoneId
          )
        );
      }
    } else if (taxi.status === "occupied") {
      taxi.matchedTimer -= 1;

      if (taxi.targetLat === null || taxi.targetLon === null) {
        const dest = pickRandomTargetOnNetwork(
          rng,
          roadNetwork,
          centerLat,
          centerLon,
          taxi
        );
        taxi.targetLat = dest.lat;
        taxi.targetLon = dest.lon;
      }

      const res = moveTowards(
        taxi.lat,
        taxi.lon,
        taxi.targetLat,
        taxi.targetLon,
        stepMeters
      );
      taxi.lat = res.lat;
      taxi.lon = res.lon;
      taxi.zoneId = findZoneForPoint(taxi.lat, taxi.lon).id;

      if (res.arrived || taxi.matchedTimer <= 0) {
        taxi.status = "idle";
        taxi.matchedTimer = 0;
        taxi.targetLat = null;
        taxi.targetLon = null;
        taxi.targetPassengerId = null;
        attachTaxiToRoute(
          taxi,
          pickSpawnPointOnNetwork(
            rng,
            roadNetwork,
            centerLat,
            centerLon,
            taxi.lat,
            taxi.lon,
            taxi.zoneId
          )
        );
      }
    } else {
      moveIdleTaxiAlongNetwork(
        taxi,
        network,
        rng,
        roadNetwork,
        centerLat,
        centerLon,
        stepMeters
      );
    }
  }

  // 乘客：已被接上车的移除；被放弃的恢复可匹配状态
  newPassengers = newPassengers
    .filter((p) => !pickedUpPassengerIds.has(p.id))
    .map((p) =>
      releasedPassengerIds.has(p.id)
        ? {
            ...p,
            isMatched: false,
            assignedTaxiId: null,
          }
        : p
    );

  // 3. 匹配
  const idleTaxis = newTaxis.filter((t) => t.status === "idle");
  const availablePassengers = newPassengers.filter((p) => !p.isMatched);
  const matches = [];

  const feasiblePairs = [];
  for (const taxi of idleTaxis) {
    for (const pax of availablePassengers) {
      const distance = calculateDistance(taxi.lat, taxi.lon, pax.lat, pax.lon);

      if (distance <= maxMatchDistM) {
        const passengerZone = findZoneForPoint(pax.lat, pax.lon).id;
        const sameZoneBoost = taxi.zoneId === passengerZone ? 0.86 : 1;
        feasiblePairs.push({
          taxiId: taxi.id,
          passengerId: pax.id,
          distance: distance * sameZoneBoost,
        });
      }
    }
  }

  feasiblePairs.sort((a, b) => {
    if (Math.abs(a.distance - b.distance) < 15) {
      return rng() - 0.5;
    }
    return a.distance - b.distance;
  });

  const matchedTaxiIds = new Set();
  const matchedPassengerIds = new Set();

  for (const pair of feasiblePairs) {
    if (
      !matchedTaxiIds.has(pair.taxiId) &&
      !matchedPassengerIds.has(pair.passengerId)
    ) {
      matchedTaxiIds.add(pair.taxiId);
      matchedPassengerIds.add(pair.passengerId);
      matches.push(pair);
    }
  }

  for (const taxi of newTaxis) {
    if (!matchedTaxiIds.has(taxi.id) || taxi.status !== "idle") {
      continue;
    }

    const matchPair = matches.find((m) => m.taxiId === taxi.id);
    if (!matchPair) {
      continue;
    }

    const pax = newPassengers.find((p) => p.id === matchPair.passengerId);
    if (!pax) {
      continue;
    }

    taxi.status = "matched";
    taxi.matchedTimer = Math.max(10, matchedStayTicks);
    taxi.targetLat = pax.lat;
    taxi.targetLon = pax.lon;
    taxi.targetPassengerId = pax.id;

    pax.isMatched = true;
    pax.assignedTaxiId = taxi.id;
  }

  const finalIdleCount = newTaxis.filter((t) => t.status === "idle").length;
  const activeCount = newTaxis.length - finalIdleCount;

  const avgProb = clamp(
    activeCount / Math.max(1, newTaxis.length) + (rng() - 0.5) * 0.03,
    0,
    1
  );

  const paxProb = clamp(
    (matches.length / Math.max(1, availablePassengers.length || 1)) * 1.15 +
      (rng() - 0.5) * 0.05,
    0,
    1
  );

  return {
    taxis: newTaxis,
    passengers: newPassengers,
    nextPassengerId: currentNextPassengerId,
    avgProb,
    paxProb,
  };
}
