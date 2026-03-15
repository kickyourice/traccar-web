import { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector, connect } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { Snackbar } from '@mui/material';
import { devicesActions, sessionActions } from './store';
import { useCatchCallback, useEffectAsync } from './reactHelper';
import { snackBarDurationLongMs } from './common/util/duration';
import alarm from './resources/alarm.mp3';
import { eventsActions } from './store/events';
import useFeatures from './common/util/useFeatures';
import { useAttributePreference } from './common/util/preferences';
import {
  handleNativeNotificationListeners,
  nativePostMessage,
} from './common/components/NativeInterface';
import fetchOrThrow from './common/util/fetchOrThrow';
// 引入纠偏工具
import { wgs84ToGcj02 } from './common/util/converter';

// 每次运行都去查一下手机存没存过“日志开关”
const getLogLevel = () => {
  const saved = localStorage.getItem('MY_LOG_LEVEL');
  return saved !== null ? parseInt(saved, 10) : 2; // 默认 2
};

const logger = {
  debug: (...args) => getLogLevel() >= 2 && console.log(...args),
  warn: (...args) => getLogLevel() >= 1 && console.warn(...args),
  error: (...args) => getLogLevel() >= 1 && console.error(...args),
};

const logoutCode = 4000;

const SocketController = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const authenticated = useSelector((state) => Boolean(state.session.user));
  const includeLogs = useSelector((state) => state.session.includeLogs);

  const socketRef = useRef();
  const reconnectTimeoutRef = useRef();
   // 新增：用于追踪连接次数的计数器
  const connectionCounterRef = useRef(0);

  const clearReconnectTimeout = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  };

  const [notifications, setNotifications] = useState([]);

  const soundEvents = useAttributePreference('soundEvents', '');
  const soundAlarms = useAttributePreference('soundAlarms', 'sos');

  const features = useFeatures();

  const handleEvents = useCallback(
    (events) => {
      if (!features.disableEvents) {
        dispatch(eventsActions.add(events));
      }
      if (
        events.some(
          (e) =>
            soundEvents.includes(e.type) ||
            (e.type === 'alarm' && soundAlarms.includes(e.attributes.alarm)),
        )
      ) {
        new Audio(alarm).play();
      }
      setNotifications(
        events.map((event) => ({
          id: event.id,
          message: event.attributes.message,
          show: true,
        })),
      );
    },
    [features, dispatch, soundEvents, soundAlarms],
  );

  const connectSocket = () => {
    clearReconnectTimeout();
    if (socketRef.current) {
      // 1. 先把所有监听器拔掉，断开逻辑联系
      logger.debug(`[Socket] 清理句柄: ${socketRef.current.instanceId}`);
      socketRef.current.onopen = null;
      socketRef.current.onmessage = null;
      socketRef.current.onerror = null;
    
      // 2. 关键：把 onclose 设为 null，防止它在关闭时再次触发重连逻辑
      socketRef.current.onclose = null; 
    
      // 3. 执行物理关闭
      socketRef.current.close();
    
      // 4.彻底释放引用，等待垃圾回收
      socketRef.current = null;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/socket`);
    connectionCounterRef.current += 1;
    socket.instanceId = `conn_${connectionCounterRef.current}_${new Date().getTime().toString().slice(-4)}`;
    socketRef.current = socket;
    logger.debug(`[Socket] 新建句柄: ${socketRef.current.instanceId}`);

    socket.onopen = () => {
      logger.debug(`[Socket] 联网成功: ${socketRef.current.instanceId}`);
      dispatch(sessionActions.updateSocket(true));
    };

    socket.onclose = async (event) => {
      logger.debug(`[Socket] onclose被调用: ${socketRef.current.instanceId}`);
      dispatch(sessionActions.updateSocket(false));
      if (event.code !== logoutCode) {
        try {
          const devicesResponse = await fetch('/api/devices');
          if (devicesResponse.ok) {
            dispatch(devicesActions.update(await devicesResponse.json()));
          }
          const positionsResponse = await fetch('/api/positions');
          if (positionsResponse.ok) {
            // --- 修正点1：断线重连后的数据纠偏 ---
            const positions = await positionsResponse.json();
            const correctedPositions = positions.map((p) => {
              const [lon, lat] = wgs84ToGcj02(p.longitude, p.latitude);
              return { ...p, longitude: lon, latitude: lat };
            });
            dispatch(sessionActions.updatePositions(correctedPositions));
          }
          if (devicesResponse.status === 401 || positionsResponse.status === 401) {
            navigate('/login');
          }
        } catch {
          // ignore errors
        }
        clearReconnectTimeout();
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          connectSocket();
        }, 5000);
      }
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.devices) {
        dispatch(devicesActions.update(data.devices));
      }
      if (data.positions) {
        // --- 修正点2：实时推送数据的纠偏 ---
        const correctedPositions = data.positions.map((p) => {
          const [lon, lat] = wgs84ToGcj02(p.longitude, p.latitude);
          return { ...p, longitude: lon, latitude: lat };
        });
        dispatch(sessionActions.updatePositions(correctedPositions));
      }
      if (data.events) {
        handleEvents(data.events);
      }
      if (data.logs) {
        dispatch(sessionActions.updateLogs(data.logs));
      }
    };
  };

  useEffect(() => {
    socketRef.current?.send(JSON.stringify({ logs: includeLogs }));
  }, [includeLogs]);

  useEffectAsync(async () => {
    if (authenticated) {
      const response = await fetchOrThrow('/api/devices');
      dispatch(devicesActions.refresh(await response.json()));
      nativePostMessage('authenticated');
      connectSocket();
      return () => {
        clearReconnectTimeout();
        socketRef.current?.close(logoutCode);
      };
    }
    return null;
  }, [authenticated]);

  const handleNativeNotification = useCatchCallback(
    async (message) => {
      const eventId = message.data.eventId;
      if (eventId) {
        const response = await fetch(`/api/events/${eventId}`);
        if (response.ok) {
          const event = await response.json();
          const eventWithMessage = {
            ...event,
            attributes: { ...event.attributes, message: message.notification.body },
          };
          handleEvents([eventWithMessage]);
        }
      }
    },
    [handleEvents],
  );

  useEffect(() => {
    handleNativeNotificationListeners.add(handleNativeNotification);
    return () => handleNativeNotificationListeners.delete(handleNativeNotification);
  }, [handleNativeNotification]);

  useEffect(() => {
    if (!authenticated) return;
    //
    // 修改：优化重连指令逻辑，只要被调用，说明网络环境已变，强制重连
    const handleForceReconnect = () => {
      connectSocket();
    };

    // 分类处理函数：1. 后台切换/唤醒
    const onVisibility = () => {
      if (!document.hidden) {
        logger.debug('收到强制重连指令 (后台切换或页面显示)');
        handleForceReconnect();
      }
    };

    // 分类处理函数：2. 网络从断开状态恢复
    const onNetworkOnline = () => {
      logger.debug('收到强制重连指令 (网络连接恢复)');
      handleForceReconnect();
    };

    // 监听网络恢复
    window.addEventListener('online', onNetworkOnline);
    // 监听前后台切换
    document.addEventListener('visibilitychange', onVisibility);
    // 监听 WebView 唤醒
    window.addEventListener('pageshow', onVisibility);

    return () => {
      window.removeEventListener('online', onNetworkOnline);
      window.removeEventListener('pageshow', onVisibility);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [authenticated]);

  return (
    <>
      {notifications.map((notification) => (
        <Snackbar
          key={notification.id}
          open={notification.show}
          message={notification.message}
          autoHideDuration={snackBarDurationLongMs}
          onClose={() => setNotifications(notifications.filter((e) => e.id !== notification.id))}
        />
      ))}
    </>
  );
};

export default connect()(SocketController);
