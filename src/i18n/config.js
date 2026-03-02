import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const resources = {
  en: {
    translation: {
      title: "Driver Simulator",
      online: "Online",
      offline: "Offline",
      driverId: "Driver ID",
      currentLocation: "Current Location",
      passengerLocation: "Passenger Location",
      distance: "Distance",
      addPassenger: "Add Passenger",
      removePassenger: "Remove",
      centerPassenger: "Center",
      language: "Language",
      goOnline: "Go Online",
      goOffline: "Go Offline",
      start: "Start",
      stop: "Stop",
      reset: "Reset",
      center: "Center",
      otherDriversVisible: "Other Drivers",
      show: "Show",
      hide: "Hide",
      followRoads: "Follow Roads",
      matchingStatus: "Matching Status",
      matched: "Matched",
      unmatched: "Unmatched",
      rivalDrivers: "Rival Drivers",
      passengers: "Passengers",
    },
  },
  zh: {
    translation: {
      title: "司机模拟器",
      online: "在线",
      offline: "离线",
      driverId: "司机ID",
      currentLocation: "当前位置",
      passengerLocation: "乘客位置",
      distance: "距离",
      addPassenger: "添加乘客",
      removePassenger: "移除",
      centerPassenger: "居中",
      language: "语言",
      goOnline: "上线",
      goOffline: "下线",
      start: "开始",
      stop: "停止",
      reset: "重置",
      center: "居中",
      otherDriversVisible: "竞争司机",
      show: "显示",
      hide: "隐藏",
      followRoads: "路网驱动",
      matchingStatus: "匹配状态",
      matched: "已匹配",
      unmatched: "未匹配",
      rivalDrivers: "竞争司机",
      passengers: "乘客",
    },
  },
};

i18n.use(initReactI18next).init({
  resources,
  lng: localStorage.getItem("locale") || "zh",
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
