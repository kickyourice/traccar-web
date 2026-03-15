import maplibregl from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { map } from './core/MapView';
import { useTheme } from '@mui/material';
import { wgs84ToGcj02 } from '../common/util/converter';

// 全局变量，强制单例
let activeWatchId = null;
let lastWatchRequestTime = 0;

const MapCurrentLocation = () => {
  const theme = useTheme();
  const isUnmounted = useRef(false);

  useEffect(() => {
    isUnmounted.current = false;

    // --- 重点 1：注入全局样式，物理压制多余蓝点 ---
    const styleId = 'force-single-dot-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      // 如果有多个蓝点 DOM，只显示最后一个，隐藏其他的
      style.innerHTML = `
        .maplibregl-user-location-dot { display: none !important; }
        .maplibregl-user-location-dot:last-of-type { display: block !important; }
      `;
      document.head.appendChild(style);
    }

    const proto = Geolocation.prototype;
    const nativeGetCurrentPosition = proto.getCurrentPosition;
    const nativeWatchPosition = proto.watchPosition;
    const nativeClearWatch = proto.clearWatch;

    const fastOptions = { 
      enableHighAccuracy: true, 
      maximumAge: 0, 
      timeout: 3000 
    };

    const positionWrapper = (success) => (pos) => {
      if (isUnmounted.current) return;
      const [lon, lat] = wgs84ToGcj02(pos.coords.longitude, pos.coords.latitude);
      const mockedPos = {
        ...pos,
        coords: { ...pos.coords, longitude: lon, latitude: lat },
        timestamp: pos.timestamp || Date.now(),
      };
      success(mockedPos);
    };

    // --- 重点 2：原子化 watchPosition ---
    proto.watchPosition = function (s, e, o) {
      const now = Date.now();
      // 这里的间隔拉长到 1 秒，彻底封死瞬间连发
      if (now - lastWatchRequestTime < 1000) {
        return activeWatchId; 
      }
      lastWatchRequestTime = now;

      if (activeWatchId !== null) {
        try {
          nativeClearWatch.call(this, activeWatchId);
        } catch (err) {}
      }
      
      const id = nativeWatchPosition.call(this, positionWrapper(s), e, { ...o, ...fastOptions });
      activeWatchId = id;
      return id;
    };

    proto.getCurrentPosition = function (s, e, o) {
      return nativeGetCurrentPosition.call(this, positionWrapper(s), e, { ...o, ...fastOptions });
    };

    const control = new maplibregl.GeolocateControl({
      positionOptions: fastOptions,
      trackUserLocation: true,
      showUserLocation: true,
      showAccuracyCircle: false,
    });

    map.addControl(control, theme.direction === 'rtl' ? 'top-left' : 'top-right');

    // 视觉补丁：清理按钮
    const cleanupUI = () => {
      const buttons = document.querySelectorAll('.maplibregl-ctrl-geolocate');
      if (buttons.length > 1) {
        for (let i = 0; i < buttons.length - 1; i++) {
          buttons[i].style.display = 'none';
        }
      }
    };
    const uiTimer = setTimeout(cleanupUI, 300);

    return () => {
      isUnmounted.current = true;
      clearTimeout(uiTimer);

      proto.getCurrentPosition = nativeGetCurrentPosition;
      proto.watchPosition = nativeWatchPosition;

      try {
        map.stop();
        if (control.isTracking()) {
          control.stop();
        }
        if (activeWatchId !== null) {
          navigator.geolocation.clearWatch(activeWatchId);
          activeWatchId = null;
        }
        map.removeControl(control);
      } catch (err) {}
    };
  }, [theme.direction]);

  return null;
};

export default MapCurrentLocation;