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
// Raffles Place 附近，新加坡市中心道路密集区域
const DEFAULT_LAT = 1.2847;
const DEFAULT_LON = 103.8522;

const INITIAL_VIEW_STATE = {
  longitude: DEFAULT_LON,
  latitude: DEFAULT_LAT,
  zoom: 14,
  pitch: 0,
  bearing: 0,
};

// 配置常量
const SIM_INTERVAL_MS = 600;
const SIM_SPEED_MPS = 6;
const ARRIVAL_THRESHOLD_M = 30;
const MATCH_INTERVAL = 10000; // 10秒

// 乘客生成间隔（ms），模拟泊松到达
const PASSENGER_SPAWN_MIN = 5000;
const PASSENGER_SPAWN_MAX = 15000;
// 乘客忍耐时间（ms），论文中指数分布，均值约10s，这里用15~35s可视化效果更好
const PASSENGER_PATIENCE_MIN = 15000;
const PASSENGER_PATIENCE_MAX = 35000;
// 竞争司机生成间隔（ms）
const RIVAL_SPAWN_MIN = 15000;
const RIVAL_SPAWN_MAX = 30000;
// 每次生成的乘客/司机数量范围
const PASSENGER_SPAWN_COUNT = 2; // 每次生成的乘客数
const RIVAL_SPAWN_RADIUS_DEG = 0.06; // 生成范围（度）
const PASSENGER_SPAWN_RADIUS_DEG = 0.05;

// 模块级辅助函数
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

  // 司机状态
  const [driverId] = useState("10001");
  const [isOnline, setIsOnline] = useState(false);
  const [currentLat, setCurrentLat] = useState(INITIAL_VIEW_STATE.latitude);
  const [currentLon, setCurrentLon] = useState(INITIAL_VIEW_STATE.longitude);
  const [driverPath, setDriverPath] = useState([
    [INITIAL_VIEW_STATE.longitude, INITIAL_VIEW_STATE.latitude],
  ]);
  const [driverRoute, setDriverRoute] = useState(null);
  const [driverRouteIdx, setDriverRouteIdx] = useState(0);

  // 乘客状态
  const [passengers, setPassengers] = useState([]);
  const [selectedPassenger, setSelectedPassenger] = useState(null);

  // 竞争司机状态
  const [rivalDrivers, setRivalDrivers] = useState([]);
  const [showRivalDrivers, setShowRivalDrivers] = useState(true);

  // 匹配状态
  const [matches, setMatches] = useState({});

  // 模拟状态
  const [isSimulating, setIsSimulating] = useState(false);
  const simulationTimerRef = useRef(null);
  const matchTimerRef = useRef(null);
  const rivalTimersRef = useRef([]);

  // 生成定时器
  const passengerSpawnTimerRef = useRef(null);
  const rivalSpawnTimerRef = useRef(null);

  // 乘客忍耐计时器 Map: { [passengerId]: timeoutId }
  const passengerPatienceTimersRef = useRef({});

  // 乘客 ID 计数器（用于生成唯一 ID）
  const passengerIdCounterRef = useRef(1000);
  // 竞争司机 ID 计数器
  const rivalIdCounterRef = useRef(9000);

  // 用 ref 存储实时可变数据，避免 useEffect 闭包捕获陈旧值
  const posRef = useRef({
    lat: INITIAL_VIEW_STATE.latitude,
    lon: INITIAL_VIEW_STATE.longitude,
  });
  const driverRouteRef = useRef(null);
  const driverRouteIdxRef = useRef(0);
  const selectedPassengerRef = useRef(null);
  const isSimulatingRef = useRef(false);
  const passengersRef = useRef([]); // 乘客列表最新快照
  const rivalDriversRef = useRef([]); // 竞争司机列表最新快照
  const matchesRef = useRef({}); // 匹配结果最新快照

  // 地图视图状态
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);

  // ── 同步 ref，让定时器回调始终能读到最新值 ──────────────────────────
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

  // ── 乘客忍耐超时：从列表中移除 ────────────────────────────────────────
  const removePassengerById = useCallback((passengerId) => {
    setPassengers((prev) => prev.filter((p) => p.id !== passengerId));
    // 如果被删的恰好是当前目标，重新选最近的
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

  // ── 生成单个乘客（先吸附到道路，再附带忍耐计时器） ─────────────────
  const spawnPassengerAt = useCallback(
    async (lat, lng) => {
      // 吸附到最近道路
      const snapped = await snapToRoad(lat, lng);
      const newId = `p_spawn_${passengerIdCounterRef.current++}`;
      const newPassenger = {
        id: newId,
        lat: snapped.lat,
        lng: snapped.lon,
        matched: false,
        spawned: true,
      };

      setPassengers((prev) => [...prev, newPassenger]);

      // 忍耐倒计时
      const patience =
        PASSENGER_PATIENCE_MIN +
        Math.random() * (PASSENGER_PATIENCE_MAX - PASSENGER_PATIENCE_MIN);
      const timeoutId = setTimeout(() => {
        removePassengerById(newId);
      }, patience);
      passengerPatienceTimersRef.current[newId] = timeoutId;
    },
    [removePassengerById]
  );

  // ── 在当前司机附近随机生成若干乘客 ───────────────────────────────────
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

  // ── 在当前司机附近随机生成一名竞争司机（吸附到道路） ────────────────
  const spawnRivalDriver = useCallback(async () => {
    const { lat, lon } = posRef.current;
    const [dLat, dLon] = pickRandomDestinationNear(
      lat,
      lon,
      RIVAL_SPAWN_RADIUS_DEG
    );
    // 吸附到最近道路
    const snapped = await snapToRoad(dLat, dLon);
    const newId = `d_rival_${rivalIdCounterRef.current++}`;
    setRivalDrivers((prev) => [
      ...prev,
      {
        id: newId,
        lat: snapped.lat,
        lon: snapped.lon,
        matched: false,
        route: null,
        routeIdx: 0,
        spawned: true,
      },
    ]);
  }, []);

  // ── 递归随机延迟：乘客生成调度 ────────────────────────────────────────
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

  // ── 递归随机延迟：竞争司机生成调度 ──────────────────────────────────
  const scheduleRivalSpawn = useCallback(() => {
    const delay =
      RIVAL_SPAWN_MIN + Math.random() * (RIVAL_SPAWN_MAX - RIVAL_SPAWN_MIN);
    rivalSpawnTimerRef.current = setTimeout(() => {
      if (!isSimulatingRef.current) return;
      spawnRivalDriver();
      scheduleRivalSpawn();
    }, delay);
  }, [spawnRivalDriver]);

  // ── 请求乘客（API） ────────────────────────────────────────────────────
  const requestPassengers = useCallback(async () => {
    try {
      const res = await driversAPI.requestPassenger({
        driverId: parseInt(driverId),
        latitude: currentLat,
        longitude: currentLon,
      });

      if (res?.data?.code === "200" && res.data.data) {
        // 清除旧的忍耐计时器
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

  // ── 请求竞争司机（API） ───────────────────────────────────────────────
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
          matched: false,
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

  // ── 匹配算法：调用后端 API（使用 ref 读取最新数据，避免 stale closure） ──
  const performMatching = useCallback(async () => {
    const currentPassengers = passengersRef.current;
    const currentRivals = rivalDriversRef.current;
    const { lat, lon } = posRef.current;

    if (currentPassengers.length === 0) return;

    try {
      const drivers = {
        [`d_${driverId}`]: [lat, lon],
      };
      currentRivals.forEach((d) => {
        drivers[d.id] = [d.lat, d.lon];
      });

      const passengersData = {};
      currentPassengers.forEach((p) => {
        passengersData[p.id] = [p.lat, p.lng];
      });

      const payload = {
        drivers,
        passengers: passengersData,
        k: 10,
      };

      const res = await driversAPI.matchDriversPassengers(payload);

      if (res?.data?.status === "success" && res.data.matches) {
        const newMatches = res.data.matches;
        setMatches((prevMatches) => {
          const prevStr = JSON.stringify(prevMatches);
          const newStr = JSON.stringify(newMatches);
          if (prevStr !== newStr) {
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
  }, [driverId]); // 只依赖 driverId（不变），其余通过 ref 读取

  // ── 上线/下线 ──────────────────────────────────────────────────────────
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
          // 上线前先将初始位置吸附到最近的道路
          const snapped = await snapToRoad(
            posRef.current.lat,
            posRef.current.lon
          );
          posRef.current = { lat: snapped.lat, lon: snapped.lon };
          setCurrentLat(snapped.lat);
          setCurrentLon(snapped.lon);
          setDriverPath([[snapped.lon, snapped.lat]]);

          await requestPassengers();
          if (showRivalDrivers) {
            await requestRivalDrivers();
          }
        } else {
          stopSimulation();
        }
      }
    } catch (error) {
      console.error("Failed to update status:", error);
      message.error("Failed to update status");
    }
  };

  // ── 停止模拟（声明提前，供 startSimulation 内部引用） ─────────────────
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

  // ── 开始模拟 ───────────────────────────────────────────────────────────
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

    // 启动持续匹配（无论初始是否有乘客，都要持续匹配新出现的）
    matchTimerRef.current = setInterval(performMatching, MATCH_INTERVAL);

    // 启动动态生成调度
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

  // ── 重置 ───────────────────────────────────────────────────────────────
  const resetSimulation = useCallback(() => {
    stopSimulation();

    // 清除所有忍耐计时器
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
    setViewState(INITIAL_VIEW_STATE);
    message.info("Reset complete");
  }, [stopSimulation]);

  // ── 主司机移动逻辑 ─────────────────────────────────────────────────────
  // 依赖数组仅含 isSimulating，避免定时器被反复销毁重建（stale closure 问题已用 ref 解决）
  useEffect(() => {
    if (!isSimulating) return;

    const moveDriver = async () => {
      const { lat: curLat, lon: curLon } = posRef.current;
      const target = selectedPassengerRef.current;

      if (target) {
        // 有选定乘客，直线趋近
        const dist = calculateDistance(curLat, curLon, target.lat, target.lng);

        if (dist <= ARRIVAL_THRESHOLD_M) {
          // ── 到达乘客位置 ──
          posRef.current = { lat: target.lat, lon: target.lng };
          setCurrentLat(target.lat);
          setCurrentLon(target.lng);

          // 清除该乘客的忍耐计时器
          if (passengerPatienceTimersRef.current[target.id]) {
            clearTimeout(passengerPatienceTimersRef.current[target.id]);
            delete passengerPatienceTimersRef.current[target.id];
          }

          // 从列表中移除该乘客，自动选最近的下一个
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

          if (nearest) {
            message.success(
              `Picked up ${target.id}! Driving to next passenger ${nearest.id}`
            );
          } else {
            message.success(
              `Picked up ${target.id}! No more passengers nearby, cruising randomly.`
            );
            // 清空路线，触发随机游走
            driverRouteRef.current = null;
            driverRouteIdxRef.current = 0;
            setDriverRoute(null);
            setDriverRouteIdx(0);
          }
          return;
        }

        // 向乘客移动一步
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

        try {
          await driversAPI.updateLocation({
            driverId: parseInt(driverId),
            latitude: result.lat,
            longitude: result.lon,
          });
        } catch (error) {
          console.warn("Failed to update location:", error);
        }
      } else {
        // 无选定乘客，沿 OSRM 路线随机游走
        const route = driverRouteRef.current;
        const routeIdx = driverRouteIdxRef.current;

        if (!route || routeIdx >= route.length) {
          // 规划新路线
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
          }
          return;
        }

        // 沿路线移动到下一个点
        const [lat, lon] = route[routeIdx];
        driverRouteIdxRef.current = routeIdx + 1;
        posRef.current = { lat, lon };
        setCurrentLat(lat);
        setCurrentLon(lon);
        setDriverPath((prev) => [...prev, [lon, lat]]);
        setDriverRouteIdx(routeIdx + 1);

        // 随机游走时检查是否有新出现的最近乘客，若有则自动选择
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
        } catch (error) {
          console.warn("Failed to update location:", error);
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

  // ── 竞争司机移动逻辑（单一定时器，用 ref 读取最新数据） ──────────────
  useEffect(() => {
    if (!showRivalDrivers) return;

    const moveAllRivals = async () => {
      const currentMatches = matchesRef.current;
      const toRemoveDriverIds = [];
      const toRemovePassengerIds = [];
      const routeRequests = [];

      setRivalDrivers((prev) => {
        return prev
          .map((d) => {
            // 检查该司机是否被匹配到乘客
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
                  // 到达！标记双方待移除
                  toRemoveDriverIds.push(d.id);
                  toRemovePassengerIds.push(matchedPassengerId);
                  return null; // 标记为移除
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

            // 无匹配或乘客已消失，随机游走
            if (!d.route || d.routeIdx >= d.route.length) {
              routeRequests.push(d);
              return d;
            }
            const [lat, lon] = d.route[d.routeIdx];
            return { ...d, lat, lon, routeIdx: d.routeIdx + 1 };
          })
          .filter(Boolean); // 移除标记为 null 的司机
      });

      // 移除到达的乘客
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
        // 清除匹配关系
        setMatches((prevM) => {
          const newM = { ...prevM };
          toRemoveDriverIds.forEach((did) => delete newM[did]);
          return newM;
        });
      }

      // 为需要新路线的司机规划路线
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

    const timer = setInterval(moveAllRivals, 600);
    rivalTimersRef.current = [timer];

    return () => {
      rivalTimersRef.current.forEach((t) => clearInterval(t));
      rivalTimersRef.current = [];
    };
  }, [showRivalDrivers]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 图层图标 SVG ───────────────────────────────────────────────────────
  const getDriverIcon = (matched) => ({
    url: matched
      ? "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIHZpZXdCb3g9IjAgMCA0OCA0OCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIyNCIgY3k9IjI0IiByPSIyMCIgZmlsbD0iIzUyYzQxYSIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjMiLz48cGF0aCBkPSJNMjQgMTIgTDI4IDE4IEwyMCAxOCBaIE0yMiAyMCBMMjYgMjAgTDI2IDI2IEwyMiAyNiBaIiBmaWxsPSIjZmZmIi8+PC9zdmc+"
      : "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIHZpZXdCb3g9IjAgMCA0OCA0OCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIyNCIgY3k9IjI0IiByPSIyMCIgZmlsbD0iIzE4OTBmZiIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjMiLz48cGF0aCBkPSJNMjQgMTIgTDI4IDE4IEwyMCAxOCBaIE0yMiAyMCBMMjYgMjAgTDI2IDI2IEwyMiAyNiBaIiBmaWxsPSIjZmZmIi8+PC9zdmc+",
    width: 48,
    height: 48,
  });

  const getPassengerIcon = (matched) => ({
    url: matched
      ? "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIyMCIgY3k9IjIwIiByPSIxOCIgZmlsbD0iIzUyYzQxYSIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjIiLz48Y2lyY2xlIGN4PSIyMCIgY3k9IjE1IiByPSI1IiBmaWxsPSIjZmZmIi8+PHBhdGggZD0iTTEyIDI4IFExMiAyMCAyMCAyMCBRMjggMjAgMjggMjgiIGZpbGw9IiNmZmYiLz48L3N2Zz4="
      : "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIyMCIgY3k9IjIwIiByPSIxOCIgZmlsbD0iIzUyYzQxYSIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjIiLz48Y2lyY2xlIGN4PSIyMCIgY3k9IjE1IiByPSI1IiBmaWxsPSIjZmZmIi8+PHBhdGggZD0iTTEyIDI4IFExMiAyMCAyMCAyMCBRMjggMjAgMjggMjgiIGZpbGw9IiNmZmYiLz48L3N2Zz4=",
    width: 40,
    height: 40,
  });

  const getRivalIcon = (matched) => ({
    url: matched
      ? "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIHZpZXdCb3g9IjAgMCA0OCA0OCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIyNCIgY3k9IjI0IiByPSIyMCIgZmlsbD0iIzUyYzQxYSIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjMiLz48cGF0aCBkPSJNMjQgMTIgTDI4IDE4IEwyMCAxOCBaIE0yMiAyMCBMMjYgMjAgTDI2IDI2IEwyMiAyNiBaIiBmaWxsPSIjZmZmIi8+PC9zdmc+"
      : "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIHZpZXdCb3g9IjAgMCA0OCA0OCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIyNCIgY3k9IjI0IiByPSIyMCIgZmlsbD0iI2ZmNGQ0ZiIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjMiLz48cGF0aCBkPSJNMjQgMTIgTDI4IDE4IEwyMCAxOCBaIE0yMiAyMCBMMjYgMjAgTDI2IDI2IEwyMiAyNiBaIiBmaWxsPSIjZmZmIi8+PC9zdmc+",
    width: 48,
    height: 48,
  });

  const layers = [
    // 司机轨迹
    new PathLayer({
      id: "driver-path",
      data: [{ path: driverPath }],
      getPath: (d) => d.path,
      getColor: [64, 158, 255],
      getWidth: 4,
      widthMinPixels: 2,
    }),
    // 主司机
    new IconLayer({
      id: "main-driver",
      data: [
        {
          position: [currentLon, currentLat],
          matched: matches[`d_${driverId}`] !== undefined,
        },
      ],
      getPosition: (d) => d.position,
      getIcon: (d) => getDriverIcon(d.matched),
      getSize: 48,
      sizeScale: 1,
      pickable: true,
    }),
    // 乘客
    new IconLayer({
      id: "passengers",
      data: passengers.map((p) => ({
        position: [p.lng, p.lat],
        matched: Object.values(matches).includes(p.id),
        id: p.id,
      })),
      getPosition: (d) => d.position,
      getIcon: (d) => getPassengerIcon(d.matched),
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
    // 竞争司机
    showRivalDrivers &&
      new IconLayer({
        id: "rival-drivers",
        data: rivalDrivers.map((d) => ({
          position: [d.lon, d.lat],
          matched: matches[d.id] !== undefined,
        })),
        getPosition: (d) => d.position,
        getIcon: (d) => getRivalIcon(d.matched),
        getSize: 36,
        sizeScale: 1,
        pickable: true,
      }),
    // 匹配连线
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
