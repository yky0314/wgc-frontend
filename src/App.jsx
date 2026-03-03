import React, { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { message } from "antd";
import DeckGL from "@deck.gl/react";
import { Map } from "react-map-gl";
import { IconLayer, PathLayer, LineLayer } from "@deck.gl/layers";
import ControlPanel from "./components/ControlPanel";
import Legend from "./components/Legend";
import driversAPI from "./services/drivers";
import {
  calculateDistance,
  getRoute,
  pickRandomDestinationNear,
  moveTowards,
  snapToRoad,
} from "./utils/geoUtils";
import "./App.css";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const DEFAULT_LAT = 1.2847;
const DEFAULT_LON = 103.8522;

const INITIAL_VIEW_STATE = {
  longitude: DEFAULT_LON,
  latitude: DEFAULT_LAT,
  zoom: 14,
  pitch: 0,
  bearing: 0,
};

const SIM_INTERVAL_MS = 600;
const SIM_SPEED_MPS = 6;
const ARRIVAL_THRESHOLD_M = 30;
const MATCH_INTERVAL = 10000;

const PASSENGER_SPAWN_MIN = 5000;
const PASSENGER_SPAWN_MAX = 15000;
const PASSENGER_PATIENCE_MIN = 15000;
const PASSENGER_PATIENCE_MAX = 35000;
const RIVAL_SPAWN_MIN = 15000;
const RIVAL_SPAWN_MAX = 30000;
const PASSENGER_SPAWN_COUNT = 2;
const RIVAL_SPAWN_RADIUS_DEG = 0.06;
const PASSENGER_SPAWN_RADIUS_DEG = 0.05;

// SVG 图标辅助函数
const svgToDataUrl = (svgStr) => `data:image/svg+xml;base64,${btoa(svgStr)}`;

const ICON_DRIVER_IDLE = svgToDataUrl(
  '<svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="20" fill="#1890ff" stroke="#fff" stroke-width="3"/><path d="M24 12 L28 18 L20 18 Z M22 20 L26 20 L26 26 L22 26 Z" fill="#fff"/></svg>'
);
const ICON_DRIVER_MATCHED = svgToDataUrl(
  '<svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="20" fill="#52c41a" stroke="#fff" stroke-width="3"/><path d="M24 12 L28 18 L20 18 Z M22 20 L26 20 L26 26 L22 26 Z" fill="#fff"/></svg>'
);
const ICON_RIVAL_IDLE = svgToDataUrl(
  '<svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="20" fill="#ff4d4f" stroke="#fff" stroke-width="3"/><path d="M24 12 L28 18 L20 18 Z M22 20 L26 20 L26 26 L22 26 Z" fill="#fff"/></svg>'
);
const ICON_RIVAL_MATCHED = svgToDataUrl(
  '<svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="20" fill="#52c41a" stroke="#fff" stroke-width="3"/><path d="M24 12 L28 18 L20 18 Z M22 20 L26 20 L26 26 L22 26 Z" fill="#fff"/></svg>'
);
// 紫色：竞争司机已接到乘客（occupied）
const ICON_RIVAL_OCCUPIED = svgToDataUrl(
  '<svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="20" fill="#722ed1" stroke="#fff" stroke-width="3"/><path d="M24 12 L28 18 L20 18 Z M22 20 L26 20 L26 26 L22 26 Z" fill="#fff"/></svg>'
);
const ICON_PASSENGER_UNMATCHED = svgToDataUrl(
  '<svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><circle cx="20" cy="20" r="18" fill="#fa8c16" stroke="#fff" stroke-width="2"/><circle cx="20" cy="15" r="5" fill="#fff"/><path d="M12 28 Q12 20 20 20 Q28 20 28 28" fill="#fff"/></svg>'
);
const ICON_PASSENGER_MATCHED = svgToDataUrl(
  '<svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><circle cx="20" cy="20" r="18" fill="#52c41a" stroke="#fff" stroke-width="2"/><circle cx="20" cy="15" r="5" fill="#fff"/><path d="M12 28 Q12 20 20 20 Q28 20 28 28" fill="#fff"/></svg>'
);

const findNearestPassenger = (lat, lon, passengerList) => {
  if (!passengerList || passengerList.length === 0) return null;
  let nearest = null;
  let minDist = Infinity;
  for (const p of passengerList) {
    const dist = calculateDistance(lat, lon, p.lat, p.lng);
    if (dist < minDist) {
      minDist = dist;
      nearest = p;
    }
  }
  return nearest;
};

function App() {
  const { t } = useTranslation();

  const [driverId] = useState("10001");
  const [isOnline, setIsOnline] = useState(false);
  const [currentLat, setCurrentLat] = useState(INITIAL_VIEW_STATE.latitude);
  const [currentLon, setCurrentLon] = useState(INITIAL_VIEW_STATE.longitude);
  const [driverPath, setDriverPath] = useState([
    [INITIAL_VIEW_STATE.longitude, INITIAL_VIEW_STATE.latitude],
  ]);
  // 随机游走路线（无乘客时使用）
  const [driverRoute, setDriverRoute] = useState(null);
  const [driverRouteIdx, setDriverRouteIdx] = useState(0);

  const [passengers, setPassengers] = useState([]);
  const [selectedPassenger, setSelectedPassenger] = useState(null);

  const [rivalDrivers, setRivalDrivers] = useState([]);
  const [showRivalDrivers, setShowRivalDrivers] = useState(true);

  const [matches, setMatches] = useState({});

  const [isSimulating, setIsSimulating] = useState(false);
  const simulationTimerRef = useRef(null);
  const matchTimerRef = useRef(null);
  const rivalTimersRef = useRef([]);
  const passengerSpawnTimerRef = useRef(null);
  const rivalSpawnTimerRef = useRef(null);
  const passengerPatienceTimersRef = useRef({});
  const passengerIdCounterRef = useRef(1000);
  const rivalIdCounterRef = useRef(9000);

  const posRef = useRef({
    lat: INITIAL_VIEW_STATE.latitude,
    lon: INITIAL_VIEW_STATE.longitude,
  });
  // 随机游走路线 ref
  const driverRouteRef = useRef(null);
  const driverRouteIdxRef = useRef(0);
  // 前往乘客的 OSRM 导航路线 ref（独立于随机游走路线）
  const driverNavRouteRef = useRef(null);
  const driverNavRouteIdxRef = useRef(0);

  const selectedPassengerRef = useRef(null);
  const isSimulatingRef = useRef(false);
  const passengersRef = useRef([]);
  const rivalDriversRef = useRef([]);
  const matchesRef = useRef({});

  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);

  // ── 同步 ref ─────────────────────────────────────────────────────────
  useEffect(() => {
    posRef.current = { lat: currentLat, lon: currentLon };
  }, [currentLat, currentLon]);
  useEffect(() => {
    driverRouteRef.current = driverRoute;
  }, [driverRoute]);
  useEffect(() => {
    driverRouteIdxRef.current = driverRouteIdx;
  }, [driverRouteIdx]);
  useEffect(() => {
    selectedPassengerRef.current = selectedPassenger;
  }, [selectedPassenger]);
  useEffect(() => {
    isSimulatingRef.current = isSimulating;
  }, [isSimulating]);
  useEffect(() => {
    passengersRef.current = passengers;
  }, [passengers]);
  useEffect(() => {
    rivalDriversRef.current = rivalDrivers;
  }, [rivalDrivers]);
  useEffect(() => {
    matchesRef.current = matches;
  }, [matches]);

  // ── selectedPassenger 变化时，用 OSRM 获取导航路线 ────────────────
  useEffect(() => {
    driverNavRouteRef.current = null;
    driverNavRouteIdxRef.current = 0;
    if (!selectedPassenger) return;

    const targetId = selectedPassenger.id;
    const { lat, lon } = posRef.current;

    getRoute(lat, lon, selectedPassenger.lat, selectedPassenger.lng).then(
      (route) => {
        if (
          selectedPassengerRef.current?.id === targetId &&
          route &&
          route.length > 1
        ) {
          driverNavRouteRef.current = route;
          driverNavRouteIdxRef.current = 0;
        }
      }
    );
  }, [selectedPassenger?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 匹配结果更新时，切换主司机目标乘客 ──────────────────────────
  useEffect(() => {
    const matchedPassengerId = matches[`d_${driverId}`];
    if (matchedPassengerId) {
      const matchedPassenger = passengers.find(
        (p) => p.id === matchedPassengerId
      );
      if (matchedPassenger && matchedPassenger.id !== selectedPassenger?.id) {
        setSelectedPassenger(matchedPassenger);
        selectedPassengerRef.current = matchedPassenger;
        driverRouteRef.current = null;
        driverRouteIdxRef.current = 0;
        setDriverRoute(null);
        setDriverRouteIdx(0);
      }
    }
  }, [matches, passengers, driverId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 乘客忍耐超时移除 ─────────────────────────────────────────────
  const removePassengerById = useCallback((passengerId) => {
    setPassengers((prev) => prev.filter((p) => p.id !== passengerId));
    if (selectedPassengerRef.current?.id === passengerId) {
      const remaining = passengersRef.current.filter(
        (p) => p.id !== passengerId
      );
      const nearest = findNearestPassenger(
        posRef.current.lat,
        posRef.current.lon,
        remaining
      );
      selectedPassengerRef.current = nearest;
      setSelectedPassenger(nearest);
    }
    delete passengerPatienceTimersRef.current[passengerId];
  }, []);

  const spawnPassengerAt = useCallback(
    async (lat, lng) => {
      const snapped = await snapToRoad(lat, lng);
      const newId = `p_spawn_${passengerIdCounterRef.current++}`;
      setPassengers((prev) => [
        ...prev,
        {
          id: newId,
          lat: snapped.lat,
          lng: snapped.lon,
          matched: false,
          spawned: true,
        },
      ]);
      const patience =
        PASSENGER_PATIENCE_MIN +
        Math.random() * (PASSENGER_PATIENCE_MAX - PASSENGER_PATIENCE_MIN);
      passengerPatienceTimersRef.current[newId] = setTimeout(
        () => removePassengerById(newId),
        patience
      );
    },
    [removePassengerById]
  );

  const spawnPassengers = useCallback(() => {
    const { lat, lon } = posRef.current;
    for (let i = 0; i < PASSENGER_SPAWN_COUNT; i++) {
      const [pLat, pLon] = pickRandomDestinationNear(
        lat,
        lon,
        PASSENGER_SPAWN_RADIUS_DEG
      );
      spawnPassengerAt(pLat, pLon);
    }
  }, [spawnPassengerAt]);

  const spawnRivalDriver = useCallback(async () => {
    const { lat, lon } = posRef.current;
    const [dLat, dLon] = pickRandomDestinationNear(
      lat,
      lon,
      RIVAL_SPAWN_RADIUS_DEG
    );
    const snapped = await snapToRoad(dLat, dLon);
    const newId = `d_rival_${rivalIdCounterRef.current++}`;
    setRivalDrivers((prev) => [
      ...prev,
      {
        id: newId,
        lat: snapped.lat,
        lon: snapped.lon,
        occupied: false,
        route: null,
        routeIdx: 0,
        spawned: true,
      },
    ]);
  }, []);

  const schedulePassengerSpawn = useCallback(() => {
    const delay =
      PASSENGER_SPAWN_MIN +
      Math.random() * (PASSENGER_SPAWN_MAX - PASSENGER_SPAWN_MIN);
    passengerSpawnTimerRef.current = setTimeout(() => {
      if (!isSimulatingRef.current) return;
      spawnPassengers();
      schedulePassengerSpawn();
    }, delay);
  }, [spawnPassengers]);

  const scheduleRivalSpawn = useCallback(() => {
    const delay =
      RIVAL_SPAWN_MIN + Math.random() * (RIVAL_SPAWN_MAX - RIVAL_SPAWN_MIN);
    rivalSpawnTimerRef.current = setTimeout(() => {
      if (!isSimulatingRef.current) return;
      spawnRivalDriver();
      scheduleRivalSpawn();
    }, delay);
  }, [spawnRivalDriver]);

  const requestPassengers = useCallback(async () => {
    try {
      const res = await driversAPI.requestPassenger({
        driverId: parseInt(driverId),
        latitude: currentLat,
        longitude: currentLon,
      });
      if (res?.data?.code === "200" && res.data.data) {
        Object.values(passengerPatienceTimersRef.current).forEach(clearTimeout);
        passengerPatienceTimersRef.current = {};
        const passengerData = res.data.data.map((p, idx) => ({
          id: `p_${idx + 1}`,
          nodeId: p.nodeId,
          lat: p.lat,
          lng: p.lng,
          matched: false,
        }));
        setPassengers(passengerData);
        message.success(`Fetched ${passengerData.length} passengers`);
      }
    } catch (error) {
      console.error("Failed to request passengers:", error);
      message.error("Failed to request passengers");
    }
  }, [driverId, currentLat, currentLon]);

  const requestRivalDrivers = useCallback(async () => {
    try {
      const res = await driversAPI.getRivalDrivers({
        driverId: parseInt(driverId),
        latitude: currentLat,
        longitude: currentLon,
      });
      if (res?.data?.code === "200" && res.data.data) {
        const rivalData = res.data.data.map((d) => ({
          id: `d_${d.id}`,
          nodeId: d.nodeId,
          lat: d.latitude,
          lon: d.longitude,
          occupied: false,
          route: null,
          routeIdx: 0,
        }));
        setRivalDrivers(rivalData);
        message.success(`Fetched ${rivalData.length} rival drivers`);
      }
    } catch (error) {
      console.error("Failed to request rival drivers:", error);
      message.error("Failed to request rival drivers");
    }
  }, [driverId, currentLat, currentLon]);

  const performMatching = useCallback(async () => {
    const currentPassengers = passengersRef.current;
    const currentRivals = rivalDriversRef.current;
    const { lat, lon } = posRef.current;
    if (currentPassengers.length === 0) return;
    try {
      const drivers = { [`d_${driverId}`]: [lat, lon] };
      currentRivals.forEach((d) => {
        drivers[d.id] = [d.lat, d.lon];
      });
      const passengersData = {};
      currentPassengers.forEach((p) => {
        passengersData[p.id] = [p.lat, p.lng];
      });
      const res = await driversAPI.matchDriversPassengers({
        drivers,
        passengers: passengersData,
        k: 10,
      });
      if (res?.data?.status === "success" && res.data.matches) {
        const newMatches = res.data.matches;
        setMatches((prevMatches) => {
          if (JSON.stringify(prevMatches) !== JSON.stringify(newMatches)) {
            message.success(
              `Match successful: ${res.data.summary.matched_count} pairs matched`
            );
            return newMatches;
          }
          return prevMatches;
        });
      }
    } catch (error) {
      console.error("Match failed:", error);
    }
  }, [driverId]);

  const toggleOnline = async () => {
    const newStatus = !isOnline;
    try {
      const driver = {
        driverId: parseInt(driverId),
        currentStatus: newStatus ? "IDLE" : "OFFLINED",
        onboardedAt: new Date().toISOString(),
        createdAt: "2019-08-24T14:15:22.123Z",
        updatedAt: new Date().toISOString(),
      };
      const res = await driversAPI.updateStatus(driver);
      if (res?.data?.code === "200") {
        setIsOnline(newStatus);
        message.success(
          res.data.data ||
            (newStatus ? "Online successful" : "Offline successful")
        );
        if (newStatus) {
          const snapped = await snapToRoad(
            posRef.current.lat,
            posRef.current.lon
          );
          posRef.current = { lat: snapped.lat, lon: snapped.lon };
          setCurrentLat(snapped.lat);
          setCurrentLon(snapped.lon);
          setDriverPath([[snapped.lon, snapped.lat]]);
          await requestPassengers();
          if (showRivalDrivers) await requestRivalDrivers();
        } else {
          stopSimulation();
        }
      }
    } catch (error) {
      console.error("Failed to update status:", error);
      message.error("Failed to update status");
    }
  };

  const stopSimulation = useCallback(() => {
    setIsSimulating(false);
    isSimulatingRef.current = false;
    if (simulationTimerRef.current) {
      clearInterval(simulationTimerRef.current);
      simulationTimerRef.current = null;
    }
    if (matchTimerRef.current) {
      clearInterval(matchTimerRef.current);
      matchTimerRef.current = null;
    }
    if (passengerSpawnTimerRef.current) {
      clearTimeout(passengerSpawnTimerRef.current);
      passengerSpawnTimerRef.current = null;
    }
    if (rivalSpawnTimerRef.current) {
      clearTimeout(rivalSpawnTimerRef.current);
      rivalSpawnTimerRef.current = null;
    }
  }, []);

  const startSimulation = useCallback(() => {
    if (!isOnline) {
      message.warning("Please go online first");
      return;
    }
    setIsSimulating(true);
    isSimulatingRef.current = true;
    if (passengers.length > 0) {
      const targetPassenger = selectedPassenger || passengers[0];
      if (!selectedPassenger) {
        setSelectedPassenger(targetPassenger);
        selectedPassengerRef.current = targetPassenger;
      }
      message.info(
        `Driving to passenger at [${targetPassenger.lat.toFixed(
          4
        )}, ${targetPassenger.lng.toFixed(4)}]`
      );
    } else {
      message.info("Driver started moving randomly");
    }
    performMatching();
    matchTimerRef.current = setInterval(performMatching, MATCH_INTERVAL);
    schedulePassengerSpawn();
    scheduleRivalSpawn();
  }, [
    isOnline,
    passengers,
    selectedPassenger,
    performMatching,
    schedulePassengerSpawn,
    scheduleRivalSpawn,
  ]);

  const resetSimulation = useCallback(() => {
    stopSimulation();
    Object.values(passengerPatienceTimersRef.current).forEach(clearTimeout);
    passengerPatienceTimersRef.current = {};
    setCurrentLat(INITIAL_VIEW_STATE.latitude);
    setCurrentLon(INITIAL_VIEW_STATE.longitude);
    posRef.current = {
      lat: INITIAL_VIEW_STATE.latitude,
      lon: INITIAL_VIEW_STATE.longitude,
    };
    setDriverPath([
      [INITIAL_VIEW_STATE.longitude, INITIAL_VIEW_STATE.latitude],
    ]);
    setPassengers([]);
    setRivalDrivers([]);
    setMatches({});
    setSelectedPassenger(null);
    selectedPassengerRef.current = null;
    driverNavRouteRef.current = null;
    driverNavRouteIdxRef.current = 0;
    setViewState(INITIAL_VIEW_STATE);
    message.info("Reset complete");
  }, [stopSimulation]);

  // ── 主司机移动逻辑 ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isSimulating) return;

    const moveDriver = async () => {
      const { lat: curLat, lon: curLon } = posRef.current;
      const target = selectedPassengerRef.current;

      if (target) {
        // 有目标乘客：先检查是否到达
        const dist = calculateDistance(curLat, curLon, target.lat, target.lng);

        if (dist <= ARRIVAL_THRESHOLD_M) {
          // ── 接到乘客 ──
          posRef.current = { lat: target.lat, lon: target.lng };
          setCurrentLat(target.lat);
          setCurrentLon(target.lng);

          if (passengerPatienceTimersRef.current[target.id]) {
            clearTimeout(passengerPatienceTimersRef.current[target.id]);
            delete passengerPatienceTimersRef.current[target.id];
          }

          const remaining = passengersRef.current.filter(
            (p) => p.id !== target.id
          );
          const nearest = findNearestPassenger(
            target.lat,
            target.lng,
            remaining
          );
          setPassengers(remaining);
          selectedPassengerRef.current = nearest;
          setSelectedPassenger(nearest);

          // 清除主司机匹配关系（颜色从绿变蓝）
          setMatches((prev) => {
            const newM = { ...prev };
            delete newM[`d_${driverId}`];
            return newM;
          });

          // 清除导航路线
          driverNavRouteRef.current = null;
          driverNavRouteIdxRef.current = 0;

          if (nearest) {
            message.success(
              `Picked up ${target.id}! Driving to next passenger ${nearest.id}`
            );
          } else {
            message.success(
              `Picked up ${target.id}! No more passengers nearby, cruising randomly.`
            );
            driverRouteRef.current = null;
            driverRouteIdxRef.current = 0;
            setDriverRoute(null);
            setDriverRouteIdx(0);
          }
          return;
        }

        // 未到达：优先沿 OSRM 导航路线行驶
        const navRoute = driverNavRouteRef.current;
        const navIdx = driverNavRouteIdxRef.current;

        if (navRoute && navIdx < navRoute.length) {
          // 沿导航路线前进一步
          const [nextLat, nextLon] = navRoute[navIdx];
          driverNavRouteIdxRef.current = navIdx + 1;
          posRef.current = { lat: nextLat, lon: nextLon };
          setCurrentLat(nextLat);
          setCurrentLon(nextLon);
          setDriverPath((prev) => [...prev, [nextLon, nextLat]]);
        } else {
          // 路线未就绪或已走完，直线 fallback
          const stepMeters = SIM_SPEED_MPS * (SIM_INTERVAL_MS / 1000);
          const result = moveTowards(
            curLat,
            curLon,
            target.lat,
            target.lng,
            stepMeters
          );
          posRef.current = { lat: result.lat, lon: result.lon };
          setCurrentLat(result.lat);
          setCurrentLon(result.lon);
          setDriverPath((prev) => [...prev, [result.lon, result.lat]]);
        }

        try {
          await driversAPI.updateLocation({
            driverId: parseInt(driverId),
            latitude: posRef.current.lat,
            longitude: posRef.current.lon,
          });
        } catch (e) {
          console.warn("Failed to update location:", e);
        }
      } else {
        // 无目标乘客，OSRM 随机游走
        const route = driverRouteRef.current;
        const routeIdx = driverRouteIdxRef.current;

        if (!route || routeIdx >= route.length) {
          const { lat: curLat2, lon: curLon2 } = posRef.current;
          const [destLat, destLon] = pickRandomDestinationNear(
            curLat2,
            curLon2,
            0.04
          );
          const newRoute = await getRoute(curLat2, curLon2, destLat, destLon);
          if (newRoute && newRoute.length > 1) {
            driverRouteRef.current = newRoute;
            driverRouteIdxRef.current = 0;
            setDriverRoute(newRoute);
            setDriverRouteIdx(0);
          } else {
            const stepMeters = SIM_SPEED_MPS * (SIM_INTERVAL_MS / 1000);
            const result = moveTowards(
              curLat2,
              curLon2,
              destLat,
              destLon,
              stepMeters
            );
            posRef.current = { lat: result.lat, lon: result.lon };
            setCurrentLat(result.lat);
            setCurrentLon(result.lon);
            setDriverPath((prev) => [...prev, [result.lon, result.lat]]);
          }
          return;
        }

        const [lat, lon] = route[routeIdx];
        driverRouteIdxRef.current = routeIdx + 1;
        posRef.current = { lat, lon };
        setCurrentLat(lat);
        setCurrentLon(lon);
        setDriverPath((prev) => [...prev, [lon, lat]]);
        setDriverRouteIdx(routeIdx + 1);

        const currentPassengers = passengersRef.current;
        if (currentPassengers.length > 0) {
          const nearest = findNearestPassenger(lat, lon, currentPassengers);
          if (nearest) {
            selectedPassengerRef.current = nearest;
            setSelectedPassenger(nearest);
          }
        }

        try {
          await driversAPI.updateLocation({
            driverId: parseInt(driverId),
            latitude: lat,
            longitude: lon,
          });
        } catch (e) {
          console.warn("Failed to update location:", e);
        }
      }
    };

    moveDriver();
    simulationTimerRef.current = setInterval(moveDriver, SIM_INTERVAL_MS);
    return () => {
      if (simulationTimerRef.current) {
        clearInterval(simulationTimerRef.current);
        simulationTimerRef.current = null;
      }
    };
  }, [isSimulating]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 竞争司机移动逻辑 ──────────────────────────────────────────────────
  // 关键修复：从 rivalDriversRef.current 同步计算新状态，
  // 再统一调用 setRivalDrivers / setPassengers / setMatches，
  // 避免在 setState 回调内 push 导致外部数组为空的 race condition。
  useEffect(() => {
    if (!showRivalDrivers) return;

    const moveAllRivals = async () => {
      const currentRivals = rivalDriversRef.current;
      const currentMatches = matchesRef.current;

      const toRemovePassengerIds = [];
      const toRemoveDriverIds = [];
      const routeRequests = [];

      // 同步计算每个竞争司机的新位置
      const updatedRivals = currentRivals.map((d) => {
        const matchedPassengerId = currentMatches[d.id];
        if (matchedPassengerId) {
          const passenger = passengersRef.current.find(
            (p) => p.id === matchedPassengerId
          );
          if (passenger) {
            const dist = calculateDistance(
              d.lat,
              d.lon,
              passenger.lat,
              passenger.lng
            );
            if (dist <= ARRIVAL_THRESHOLD_M) {
              // 到达！乘客消失，竞争司机标记为 occupied（紫色）继续游走
              toRemovePassengerIds.push(matchedPassengerId);
              toRemoveDriverIds.push(d.id);
              return {
                ...d,
                lat: passenger.lat,
                lon: passenger.lon,
                occupied: true,
                route: null,
                routeIdx: 0,
              };
            }
            // 向乘客直线移动
            const stepMeters = SIM_SPEED_MPS * (SIM_INTERVAL_MS / 1000);
            const result = moveTowards(
              d.lat,
              d.lon,
              passenger.lat,
              passenger.lng,
              stepMeters
            );
            return { ...d, lat: result.lat, lon: result.lon };
          }
        }

        // 无匹配或乘客消失：随机游走
        if (!d.route || d.routeIdx >= d.route.length) {
          routeRequests.push(d);
          return d;
        }
        const [lat, lon] = d.route[d.routeIdx];
        return { ...d, lat, lon, routeIdx: d.routeIdx + 1 };
      });

      // 先批量更新状态（同步部分已全部计算完毕）
      setRivalDrivers(updatedRivals);

      if (toRemovePassengerIds.length > 0) {
        setPassengers((prevP) =>
          prevP.filter((p) => !toRemovePassengerIds.includes(p.id))
        );
        toRemovePassengerIds.forEach((pid) => {
          if (passengerPatienceTimersRef.current[pid]) {
            clearTimeout(passengerPatienceTimersRef.current[pid]);
            delete passengerPatienceTimersRef.current[pid];
          }
        });
        setMatches((prevM) => {
          const newM = { ...prevM };
          toRemoveDriverIds.forEach((did) => delete newM[did]);
          return newM;
        });
      }

      // 为需要新路线的竞争司机异步规划路线
      for (const d of routeRequests) {
        const [destLat, destLon] = pickRandomDestinationNear(
          d.lat,
          d.lon,
          0.04
        );
        const route = await getRoute(d.lat, d.lon, destLat, destLon);
        if (route && route.length > 1) {
          setRivalDrivers((prev) =>
            prev.map((rd) =>
              rd.id === d.id ? { ...rd, route, routeIdx: 0 } : rd
            )
          );
        }
      }
    };

    const timer = setInterval(moveAllRivals, SIM_INTERVAL_MS);
    rivalTimersRef.current = [timer];
    return () => {
      rivalTimersRef.current.forEach((t) => clearInterval(t));
      rivalTimersRef.current = [];
    };
  }, [showRivalDrivers]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 图标选择函数 ──────────────────────────────────────────────────────
  const getDriverIconUrl = (matched) =>
    matched ? ICON_DRIVER_MATCHED : ICON_DRIVER_IDLE;
  const getPassengerIconUrl = (matched) =>
    matched ? ICON_PASSENGER_MATCHED : ICON_PASSENGER_UNMATCHED;
  const getRivalIconUrl = (matched, occupied) => {
    if (occupied) return ICON_RIVAL_OCCUPIED;
    if (matched) return ICON_RIVAL_MATCHED;
    return ICON_RIVAL_IDLE;
  };

  const layers = [
    new PathLayer({
      id: "driver-path",
      data: [{ path: driverPath }],
      getPath: (d) => d.path,
      getColor: [64, 158, 255],
      getWidth: 4,
      widthMinPixels: 2,
    }),
    new IconLayer({
      id: "main-driver",
      data: [
        {
          position: [currentLon, currentLat],
          matched: matches[`d_${driverId}`] !== undefined,
        },
      ],
      getPosition: (d) => d.position,
      getIcon: (d) => ({
        url: getDriverIconUrl(d.matched),
        width: 48,
        height: 48,
      }),
      getSize: 48,
      sizeScale: 1,
      pickable: true,
    }),
    new IconLayer({
      id: "passengers",
      data: passengers.map((p) => ({
        position: [p.lng, p.lat],
        matched: Object.values(matches).includes(p.id),
        id: p.id,
      })),
      getPosition: (d) => d.position,
      getIcon: (d) => ({
        url: getPassengerIconUrl(d.matched),
        width: 40,
        height: 40,
      }),
      getSize: 40,
      sizeScale: 1,
      pickable: true,
      onClick: (info) => {
        const passenger = passengers.find((p) => p.id === info.object.id);
        if (passenger) {
          setSelectedPassenger(passenger);
          selectedPassengerRef.current = passenger;
          message.info(`Selected passenger: ${passenger.id}`);
        }
      },
    }),
    showRivalDrivers &&
      new IconLayer({
        id: "rival-drivers",
        data: rivalDrivers.map((d) => ({
          position: [d.lon, d.lat],
          matched: matches[d.id] !== undefined,
          occupied: d.occupied === true,
        })),
        getPosition: (d) => d.position,
        getIcon: (d) => ({
          url: getRivalIconUrl(d.matched, d.occupied),
          width: 48,
          height: 48,
        }),
        getSize: 36,
        sizeScale: 1,
        pickable: true,
      }),
    new LineLayer({
      id: "match-lines",
      data: Object.entries(matches)
        .map(([matchedDriverId, passengerId]) => {
          let driverPos, passengerPos;
          if (matchedDriverId === `d_${driverId}`) {
            driverPos = [currentLon, currentLat];
          } else {
            const rival = rivalDrivers.find((d) => d.id === matchedDriverId);
            if (rival) driverPos = [rival.lon, rival.lat];
          }
          const passenger = passengers.find((p) => p.id === passengerId);
          if (passenger) passengerPos = [passenger.lng, passenger.lat];
          return driverPos && passengerPos
            ? { source: driverPos, target: passengerPos }
            : null;
        })
        .filter(Boolean),
      getSourcePosition: (d) => d.source,
      getTargetPosition: (d) => d.target,
      getColor: [82, 196, 26],
      getWidth: 3,
      widthMinPixels: 2,
    }),
  ].filter(Boolean);

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <DeckGL
        initialViewState={viewState}
        controller={true}
        layers={layers}
        onViewStateChange={({ viewState }) => setViewState(viewState)}
      >
        <Map
          mapboxAccessToken={MAPBOX_TOKEN}
          mapStyle="mapbox://styles/mapbox/streets-v12"
        />
      </DeckGL>
      <ControlPanel
        driverId={driverId}
        isOnline={isOnline}
        currentLat={currentLat}
        currentLon={currentLon}
        passengers={passengers}
        selectedPassenger={selectedPassenger}
        isSimulating={isSimulating}
        showRivalDrivers={showRivalDrivers}
        onToggleOnline={toggleOnline}
        onStartSimulation={startSimulation}
        onStopSimulation={stopSimulation}
        onResetSimulation={resetSimulation}
        onRequestPassengers={requestPassengers}
        onToggleRivalDrivers={() => setShowRivalDrivers(!showRivalDrivers)}
        onCenterMap={() =>
          setViewState({
            ...viewState,
            longitude: currentLon,
            latitude: currentLat,
          })
        }
      />
      <Legend />
    </div>
  );
}

export default App;
