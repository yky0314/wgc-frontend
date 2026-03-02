import api from "./api";

// 更新司机位置
export const updateLocation = (payload) => {
  return api.post(`/api/v1/drivers/location/update`, payload);
};

// 更新司机状态（上线/下线）
export const updateStatus = (driver) => {
  return api.post(`/api/v1/drivers/update`, driver);
};

// 请求乘客（获取5个随机乘客坐标）- 增加超时时间
export const requestPassenger = (payload) => {
  return api.post("/api/v1/drivers/requestPassenger", payload, {
    timeout: 30000, // 30秒
  });
};

// 获取竞争司机列表（获取3个竞争司机）- 增加超时时间
export const getRivalDrivers = (payload) => {
  return api.post("/api/v1/drivers/requestRivalDrivers", payload, {
    timeout: 30000, // 30秒
  });
};

// 司机乘客匹配算法 - 增加超时时间
export const matchDriversPassengers = (payload) => {
  return api.post("/api/match/match", payload, {
    timeout: 30000, // 30秒
  });
};

export default {
  updateLocation,
  updateStatus,
  requestPassenger,
  getRivalDrivers,
  matchDriversPassengers,
};
