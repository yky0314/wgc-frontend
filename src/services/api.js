import axios from "axios";

// 基于 Vite 的环境变量：VITE_API_BASE
const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || "http://localhost:8080",
  timeout: 10000,
});

// 请求拦截器：可注入 token 或其他 header
api.interceptors.request.use(
  (config) => {
    // 跳过 ngrok 的 browser warning 确认页
    config.headers["ngrok-skip-browser-warning"] = "true";
    return config;
  },
  (error) => Promise.reject(error)
);

// 响应拦截器：统一处理错误 / 返回 data
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // 可在此做全局错误上报或统一提示
    console.error("API response error", error);
    return Promise.reject(error);
  }
);

export default api;
