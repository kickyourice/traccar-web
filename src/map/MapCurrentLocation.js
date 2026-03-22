import maplibregl from 'maplibre-gl';
import { useEffect, useRef } from 'react'; // 引入 useRef
import { map } from './core/MapView';
import { useTheme } from '@mui/material';

const MapCurrentLocation = () => {
  const theme = useTheme();
  const controlRef = useRef(null); // 使用 Ref 准确持有控件引用

  useEffect(() => {
    // 1. 物理清理残留按钮：解决多次点击报表产生的 UI 堆叠
    const cleanupExisting = () => {
      const oldButtons = document.querySelectorAll('.maplibregl-ctrl-geolocate');
      oldButtons.forEach((btn) => btn.parentElement?.remove());
    };
    cleanupExisting();

    // 2. 初始化控件
    const control = new maplibregl.GeolocateControl({
      positionOptions: {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0, // 强制获取实时位置，不使用缓存，配合纠偏更准
      },
      trackUserLocation: true, // 建议开启，点击后地图能随人移动
      showUserLocation: true,  // 显示蓝点
      showAccuracyCircle: false, // 隐藏浅蓝色的大圆圈，界面更清爽
    });

    controlRef.current = control;

    // 3. 添加到地图
    try {
      map.addControl(control, theme.direction === 'rtl' ? 'top-left' : 'top-right');
    } catch (e) {
      // 容错处理
    }

    // 4. 组件卸载时的清理
    return () => {
      if (controlRef.current) {
        try {
          if (controlRef.current.isTracking()) {
            controlRef.current.stop();
          }
          map.removeControl(controlRef.current);
        } catch (err) {
          // 忽略地图实例可能已不存在的情况
        } finally {
          cleanupExisting(); // 最终物理清理
        }
      }
    };
  }, [theme.direction]); // 监听方向变化以适配 RTL 布局

  return null;
};

export default MapCurrentLocation;