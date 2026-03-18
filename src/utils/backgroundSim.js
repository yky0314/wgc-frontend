import { calculateDistance, moveTowards } from "./geoUtils";

// 随机数发生器
export function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makePoint(lat, lon) {
  return { lat, lon };
}

function squareDistanceDeg(lat1, lon1, lat2, lon2) {
  const dLat = lat1 - lat2;
  const dLon = lon1 - lon2;
  return dLat * dLat + dLon * dLon;
}

// ========================
// 真实路网依附逻辑
// ========================

// 在真实路网上随机找一个点作为生成点
function pickSpawnPointOnNetwork(rng, roadNetwork) {
  if (!roadNetwork || roadNetwork.length === 0) {
    return {
      lat: 1.2847,
      lon: 103.8522,
      routeIdx: -1,
      ptIdx: -1,
      direction: 1,
    };
  }

  const routeIdx = Math.floor(rng() * roadNetwork.length);
  const route = roadNetwork[routeIdx];

  if (!route || route.length < 2) {
    return {
      lat: 1.2847,
      lon: 103.8522,
      routeIdx: -1,
      ptIdx: -1,
      direction: 1,
    };
  }

  const ptIdx = Math.floor(rng() * (route.length - 1));
  const p1 = route[ptIdx];
  const p2 = route[ptIdx + 1];
  const ratio = rng();

  return {
    lat: p1.lat + (p2.lat - p1.lat) * ratio,
    lon: p1.lon + (p2.lon - p1.lon) * ratio,
    routeIdx,
    ptIdx,
    direction: rng() > 0.5 ? 1 : -1,
  };
}

// 为分配订单寻找目标点
function pickRandomTargetOnNetwork(rng, roadNetwork, taxi) {
  // 如果当前路网不可用，随便生成个点
  if (!roadNetwork || roadNetwork.length === 0) {
    return {
      lat: taxi.lat + (rng() - 0.5) * 0.05,
      lon: taxi.lon + (rng() - 0.5) * 0.05,
    };
  }

  // 小概率跨全岛分配，大概率在同一条/邻近路线找目标点，视觉更自然
  const preferLocal = rng() < 0.7;

  if (preferLocal && taxi.routeIdx >= 0) {
    const route = roadNetwork[taxi.routeIdx];
    const targetPtIdx = Math.floor(rng() * route.length);
    const p = route[targetPtIdx];
    return { lat: p.lat, lon: p.lon };
  } else {
    const spawn = pickSpawnPointOnNetwork(rng, roadNetwork);
    return { lat: spawn.lat, lon: spawn.lon };
  }
}

function findNearestPointOnNetwork(roadNetwork, lat, lon) {
  if (!roadNetwork || roadNetwork.length === 0) return null;

  let best = null;
  let bestDist = Infinity;

  for (let i = 0; i < roadNetwork.length; i++) {
    const route = roadNetwork[i];
    if (!route || route.length === 0) continue;

    for (let j = 0; j < route.length; j++) {
      const pt = route[j];
      const d = squareDistanceDeg(lat, lon, pt.lat, pt.lon);
      if (d < bestDist) {
        bestDist = d;
        best = {
          routeIdx: i,
          ptIdx: j,
          lat: pt.lat,
          lon: pt.lon,
        };
      }
    }
  }

  return best;
}

function snapTaxiToNearestNetworkPoint(taxi, roadNetwork) {
  const nearest = findNearestPointOnNetwork(roadNetwork, taxi.lat, taxi.lon);
  if (!nearest) return;

  taxi.lat = nearest.lat;
  taxi.lon = nearest.lon;
  taxi.routeIdx = nearest.routeIdx;
  taxi.ptIdx = nearest.ptIdx;

  const route = roadNetwork[nearest.routeIdx];
  if (!route || route.length < 2) {
    taxi.direction = 1;
    return;
  }

  if (nearest.ptIdx <= 0) {
    taxi.direction = 1;
  } else if (nearest.ptIdx >= route.length - 1) {
    taxi.direction = -1;
  }
}

function orientTaxiTowardsTarget(taxi, roadNetwork, targetLat, targetLon) {
  if (
    targetLat === null ||
    targetLon === null ||
    taxi.routeIdx === -1 ||
    taxi.ptIdx === -1
  ) {
    return;
  }

  const route = roadNetwork[taxi.routeIdx];
  if (!route || route.length < 2) return;

  const prevPt = taxi.ptIdx > 0 ? route[taxi.ptIdx - 1] : null;
  const nextPt = taxi.ptIdx < route.length - 1 ? route[taxi.ptIdx + 1] : null;

  if (!prevPt && !nextPt) return;
  if (!prevPt) {
    taxi.direction = 1;
    return;
  }
  if (!nextPt) {
    taxi.direction = -1;
    return;
  }

  const prevDist = calculateDistance(
    prevPt.lat,
    prevPt.lon,
    targetLat,
    targetLon
  );
  const nextDist = calculateDistance(
    nextPt.lat,
    nextPt.lon,
    targetLat,
    targetLon
  );

  taxi.direction = nextDist <= prevDist ? 1 : -1;
}

// 核心逻辑：沿着真实路线游走，到尽头时跳跃到相交路线，实现真实“拐弯”
function moveIdleTaxiAlongNetwork(
  taxi,
  roadNetwork,
  rng,
  stepMeters,
  targetLat = null,
  targetLon = null
) {
  if (!roadNetwork || roadNetwork.length === 0 || taxi.routeIdx === -1) {
    return; // 无路网时不游走
  }

  let remainingMeters = stepMeters;
  let guard = 0;

  while (remainingMeters > 0 && guard < 6) {
    guard += 1;
    const route = roadNetwork[taxi.routeIdx];

    if (!route || route.length < 2) {
      break;
    }

    const nextPtIdx = taxi.ptIdx + taxi.direction;

    // 如果走到了路线尽头
    if (nextPtIdx < 0 || nextPtIdx >= route.length) {
      let bestJumpRoute = -1;
      let bestJumpPt = -1;
      let bestTargetDist = Infinity;
      const maxJumpRadius = 0.00015; // 限制跳跃半径(约数十米到百米级交汇)

      for (let i = 0; i < roadNetwork.length; i++) {
        if (i === taxi.routeIdx) continue; // 不跳自己
        const otherRoute = roadNetwork[i];
        if (!otherRoute) continue;

        // 随机抽几个点比较，增加随机性并加快性能
        for (let j = 0; j < 5; j++) {
          const ptIdx = Math.floor(rng() * otherRoute.length);
          const pt = otherRoute[ptIdx];
          const d = squareDistanceDeg(taxi.lat, taxi.lon, pt.lat, pt.lon);

          if (d >= maxJumpRadius) continue;

          const targetDist =
            targetLat === null || targetLon === null
              ? d
              : calculateDistance(pt.lat, pt.lon, targetLat, targetLon);

          if (targetDist < bestTargetDist) {
            bestTargetDist = targetDist;
            bestJumpRoute = i;
            bestJumpPt = ptIdx;
          }
        }
      }

      if (bestJumpRoute !== -1) {
        // 成功切换到新道路，拐弯
        taxi.routeIdx = bestJumpRoute;
        taxi.ptIdx = bestJumpPt;
        const newRoute = roadNetwork[bestJumpRoute];
        const newPt = newRoute[bestJumpPt];
        taxi.lat = newPt.lat;
        taxi.lon = newPt.lon;

        if (targetLat === null || targetLon === null) {
          taxi.direction = rng() > 0.5 ? 1 : -1;
        } else {
          orientTaxiTowardsTarget(taxi, roadNetwork, targetLat, targetLon);
        }
      } else {
        // 如果周围没有其他路，就原路掉头
        taxi.direction *= -1;
        taxi.ptIdx += taxi.direction; // 退回合法索引
      }
      remainingMeters *= 0.5; // 拐弯减速
      continue;
    }

    // 正常顺着当前道路往下走
    const targetPt = route[nextPtIdx];
    const dist = calculateDistance(
      taxi.lat,
      taxi.lon,
      targetPt.lat,
      targetPt.lon
    );

    if (dist <= remainingMeters) {
      // 到达节点
      taxi.lat = targetPt.lat;
      taxi.lon = targetPt.lon;
      taxi.ptIdx = nextPtIdx;
      remainingMeters -= dist;
    } else {
      // 在两点中间
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

// ========================
// 实体生成与管理
// ========================

export function createBgTaxi(id, rng, roadNetwork = []) {
  const spawn = pickSpawnPointOnNetwork(rng, roadNetwork);

  return {
    id,
    lat: spawn.lat,
    lon: spawn.lon,
    routeIdx: spawn.routeIdx,
    ptIdx: spawn.ptIdx,
    direction: spawn.direction,
    targetLat: null,
    targetLon: null,
    targetPassengerId: null,
    status: "idle", // idle | matched | occupied
    matchedTimer: 0,
  };
}

export function createBgPassenger(id, rng, ttlBase, roadNetwork = []) {
  const spawn = pickSpawnPointOnNetwork(rng, roadNetwork);

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

// ========================
// 主循环逻辑
// ========================

export function tickBgSimulation({
  taxis,
  passengers,
  nextPassengerId,
  rng,
  spawnRate,
  speedMps,
  maxMatchDistM,
  matchedStayTicks,
  passengerTTLTicks,
  dtMs,
  roadNetwork = [],
}) {
  let newPassengers = passengers.map((p) => ({
    ...p,
    age: (p.age || 0) + 1,
  }));
  const newTaxis = taxis.map((t) => ({ ...t }));

  // 1. 生成新乘客
  const baseArrivals = Math.floor(spawnRate);
  const extraArrival = rng() < spawnRate - baseArrivals ? 1 : 0;
  const arrivalsThisTick = baseArrivals + extraArrival;

  let currentNextPassengerId = nextPassengerId;
  for (let i = 0; i < arrivalsThisTick; i++) {
    newPassengers.push(
      createBgPassenger(
        currentNextPassengerId++,
        rng,
        passengerTTLTicks,
        roadNetwork
      )
    );
  }

  // 移除超时且没上车的乘客
  newPassengers = newPassengers.filter((p) => p.age < p.ttl || p.isMatched);

  // 移动步长：地图显示为了看起来顺滑可以加个显示加速系数
  const visualSpeedFactor = 1.4;
  const stepMeters = speedMps * (dtMs / 1000) * visualSpeedFactor;

  const pickedUpPassengerIds = new Set();
  const releasedPassengerIds = new Set();

  // 2. 司机移动
  for (const taxi of newTaxis) {
    // 处理被乘客取消订单的异常
    if (taxi.status === "matched") {
      const pax = newPassengers.find((p) => p.id === taxi.targetPassengerId);
      if (!pax) {
        taxi.status = "idle";
        taxi.matchedTimer = 0;
        taxi.targetLat = null;
        taxi.targetLon = null;
        taxi.targetPassengerId = null;
      }
    }

    if (taxi.status === "matched") {
      const pax = newPassengers.find((p) => p.id === taxi.targetPassengerId);
      if (!pax) continue;

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

      if (res.arrived) {
        pickedUpPassengerIds.add(pax.id);
        taxi.status = "occupied";
        taxi.matchedTimer = Math.max(
          12,
          Math.floor(matchedStayTicks * (1.2 + rng() * 0.8)) // 开往目的地所需耐心
        );
        const dest = pickRandomTargetOnNetwork(rng, roadNetwork, taxi);
        taxi.targetLat = dest.lat;
        taxi.targetLon = dest.lon;
        taxi.targetPassengerId = null;
        snapTaxiToNearestNetworkPoint(taxi, roadNetwork);
        orientTaxiTowardsTarget(
          taxi,
          roadNetwork,
          taxi.targetLat,
          taxi.targetLon
        );
      } else if (taxi.matchedTimer <= 0) {
        // 司机耐心耗尽，重新巡游
        releasedPassengerIds.add(pax.id);
        taxi.status = "idle";
        taxi.matchedTimer = 0;
        taxi.targetLat = null;
        taxi.targetLon = null;
        taxi.targetPassengerId = null;
        // 把他放回附近的真实路网上
        const nearestSpawn = pickSpawnPointOnNetwork(rng, roadNetwork);
        taxi.routeIdx = nearestSpawn.routeIdx;
        taxi.ptIdx = nearestSpawn.ptIdx;
        taxi.direction = nearestSpawn.direction;
      }
    } else if (taxi.status === "occupied") {
      taxi.matchedTimer -= 1;

      if (taxi.targetLat === null || taxi.targetLon === null) {
        const dest = pickRandomTargetOnNetwork(rng, roadNetwork, taxi);
        taxi.targetLat = dest.lat;
        taxi.targetLon = dest.lon;
      }

      if (taxi.routeIdx === -1 || taxi.ptIdx === -1) {
        snapTaxiToNearestNetworkPoint(taxi, roadNetwork);
      }

      orientTaxiTowardsTarget(
        taxi,
        roadNetwork,
        taxi.targetLat,
        taxi.targetLon
      );
      moveIdleTaxiAlongNetwork(
        taxi,
        roadNetwork,
        rng,
        stepMeters,
        taxi.targetLat,
        taxi.targetLon
      );

      const remainingDist = calculateDistance(
        taxi.lat,
        taxi.lon,
        taxi.targetLat,
        taxi.targetLon
      );

      if (remainingDist <= Math.max(12, stepMeters) || taxi.matchedTimer <= 0) {
        taxi.status = "idle";
        taxi.matchedTimer = 0;
        taxi.targetLat = null;
        taxi.targetLon = null;
        taxi.targetPassengerId = null;

        // 送客抵达后，司机将自己吸附回最近的道路
        const nearestSpawn = pickSpawnPointOnNetwork(rng, roadNetwork);
        taxi.routeIdx = nearestSpawn.routeIdx;
        taxi.ptIdx = nearestSpawn.ptIdx;
        taxi.direction = nearestSpawn.direction;
      }
    } else {
      // IDLE 巡游状态：绝对只在真实路网上移动！
      moveIdleTaxiAlongNetwork(taxi, roadNetwork, rng, stepMeters);
    }
  }

  // 乘客状态更新
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

  // 3. 闲置匹配贪心算法
  const idleTaxis = newTaxis.filter((t) => t.status === "idle");
  const availablePassengers = newPassengers.filter((p) => !p.isMatched);
  const matches = [];

  const feasiblePairs = [];
  for (const taxi of idleTaxis) {
    for (const pax of availablePassengers) {
      const distance = calculateDistance(taxi.lat, taxi.lon, pax.lat, pax.lon);
      if (distance <= maxMatchDistM) {
        feasiblePairs.push({
          taxiId: taxi.id,
          passengerId: pax.id,
          distance: distance,
        });
      }
    }
  }

  // 按距离远近打乱后排序
  feasiblePairs.sort((a, b) => {
    if (Math.abs(a.distance - b.distance) < 20) {
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
    if (!matchedTaxiIds.has(taxi.id) || taxi.status !== "idle") continue;
    const matchPair = matches.find((m) => m.taxiId === taxi.id);
    if (!matchPair) continue;
    const pax = newPassengers.find((p) => p.id === matchPair.passengerId);
    if (!pax) continue;

    taxi.status = "matched";
    taxi.matchedTimer = Math.max(10, matchedStayTicks);
    taxi.targetLat = pax.lat;
    taxi.targetLon = pax.lon;
    taxi.targetPassengerId = pax.id;

    pax.isMatched = true;
    pax.assignedTaxiId = taxi.id;
  }

  // 计算分配概率数据
  const finalIdleCount = newTaxis.filter((t) => t.status === "idle").length;
  const activeCount = newTaxis.length - finalIdleCount;

  const avgProb = Math.max(
    0,
    Math.min(
      1,
      activeCount / Math.max(1, newTaxis.length) + (rng() - 0.5) * 0.03
    )
  );

  const paxProb = Math.max(
    0,
    Math.min(
      1,
      (matches.length / Math.max(1, availablePassengers.length || 1)) * 1.15 +
        (rng() - 0.5) * 0.05
    )
  );

  return {
    taxis: newTaxis,
    passengers: newPassengers,
    nextPassengerId: currentNextPassengerId,
    avgProb,
    paxProb,
  };
}
