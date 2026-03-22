import { wgs84ToGcj02, gcj02ToWgs84 } from './converter';

// 工具函数：解析并转换 WKT 坐标字符串 (支持 CIRCLE 和 POLYGON)
const transformWkt = (wkt, converter) => {
  if (typeof wkt !== 'string') return wkt;

  // 1. 处理圆形: CIRCLE (lat lon, radius)
  if (wkt.startsWith('CIRCLE')) {
    return wkt.replace(/CIRCLE\s*\(([^,]+),\s*([^)]+)\)/, (match, coords, radius) => {
      const parts = coords.trim().split(/\s+/);
      const lat = parseFloat(parts[0]);
      const lon = parseFloat(parts[1]);
      const [transformedLon, transformedLat] = converter(lon, lat);
      return `CIRCLE (${transformedLat.toFixed(6)} ${transformedLon.toFixed(6)}, ${radius})`;
    });
  }

  // 2. 处理多边形: POLYGON ((lat lon, lat lon...))
  // 使用正则匹配所有 "数字 数字" 结构的坐标对
  return wkt.replace(/(-?\d+\.\d+)\s+(-?\d+\.\d+)/g, (match, p1, p2) => {
    const lat = parseFloat(p1);
    const lon = parseFloat(p2);
    const [transformedLon, transformedLat] = converter(lon, lat);
    return `${transformedLat.toFixed(6)} ${transformedLon.toFixed(6)}`;
  });
};

export default async (input, init) => {
  let modifiedInit = init;

  // --- 入库拦截：保存数据到服务器前转回 WGS-84 ---
  if (init && (init.method === 'POST' || init.method === 'PUT')) {
    // 拦截围栏保存
    if (input.includes('/api/geofences')) {
      try {
        const body = JSON.parse(init.body);
        if (body.area) {
          body.area = transformWkt(body.area, gcj02ToWgs84);
          modifiedInit = { ...init, body: JSON.stringify(body) };
        }
      } catch (e) {
        // 忽略解析错误
      }
    }
  }

  const response = await fetch(input, modifiedInit || init);

  if (!response.ok) {
    throw new Error(await response.text());
  }

  // --- 出库拦截：从服务器拿到数据展示前转为 GCJ-02 ---
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    const originalJson = response.json.bind(response);

    response.json = async () => {
      const data = await originalJson();

      const transform = (obj) => {
        if (Array.isArray(obj)) {
          return obj.map(transform);
        } else if (obj !== null && typeof obj === 'object') {
          // 1. 精准抓取 route 字段 (组合报表的蓝色轨迹线)
          if (obj.route && Array.isArray(obj.route)) {
            obj.route = obj.route.map((point) => {
              if (Array.isArray(point) && point.length === 2) {
                // 注意：Traccar 这里的 route 数组内部通常是 [longitude, latitude]
                const [lon, lat] = point;
                const [tLon, tLat] = wgs84ToGcj02(lon, lat);
                return [tLon, tLat];
              }
              return point;
            });
          }
          // 2. 处理标准位置坐标 (Position)
          if (typeof obj.latitude === 'number' && typeof obj.longitude === 'number') {
            const [lon, lat] = wgs84ToGcj02(obj.longitude, obj.latitude);
            obj.longitude = lon;
            obj.latitude = lat;
          }
          // 3. 处理行程报表坐标 (Trips)
          if (typeof obj.startLat === 'number' && typeof obj.startLon === 'number') {
            const [lon, lat] = wgs84ToGcj02(obj.startLon, obj.startLat);
            obj.startLat = lat;
            obj.startLon = lon;
          }
          if (typeof obj.endLat === 'number' && typeof obj.endLon === 'number') {
            const [lon, lat] = wgs84ToGcj02(obj.endLon, obj.endLat);
            obj.endLat = lat;
            obj.endLon = lon;
          }
          // 4. 处理围栏显示坐标 (Geofence Area)
          if (obj.area && typeof obj.area === 'string') {
            obj.area = transformWkt(obj.area, wgs84ToGcj02);
          }

          // 递归处理嵌套结构 (必须显式赋值回对象)
          Object.keys(obj).forEach((key) => {
            // 避开已经处理过的 route 字段，防止重复转换
            if (key !== 'route' && obj[key] !== null && typeof obj[key] === 'object') {
              obj[key] = transform(obj[key]);
            }
          });
        }
        return obj;
      };

      return transform(data);
    };
  }

  return response;
};