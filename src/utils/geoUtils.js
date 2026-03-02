// 计算两点之间的距离（米）- Haversine 公式
export const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371000; // 地球半径（米）
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
};

// 获取 OSRM 路线
export const getRoute = async (fromLat, fromLon, toLat, toLon) => {
  try {
    const ROUTING_BASE = "https://router.project-osrm.org";
    const url = `${ROUTING_BASE}/route/v1/driving/${fromLon},${fromLat};${toLon},${toLat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.routes || !data.routes[0] || !data.routes[0].geometry)
      return null;
    const coords = data.routes[0].geometry.coordinates; // [ [lon,lat], ... ]
    // 转换为 [lat, lon]
    return coords.map((c) => [c[1], c[0]]);
  } catch (e) {
    console.warn("route fetch failed", e);
    return null;
  }
};

// 生成随机目的地（在指定位置附近）
export const pickRandomDestinationNear = (lat, lon, radiusDeg = 0.03) => {
  return [
    lat + (Math.random() - 0.5) * radiusDeg,
    lon + (Math.random() - 0.5) * radiusDeg,
  ];
};

// 将坐标吸附到最近的道路上（OSRM nearest API）
export const snapToRoad = async (lat, lon) => {
  try {
    const ROUTING_BASE = "https://router.project-osrm.org";
    const url = `${ROUTING_BASE}/nearest/v1/driving/${lon},${lat}?number=1`;
    const res = await fetch(url);
    if (!res.ok) return { lat, lon };
    const data = await res.json();
    if (data.waypoints && data.waypoints[0]) {
      const [snappedLon, snappedLat] = data.waypoints[0].location;
      return { lat: snappedLat, lon: snappedLon };
    }
    return { lat, lon };
  } catch (e) {
    return { lat, lon };
  }
};

// 线性插值移动
export const moveTowards = (
  currentLat,
  currentLon,
  targetLat,
  targetLon,
  stepMeters
) => {
  const distMeters = calculateDistance(
    currentLat,
    currentLon,
    targetLat,
    targetLon
  );
  if (distMeters <= stepMeters) {
    return { lat: targetLat, lon: targetLon, arrived: true };
  }
  const frac = Math.min(1, stepMeters / distMeters);
  return {
    lat: currentLat + (targetLat - currentLat) * frac,
    lon: currentLon + (targetLon - currentLon) * frac,
    arrived: false,
  };
};
