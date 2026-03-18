import React, { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { message } from "antd";
import DeckGL from "@deck.gl/react";
import { Map } from "react-map-gl";
import {
  IconLayer,
  PathLayer,
  LineLayer,
  ScatterplotLayer,
} from "@deck.gl/layers";
import ControlPanel from "./components/ControlPanel";
import AnalyticsDashboard from "./components/AnalyticsDashboard";
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

// 粗略的新加坡陆地锚点，用于防止背景车落在海上
const SG_LAND_ANCHORS = [
  { lat: 1.2847, lon: 103.8522 }, // CBD
  { lat: 1.3005, lon: 103.8443 }, // Orchard
  { lat: 1.314, lon: 103.8933 }, // Geylang
  { lat: 1.2989, lon: 103.7876 }, // Buona Vista
  { lat: 1.3329, lon: 103.7436 }, // Jurong East
  { lat: 1.3521, lon: 103.9448 }, // Tampines
  { lat: 1.3703, lon: 103.8497 }, // Ang Mo Kio
  { lat: 1.4361, lon: 103.7865 }, // Woodlands
];

const INITIAL_VIEW_STATE = {
  longitude: DEFAULT_LON,
  latitude: DEFAULT_LAT,
  zoom: 14,
  pitch: 0,
  bearing: 0,
};

const SIM_INTERVAL_MS = 600;
const SIM_SPEED_MPS = 18;
const ARRIVAL_THRESHOLD_M = 30;
const MATCH_INTERVAL = 10000;

const PASSENGER_SPAWN_MIN = 2000;
const PASSENGER_SPAWN_MAX = 5000;
const PASSENGER_PATIENCE_MIN = 60000;
const PASSENGER_PATIENCE_MAX = 120000;
const RIVAL_SPAWN_MIN = 5000;
const RIVAL_SPAWN_MAX = 10000;
const PASSENGER_SPAWN_COUNT = 10;
const RIVAL_SPAWN_RADIUS_DEG = 0.06;
const PASSENGER_SPAWN_RADIUS_DEG = 0.05;
const DROPOFF_RADIUS_DEG = 0.04;

// ── SVG 图标 ──────────────────────────────────────────────────────────
const svgToDataUrl = (svgStr) => `data:image/svg+xml;base64,${btoa(svgStr)}`;

// 主司机：蓝（空闲）/ 绿（前往接客）/ 紫（载客送达中）
const ICON_DRIVER_IDLE = svgToDataUrl(
  '<svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="20" fill="#1890ff" stroke="#fff" stroke-width="3"/><path d="M24 12 L28 18 L20 18 Z M22 20 L26 20 L26 26 L22 26 Z" fill="#fff"/></svg>'
);
const ICON_DRIVER_MATCHED = svgToDataUrl(
  '<svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="20" fill="#52c41a" stroke="#fff" stroke-width="3"/><path d="M24 12 L28 18 L20 18 Z M22 20 L26 20 L26 26 L22 26 Z" fill="#fff"/></svg>'
);
const ICON_DRIVER_OCCUPIED = svgToDataUrl(
  '<svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="20" fill="#722ed1" stroke="#fff" stroke-width="3"/><path d="M24 12 L28 18 L20 18 Z M22 20 L26 20 L26 26 L22 26 Z" fill="#fff"/></svg>'
);

// 竞争司机：红（空闲）/ 绿（前往接客）/ 紫（载客送达中）
const ICON_RIVAL_IDLE = svgToDataUrl(
  '<svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="20" fill="#ff4d4f" stroke="#fff" stroke-width="3"/><path d="M24 12 L28 18 L20 18 Z M22 20 L26 20 L26 26 L22 26 Z" fill="#fff"/></svg>'
);
const ICON_RIVAL_MATCHED = svgToDataUrl(
  '<svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="20" fill="#52c41a" stroke="#fff" stroke-width="3"/><path d="M24 12 L28 18 L20 18 Z M22 20 L26 20 L26 26 L22 26 Z" fill="#fff"/></svg>'
);
const ICON_RIVAL_OCCUPIED = svgToDataUrl(
  '<svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="20" fill="#722ed1" stroke="#fff" stroke-width="3"/><path d="M24 12 L28 18 L20 18 Z M22 20 L26 20 L26 26 L22 26 Z" fill="#fff"/></svg>'
);

// 乘客：仅橙色一种状态，接到后消失
const ICON_PASSENGER = svgToDataUrl(
  '<svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><circle cx="20" cy="20" r="18" fill="#fa8c16" stroke="#fff" stroke-width="2"/><circle cx="20" cy="15" r="5" fill="#fff"/><path d="M12 28 Q12 20 20 20 Q28 20 28 28" fill="#fff"/></svg>'
);

const getDriverIconUrl = (status) => {
  if (status === "matched") return ICON_DRIVER_MATCHED;
  if (status === "occupied") return ICON_DRIVER_OCCUPIED;
  return ICON_DRIVER_IDLE;
};
const getRivalIconUrl = (status) => {
  if (status === "matched") return ICON_RIVAL_MATCHED;
  if (status === "occupied") return ICON_RIVAL_OCCUPIED;
  return ICON_RIVAL_IDLE;
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

  // 主司机状态机：idle → matched → occupied → idle
  const [driverStatus, setDriverStatus] = useState("idle");
  const driverStatusRef = useRef("idle");

  // 空闲时随机游走 OSRM 路线
  const driverRouteRef = useRef(null);
  const driverRouteIdxRef = useRef(0);

  // matched 时的目标乘客
  const [selectedPassenger, setSelectedPassenger] = useState(null);
  const selectedPassengerRef = useRef(null);

  // occupied 时的目的地（随机送客终点）
  const driverDropoffDestRef = useRef(null);

  const [passengers, setPassengers] = useState([]);
  const [rivalDrivers, setRivalDrivers] = useState([]);
  const [showRivalDrivers, setShowRivalDrivers] = useState(true);
  const [matches, setMatches] = useState({});
  const [isSimulating, setIsSimulating] = useState(false);
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  const [bgData, setBgData] = useState({ taxis: [], passengers: [] });

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
  const isSimulatingRef = useRef(false);
  const passengersRef = useRef([]);
  const rivalDriversRef = useRef([]);
  const matchesRef = useRef({});

  // ── ref 同步 ──────────────────────────────────────────────────────────
  useEffect(() => {
    posRef.current = { lat: currentLat, lon: currentLon };
  }, [currentLat, currentLon]);
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
  useEffect(() => {
    selectedPassengerRef.current = selectedPassenger;
  }, [selectedPassenger]);
  useEffect(() => {
    driverStatusRef.current = driverStatus;
  }, [driverStatus]);

  const handleBgDataUpdate = useCallback((data) => {
    setBgData(data);
  }, []);

  // ── 匹配结果 → 主司机状态切换 idle→matched ────────────────────────────
  useEffect(() => {
    const matchedPassengerId = matches[`d_${driverId}`];
    if (matchedPassengerId && driverStatusRef.current === "idle") {
      const matchedPassenger = passengersRef.current.find(
        (p) => p.id === matchedPassengerId
      );
      if (matchedPassenger) {
        driverStatusRef.current = "matched";
        setDriverStatus("matched");
        setSelectedPassenger(matchedPassenger);
        selectedPassengerRef.current = matchedPassenger;
        driverRouteRef.current = null;
        driverRouteIdxRef.current = 0;
      }
    }
  }, [matches]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 乘客忍耐超时移除 ──────────────────────────────────────────────────
  const removePassengerById = useCallback((passengerId) => {
    setPassengers((prev) => prev.filter((p) => p.id !== passengerId));
    // 如果是主司机正在前往的乘客，回到 idle
    if (selectedPassengerRef.current?.id === passengerId) {
      selectedPassengerRef.current = null;
      setSelectedPassenger(null);
      if (driverStatusRef.current === "matched") {
        driverStatusRef.current = "idle";
        setDriverStatus("idle");
      }
    }
    setMatches((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((k) => {
        if (next[k] === passengerId) delete next[k];
      });
      return next;
    });
    delete passengerPatienceTimersRef.current[passengerId];
  }, []);

  const spawnPassengerAt = useCallback(
    async (lat, lng) => {
      const snapped = await snapToRoad(lat, lng);
      const newId = `p_spawn_${passengerIdCounterRef.current++}`;
      setPassengers((prev) => [
        ...prev,
        { id: newId, lat: snapped.lat, lng: snapped.lon },
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
        status: "idle", // idle | matched | occupied
        dropoffDest: null, // {lat, lon} 送客目的地
        route: null, // 空闲时随机游走路线
        routeIdx: 0,
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
          status: "idle",
          dropoffDest: null,
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

  // 只对 idle 司机进行匹配
  const performMatching = useCallback(async () => {
    const currentPassengers = passengersRef.current;
    if (currentPassengers.length === 0) return;
    try {
      const drivers = {};
      // 主司机只在 idle 时参与匹配
      if (driverStatusRef.current === "idle") {
        const { lat, lon } = posRef.current;
        drivers[`d_${driverId}`] = [lat, lon];
      }
      // 竞争司机只有 idle 状态参与匹配
      rivalDriversRef.current
        .filter((d) => d.status === "idle")
        .forEach((d) => {
          drivers[d.id] = [d.lat, d.lon];
        });

      if (Object.keys(drivers).length === 0) return;

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
          // 合并：保留已有 matched/occupied 司机的旧匹配
          const merged = { ...prevMatches };
          Object.entries(newMatches).forEach(([dId, pId]) => {
            merged[dId] = pId;
          });
          if (JSON.stringify(merged) !== JSON.stringify(prevMatches)) {
            message.success(`Match: ${res.data.summary.matched_count} pairs`);
          }
          return merged;
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
        message.success(res.data.data || (newStatus ? "Online" : "Offline"));
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
    performMatching();
    matchTimerRef.current = setInterval(performMatching, MATCH_INTERVAL);
    schedulePassengerSpawn();
    scheduleRivalSpawn();
  }, [isOnline, performMatching, schedulePassengerSpawn, scheduleRivalSpawn]);

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
    setDriverStatus("idle");
    driverStatusRef.current = "idle";
    driverRouteRef.current = null;
    driverRouteIdxRef.current = 0;
    driverDropoffDestRef.current = null;
    setPassengers([]);
    setRivalDrivers([]);
    setMatches({});
    setSelectedPassenger(null);
    selectedPassengerRef.current = null;
    setViewState(INITIAL_VIEW_STATE);
    message.info("Reset complete");
  }, [stopSimulation]);

  // ── 主司机移动逻辑 ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isSimulating) return;

    const stepMeters = SIM_SPEED_MPS * (SIM_INTERVAL_MS / 1000);

    const moveDriver = async () => {
      const { lat: curLat, lon: curLon } = posRef.current;
      const status = driverStatusRef.current;

      // ── 状态：matched（前往接乘客） ──────────────────────────
      if (status === "matched") {
        const target = selectedPassengerRef.current;
        // 乘客消失（超时）→ 回 idle
        if (!target || !passengersRef.current.find((p) => p.id === target.id)) {
          driverStatusRef.current = "idle";
          setDriverStatus("idle");
          selectedPassengerRef.current = null;
          setSelectedPassenger(null);
          driverRouteRef.current = null;
          driverRouteIdxRef.current = 0;
          return;
        }

        const dist = calculateDistance(curLat, curLon, target.lat, target.lng);
        if (dist <= ARRIVAL_THRESHOLD_M) {
          // ── 接到乘客 ──
          posRef.current = { lat: target.lat, lon: target.lng };
          setCurrentLat(target.lat);
          setCurrentLon(target.lng);
          setDriverPath((prev) => [...prev, [target.lng, target.lat]]);

          // 移除乘客
          if (passengerPatienceTimersRef.current[target.id]) {
            clearTimeout(passengerPatienceTimersRef.current[target.id]);
            delete passengerPatienceTimersRef.current[target.id];
          }
          setPassengers((prev) => prev.filter((p) => p.id !== target.id));
          setMatches((prev) => {
            const next = { ...prev };
            delete next[`d_${driverId}`];
            return next;
          });

          // 选随机目的地（送客终点）
          const [dLat, dLon] = pickRandomDestinationNear(
            target.lat,
            target.lng,
            DROPOFF_RADIUS_DEG
          );
          driverDropoffDestRef.current = { lat: dLat, lon: dLon };

          // 切换到 occupied
          driverStatusRef.current = "occupied";
          setDriverStatus("occupied");
          selectedPassengerRef.current = null;
          setSelectedPassenger(null);
          driverRouteRef.current = null;
          driverRouteIdxRef.current = 0;
          message.success(`Picked up ${target.id}! Delivering passenger...`);
          return;
        }

        if (
          !driverRouteRef.current ||
          driverRouteIdxRef.current >= driverRouteRef.current.length
        ) {
          const route = await getRoute(curLat, curLon, target.lat, target.lng);
          if (route && route.length > 1) {
            driverRouteRef.current = route;
            driverRouteIdxRef.current = 0;
          } else {
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
          return;
        }

        const targetPoint = driverRouteRef.current[driverRouteIdxRef.current];
        const result = moveTowards(
          curLat,
          curLon,
          targetPoint[0],
          targetPoint[1],
          stepMeters
        );
        if (result.arrived) driverRouteIdxRef.current++;
        posRef.current = { lat: result.lat, lon: result.lon };
        setCurrentLat(result.lat);
        setCurrentLon(result.lon);
        setDriverPath((prev) => [...prev, [result.lon, result.lat]]);

        // ── 状态：occupied（送客到目的地） ──────────────────────
      } else if (status === "occupied") {
        let dest = driverDropoffDestRef.current;
        if (!dest) {
          const [dLat, dLon] = pickRandomDestinationNear(
            curLat,
            curLon,
            DROPOFF_RADIUS_DEG
          );
          dest = { lat: dLat, lon: dLon };
          driverDropoffDestRef.current = dest;
        }

        const dist = calculateDistance(curLat, curLon, dest.lat, dest.lon);
        if (dist <= ARRIVAL_THRESHOLD_M) {
          // 送达！回到 idle
          driverDropoffDestRef.current = null;
          driverStatusRef.current = "idle";
          setDriverStatus("idle");
          driverRouteRef.current = null;
          driverRouteIdxRef.current = 0;
          message.info("Passenger delivered. Driver is now idle.");
          return;
        }

        if (
          !driverRouteRef.current ||
          driverRouteIdxRef.current >= driverRouteRef.current.length
        ) {
          const route = await getRoute(curLat, curLon, dest.lat, dest.lon);
          if (route && route.length > 1) {
            driverRouteRef.current = route;
            driverRouteIdxRef.current = 0;
          } else {
            const result = moveTowards(
              curLat,
              curLon,
              dest.lat,
              dest.lon,
              stepMeters
            );
            posRef.current = { lat: result.lat, lon: result.lon };
            setCurrentLat(result.lat);
            setCurrentLon(result.lon);
            setDriverPath((prev) => [...prev, [result.lon, result.lat]]);
          }
          return;
        }

        const targetPoint = driverRouteRef.current[driverRouteIdxRef.current];
        const result = moveTowards(
          curLat,
          curLon,
          targetPoint[0],
          targetPoint[1],
          stepMeters
        );
        if (result.arrived) driverRouteIdxRef.current++;
        posRef.current = { lat: result.lat, lon: result.lon };
        setCurrentLat(result.lat);
        setCurrentLon(result.lon);
        setDriverPath((prev) => [...prev, [result.lon, result.lat]]);

        // ── 状态：idle（OSRM 随机游走） ─────────────────────────────────
      } else {
        if (
          !driverRouteRef.current ||
          driverRouteIdxRef.current >= driverRouteRef.current.length
        ) {
          const [destLat, destLon] = pickRandomDestinationNear(
            curLat,
            curLon,
            0.04
          );
          const route = await getRoute(curLat, curLon, destLat, destLon);
          if (route && route.length > 1) {
            driverRouteRef.current = route;
            driverRouteIdxRef.current = 0;
          } else {
            const result = moveTowards(
              curLat,
              curLon,
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

        const targetPoint = driverRouteRef.current[driverRouteIdxRef.current];
        const result = moveTowards(
          curLat,
          curLon,
          targetPoint[0],
          targetPoint[1],
          stepMeters
        );
        if (result.arrived) driverRouteIdxRef.current++;
        posRef.current = { lat: result.lat, lon: result.lon };
        setCurrentLat(result.lat);
        setCurrentLon(result.lon);
        setDriverPath((prev) => [...prev, [result.lon, result.lat]]);
      }

      // 上报位置
      try {
        await driversAPI.updateLocation({
          driverId: parseInt(driverId),
          latitude: posRef.current.lat,
          longitude: posRef.current.lon,
        });
      } catch (e) {
        console.warn("Failed to update location:", e);
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
  // 状态机：idle → matched → occupied → idle
  // matched/occupied 均使用直线移动；idle 使用 OSRM 随机游走
  useEffect(() => {
    if (!showRivalDrivers) return;

    const stepMeters = SIM_SPEED_MPS * (SIM_INTERVAL_MS / 1000);

    const moveAllRivals = async () => {
      const currentRivals = rivalDriversRef.current;
      const currentMatches = matchesRef.current;

      const toRemovePassengerIds = [];
      const toRemoveMatchIds = [];
      const routeRequests = [];

      const updatedRivals = currentRivals.map((d) => {
        // ── matched：前往乘客 ────────────────────────────────────
        if (d.status === "matched") {
          const matchedPid = currentMatches[d.id];
          if (!matchedPid) {
            return { ...d, status: "idle", route: null, routeIdx: 0 };
          }
          const passenger = passengersRef.current.find(
            (p) => p.id === matchedPid
          );
          if (!passenger) {
            return { ...d, status: "idle", route: null, routeIdx: 0 };
          }

          const dist = calculateDistance(
            d.lat,
            d.lon,
            passenger.lat,
            passenger.lng
          );
          if (dist <= ARRIVAL_THRESHOLD_M) {
            toRemovePassengerIds.push(matchedPid);
            toRemoveMatchIds.push(d.id);
            const [dLat, dLon] = pickRandomDestinationNear(
              d.lat,
              d.lon,
              DROPOFF_RADIUS_DEG
            );
            return {
              ...d,
              lat: passenger.lat,
              lon: passenger.lon,
              status: "occupied",
              dropoffDest: { lat: dLat, lon: dLon },
              route: null,
              routeIdx: 0,
            };
          }

          if (!d.route || d.routeIdx >= d.route.length) {
            routeRequests.push({
              driverId: d.id,
              lat: d.lat,
              lon: d.lon,
              toLat: passenger.lat,
              toLon: passenger.lng,
            });
            return d;
          }

          const targetPoint = d.route[d.routeIdx];
          const result = moveTowards(
            d.lat,
            d.lon,
            targetPoint[0],
            targetPoint[1],
            stepMeters
          );
          return {
            ...d,
            lat: result.lat,
            lon: result.lon,
            routeIdx: result.arrived ? d.routeIdx + 1 : d.routeIdx,
          };
        }

        // ── occupied：送客到目的地 ──────────────────────────────
        if (d.status === "occupied") {
          let dest = d.dropoffDest;
          if (!dest) {
            const [dLat, dLon] = pickRandomDestinationNear(
              d.lat,
              d.lon,
              DROPOFF_RADIUS_DEG
            );
            dest = { lat: dLat, lon: dLon };
          }
          const dist = calculateDistance(d.lat, d.lon, dest.lat, dest.lon);
          if (dist <= ARRIVAL_THRESHOLD_M) {
            return {
              ...d,
              status: "idle",
              dropoffDest: null,
              route: null,
              routeIdx: 0,
            };
          }

          if (!d.route || d.routeIdx >= d.route.length) {
            routeRequests.push({
              driverId: d.id,
              lat: d.lat,
              lon: d.lon,
              toLat: dest.lat,
              toLon: dest.lon,
            });
            return { ...d, dropoffDest: dest };
          }

          const targetPoint = d.route[d.routeIdx];
          const result = moveTowards(
            d.lat,
            d.lon,
            targetPoint[0],
            targetPoint[1],
            stepMeters
          );
          return {
            ...d,
            lat: result.lat,
            lon: result.lon,
            routeIdx: result.arrived ? d.routeIdx + 1 : d.routeIdx,
            dropoffDest: dest,
          };
        }

        // ── idle：检查是否新匹配；否则 OSRM 随机游走 ────────────────
        if (currentMatches[d.id]) {
          return { ...d, status: "matched", route: null, routeIdx: 0 };
        }

        if (!d.route || d.routeIdx >= d.route.length) {
          const [destLat, destLon] = pickRandomDestinationNear(
            d.lat,
            d.lon,
            0.04
          );
          routeRequests.push({
            driverId: d.id,
            lat: d.lat,
            lon: d.lon,
            toLat: destLat,
            toLon: destLon,
          });
          return d;
        }

        const targetPoint = d.route[d.routeIdx];
        const result = moveTowards(
          d.lat,
          d.lon,
          targetPoint[0],
          targetPoint[1],
          stepMeters
        );
        return {
          ...d,
          lat: result.lat,
          lon: result.lon,
          routeIdx: result.arrived ? d.routeIdx + 1 : d.routeIdx,
        };
      });

      // 批量更新状态
      setRivalDrivers(updatedRivals);

      if (toRemovePassengerIds.length > 0) {
        setPassengers((prev) =>
          prev.filter((p) => !toRemovePassengerIds.includes(p.id))
        );
        toRemovePassengerIds.forEach((pid) => {
          if (passengerPatienceTimersRef.current[pid]) {
            clearTimeout(passengerPatienceTimersRef.current[pid]);
            delete passengerPatienceTimersRef.current[pid];
          }
        });
        setMatches((prev) => {
          const next = { ...prev };
          toRemoveMatchIds.forEach((did) => delete next[did]);
          return next;
        });
      }

      // 为需要的司机异步规划路线
      for (const req of routeRequests) {
        const route = await getRoute(req.lat, req.lon, req.toLat, req.toLon);
        if (route && route.length > 1) {
          setRivalDrivers((prev) =>
            prev.map((rd) =>
              rd.id === req.driverId ? { ...rd, route, routeIdx: 0 } : rd
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

  // ── DeckGL 图层 ───────────────────────────────────────────────────────
  const layers = [
    new IconLayer({
      id: "bg-taxis-layer",
      data: bgData.taxis,
      getPosition: (d) => [d.lon, d.lat],
      getIcon: (d) => ({
        url: getRivalIconUrl(d.status),
        width: 48,
        height: 48,
      }),
      getSize: 18,
      sizeScale: 1,
      pickable: false,
      transitions: {
        getPosition: 100,
      },
    }),
    new IconLayer({
      id: "bg-passengers-layer",
      data: bgData.passengers,
      getPosition: (d) => [d.lon, d.lat],
      getIcon: () => ({
        url: ICON_PASSENGER,
        width: 40,
        height: 40,
      }),
      getSize: 12,
      sizeScale: 1,
      pickable: false,
    }),
    new PathLayer({
      id: "driver-path",
      data: [{ path: driverPath }],
      getPath: (d) => d.path,
      getColor: [64, 158, 255],
      getWidth: 4,
      widthMinPixels: 2,
    }),
    // 用三个独立 Layer 避免 DeckGL 异步加载图标导致闪烁/消失
    new IconLayer({
      id: "main-driver-idle",
      data:
        driverStatus === "idle" ? [{ position: [currentLon, currentLat] }] : [],
      getPosition: (d) => d.position,
      getIcon: () => ({ url: ICON_DRIVER_IDLE, width: 48, height: 48 }),
      getSize: 24,
      sizeScale: 1,
      pickable: false,
    }),
    new IconLayer({
      id: "main-driver-matched",
      data:
        driverStatus === "matched"
          ? [{ position: [currentLon, currentLat] }]
          : [],
      getPosition: (d) => d.position,
      getIcon: () => ({ url: ICON_DRIVER_MATCHED, width: 48, height: 48 }),
      getSize: 24,
      sizeScale: 1,
      pickable: false,
    }),
    new IconLayer({
      id: "main-driver-occupied",
      data:
        driverStatus === "occupied"
          ? [{ position: [currentLon, currentLat] }]
          : [],
      getPosition: (d) => d.position,
      getIcon: () => ({ url: ICON_DRIVER_OCCUPIED, width: 48, height: 48 }),
      getSize: 24,
      sizeScale: 1,
      pickable: false,
    }),
    new IconLayer({
      id: "passengers",
      data: passengers.map((p) => ({
        position: [p.lng, p.lat],
        id: p.id,
      })),
      getPosition: (d) => d.position,
      getIcon: () => ({
        url: ICON_PASSENGER,
        width: 40,
        height: 40,
      }),
      getSize: 16,
      sizeScale: 1,
      pickable: false,
    }),
    showRivalDrivers &&
      new IconLayer({
        id: "rival-drivers",
        data: rivalDrivers.map((d) => ({
          position: [d.lon, d.lat],
          status: d.status,
        })),
        getPosition: (d) => d.position,
        getIcon: (d) => ({
          url: getRivalIconUrl(d.status),
          width: 48,
          height: 48,
        }),
        getSize: 24,
        sizeScale: 1,
        pickable: false,
        updateTriggers: {
          getIcon: [rivalDrivers.map((d) => d.status).join(",")],
        },
      }),
    // 匹配连线：仅在司机 matched 状态时显示（乘客还在地图上）
    new LineLayer({
      id: "match-lines",
      data: Object.entries(matches)
        .map(([matchedDriverId, passengerId]) => {
          let driverPos;
          if (matchedDriverId === `d_${driverId}`) {
            if (driverStatus !== "matched") return null;
            driverPos = [currentLon, currentLat];
          } else {
            const rival = rivalDrivers.find(
              (d) => d.id === matchedDriverId && d.status === "matched"
            );
            if (rival) driverPos = [rival.lon, rival.lat];
          }
          const passenger = passengers.find((p) => p.id === passengerId);
          if (!driverPos || !passenger) return null;
          return { source: driverPos, target: [passenger.lng, passenger.lat] };
        })
        .filter(Boolean),
      getSourcePosition: (d) => d.source,
      getTargetPosition: (d) => d.target,
      getColor: [82, 196, 26],
      getWidth: 3,
      widthMinPixels: 2,
    }),
    // 背景司机的匹配连线
    new LineLayer({
      id: "bg-match-lines",
      data: (bgData.taxis || []).filter(
        (t) => t.status === "matched" && t.targetLat && t.targetLon
      ),
      getSourcePosition: (d) => [d.lon, d.lat],
      getTargetPosition: (d) => [d.targetLon, d.targetLat],
      getColor: [82, 196, 26, 150],
      getWidth: 2,
      widthMinPixels: 1.5,
    }),
  ].filter(Boolean);

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <DeckGL
        viewState={viewState}
        controller={true}
        layers={layers}
        onViewStateChange={({ viewState: vs }) => setViewState(vs)}
      >
        <Map
          mapboxAccessToken={MAPBOX_TOKEN}
          mapStyle="mapbox://styles/mapbox/dark-v11"
        />
      </DeckGL>
      <AnalyticsDashboard
        isOnline={isOnline}
        currentLat={currentLat}
        currentLon={currentLon}
        roadAnchors={SG_LAND_ANCHORS}
        onBgDataUpdate={handleBgDataUpdate}
      />
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
          setViewState((vs) => ({
            ...vs,
            longitude: currentLon,
            latitude: currentLat,
          }))
        }
      />
      <Legend />
    </div>
  );
}

export default App;
