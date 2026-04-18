import { useId, useCallback, useEffect } from 'react';
import { useTheme } from '@mui/material';
import { map } from './core/MapView';
import getSpeedColor from '../common/util/colors';
import { findFonts } from './core/mapUtil';
import { SpeedLegendControl } from './legend/MapSpeedLegend';
import { useTranslation } from '../common/components/LocalizationProvider';
import { useAttributePreference } from '../common/util/preferences';

const MapRoutePoints = ({ positions, onClick, showSpeedControl }) => {
  const id = useId();
  const theme = useTheme();
  const t = useTranslation();
  const speedUnit = useAttributePreference('speedUnit');

  const onMouseEnter = () => (map.getCanvas().style.cursor = 'pointer');
  const onMouseLeave = () => (map.getCanvas().style.cursor = '');

  const onMarkerClick = useCallback(
    (event) => {
      event.preventDefault();
      const feature = event.features[0];
      if (onClick) {
        onClick(feature.properties.id, feature.properties.index);
      }
    },
    [onClick],
  );

  useEffect(() => {
    map.addSource(id, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [],
      },
    });
    map.addLayer({
      id,
      type: 'symbol',
      source: id,
      // 优化 1：设置最小缩放级别，建议放大到一定程度再显示方向箭头点
      minzoom: 13,
      paint: {
        'text-color': ['get', 'color'],
      },
      layout: {
        'text-font': findFonts(map),
        'text-size': 12,
        'text-field': '▲',
        // 优化 2：关闭重叠显示，当地图点太挤时自动隐藏部分箭头，提升性能
        'text-allow-overlap': false,
        'text-rotate': ['get', 'rotation'],
        'text-rotation-alignment': 'map',
      },
    });

    map.on('mouseenter', id, onMouseEnter);
    map.on('mouseleave', id, onMouseLeave);
    map.on('click', id, onMarkerClick);

    return () => {
      map.off('mouseenter', id, onMouseEnter);
      map.off('mouseleave', id, onMouseLeave);
      map.off('click', id, onMarkerClick);

      if (map.getLayer(id)) {
        map.removeLayer(id);
      }
      if (map.getSource(id)) {
        map.removeSource(id);
      }
    };
  }, [onMarkerClick]);

  useEffect(() => {
    // 基础防御
    if (!positions || positions.length === 0) return;

    const maxSpeed = positions.map((p) => p.speed).reduce((a, b) => Math.max(a, b), -Infinity);
    const minSpeed = positions.map((p) => p.speed).reduce((a, b) => Math.min(a, b), Infinity);

    const control = new SpeedLegendControl(positions, speedUnit, t, maxSpeed, minSpeed);
    if (showSpeedControl) {
      map.addControl(control, theme.direction === 'rtl' ? 'bottom-right' : 'bottom-left');
    }

    // --- 优化 3：根据数据总量动态计算抽稀步长 (Step) ---
    // 点数越多，跳过的点越多。例如 2000 个点以上时，每 5 个点画一个箭头
    const step = positions.length > 2000 ? 5 : (positions.length > 1000 ? 2 : 1);

    map.getSource(id)?.setData({
      type: 'FeatureCollection',
      features: positions
        .filter((_, i) => i % step === 0) // 执行抽稀
        .map((position, index) => ({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [position.longitude, position.latitude],
          },
          properties: {
            index: index * step, // 恢复原始索引，确保点击跳转正确
            id: position.id,
            rotation: position.course,
            color: getSpeedColor(position.speed, minSpeed, maxSpeed),
          },
        })),
    });
    return () => map.removeControl(control);
  }, [onMarkerClick, positions, showSpeedControl]);

  return null;
};

export default MapRoutePoints;