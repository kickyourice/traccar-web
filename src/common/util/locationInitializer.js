import { wgs84ToGcj02 } from './converter'; // 使用你已有的纠偏工具

export const initGlobalLocationProxy = () => {
  // 避免重复初始化
  if (window.isLocationProxyInitialized) return;

  const proto = Geolocation.prototype;
  const nativeGetCurrentPosition = proto.getCurrentPosition;
  const nativeWatchPosition = proto.watchPosition;

  // 统一的纠偏包装逻辑
  const wrapSuccessCallback = (success) => (pos) => {
    const { longitude, latitude } = pos.coords;
    
    // 调用你引入的转换工具
    const [lng, lat] = wgs84ToGcj02(longitude, latitude);
    
    // 构造符合原生格式的伪造定位对象
    const mockedPos = {
      ...pos,
      coords: {
        ...pos.coords,
        longitude: lng,
        latitude: lat,
        // 精度保持不变
        accuracy: pos.coords.accuracy,
      },
      timestamp: pos.timestamp || Date.now(),
    };
    
    success(mockedPos);
  };

  // 永久改写原型方法，不再在组件卸载时还原
  proto.getCurrentPosition = function (s, e, o) {
    nativeGetCurrentPosition.call(this, wrapSuccessCallback(s), e, o);
  };

  proto.watchPosition = function (s, e, o) {
    return nativeWatchPosition.call(this, wrapSuccessCallback(s), e, o);
  };

  window.isLocationProxyInitialized = true;
  console.log('>>> 全局 GPS 纠偏拦截器已就绪 (WGS-84 -> GCJ-02)');
};